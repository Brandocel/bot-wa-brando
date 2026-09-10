import { Inject, Injectable } from '@nestjs/common';
import type { Document } from '@prisma/client';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import { AccessScopeService, type OrgScope } from './access-scope.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService } from './document-search.service';
import { SlotExtractorService } from './slot-extractor.service';
import { TicketService } from './ticket.service';

/**
 * La conversación de soporte en lenguaje normal.
 *
 * Corre el mismo camino que /buscar —alcance, slots, búsqueda, ticket,
 * entrega— pero sin obligar al cliente a aprender comandos. Y con las
 * mismas reglas duras, que son las que evitan que el bot se pierda:
 *
 *  - El modelo extrae slots y redacta. NUNCA decide permisos, ni qué
 *    documento entregar, ni cuándo escalar.
 *  - Presupuesto de 3 preguntas. A la cuarta, escala. Un bot que pregunta
 *    cinco veces ya perdió al cliente.
 *  - 0 resultados escala, más de 1 pregunta, exactamente 1 entrega.
 *    Nunca "creo que te refieres a...".
 */

const MAX_QUESTIONS = 3;

export interface StrategyContext {
  contactId: string;
  conversationId: string;
}

@Injectable()
export class SupportStrategy {
  constructor(
    private readonly scope: AccessScopeService,
    private readonly slots: SlotExtractorService,
    private readonly search: DocumentSearchService,
    private readonly delivery: DocumentDeliveryService,
    private readonly tickets: TicketService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  /**
   * Devuelve la respuesta, o null si este mensaje no es para esta Strategy
   * (por ejemplo, de un número sin ninguna membresía).
   */
  async handle(
    message: IncomingMessage,
    ctx: StrategyContext,
  ): Promise<string | null> {
    const scope = await this.scope.resolve(message.senderId);

    // Sin membresía no hay conversación de soporte. Que conteste el eco o,
    // más adelante, la Strategy de ventas.
    if (scope.decision !== 'ALLOW') return null;

    const extraction = await this.slots.extract(message.body);

    if (extraction.notADocumentRequest) {
      return this.smallTalk(message.body, scope.scopes);
    }

    const ticket = await this.tickets.openOrReattach({
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      organizationId:
        scope.scopes.length === 1 ? scope.scopes[0]!.organizationId : null,
      subject: message.body,
      priority: this.tickets.priorityFor(extraction.query),
      slots: {
        category: extraction.query.category,
        period: extraction.query.period?.toISOString() ?? null,
        folio: extraction.query.folio,
      },
    });

    const asked = countQuestions(ticket.slots);

    // Presupuesto agotado: escala en vez de seguir preguntando.
    if (asked >= MAX_QUESTIONS) {
      await this.tickets.escalate(ticket.id, 'slots_incompletos', null);
      return [
        'Creo que no te estoy entendiendo bien, y no quiero hacerte dar más vueltas.',
        `Ya le pasé tu caso al equipo con el folio #${ticket.number}; alguien te contacta.`,
      ].join('\n');
    }

    const organizationId = this.resolveCompany(extraction.companyHint, scope.scopes);

    // Varias empresas y no dijo cuál: se pregunta. Elegir la primera es
    // exactamente cómo se entrega la factura de la empresa equivocada.
    if (scope.scopes.length > 1 && !organizationId) {
      await this.countUp(ticket.id, ticket.slots);
      return [
        'Tienes acceso a varias empresas. ¿De cuál lo necesitas?',
        ...scope.scopes.map((s) => `• ${s.organizationName}`),
      ].join('\n');
    }

    if (!extraction.query.category && !extraction.query.folio) {
      await this.countUp(ticket.id, ticket.slots);
      return '¿Qué documento necesitas? Puedo buscarte facturas, contratos, cotizaciones, reportes y pólizas.';
    }

    if (!extraction.query.period && !extraction.query.folio) {
      await this.countUp(ticket.id, ticket.slots);
      return '¿De qué mes lo necesitas?';
    }

    const results = await this.search.search(scope.scopes, {
      ...extraction.query,
      organizationId,
    });

    if (results.length === 0) {
      const denial = extraction.query.category
        ? this.scope.denialFor(
            scope.scopes,
            extraction.query.category,
            extraction.query.period,
          )
        : null;

      await this.tickets.escalate(
        ticket.id,
        denial ? 'sin_permiso' : 'sin_resultados',
        null,
      );

      // Sin permiso y sin resultados dan la MISMA respuesta. Distinguirlas
      // permitiría mapear el Drive ajeno a base de preguntas.
      return [
        'No encontré ese documento.',
        `Lo dejé anotado con el folio #${ticket.number} para que alguien del equipo lo revise.`,
      ].join('\n');
    }

    if (results.length > 1) {
      await this.countUp(ticket.id, ticket.slots);
      return [
        `Encontré ${results.length}. ¿Cuál necesitas?`,
        ...results.map((doc) => `• ${describe(doc)}`),
      ].join('\n');
    }

    const doc = results[0]!;
    const sent = await this.delivery.deliver(
      message.chatId,
      doc,
      `Ticket #${ticket.number} — ${doc.name}`,
    );

    await this.tickets.record(ticket.id, 'entrega', 'bot', {
      documentId: doc.id,
      name: doc.name,
      entregado: sent.ok,
    });

    if (!sent.ok) {
      await this.tickets.escalate(ticket.id, 'sin_resultados', null);
      return [
        'Encontré tu documento pero no pude enviártelo por aquí.',
        `Ya lo pasé al equipo con el folio #${ticket.number}.`,
      ].join('\n');
    }

    await this.tickets.close(ticket.id, 'resuelto');
    return `Aquí está. Te dejo el folio #${ticket.number} por si necesitas darle seguimiento:`;
  }

  /**
   * Saludos, agradecimientos y preguntas generales.
   *
   * El modelo redacta, pero solo con lo que ya está resuelto: qué empresas
   * puede consultar quien escribe. No recibe historial ni documentos.
   */
  private async smallTalk(
    text: string,
    scopes: readonly OrgScope[],
  ): Promise<string> {
    const companies = scopes.map((s) => s.organizationName).join(', ');

    const drafted = await this.llm.draft({
      system: [
        'Eres el asistente de documentos de una empresa, por WhatsApp.',
        'Respondes en español, en tono cercano y directo, máximo dos frases.',
        'Tuteas. No usas emojis ni saludos largos.',
        `Quien escribe puede consultar documentos de: ${companies}.`,
        'Puedes buscar facturas, contratos, cotizaciones, reportes y pólizas.',
        'Si te preguntan algo que no sea sobre documentos, dilo y ofrece buscar uno.',
        'Nunca prometas nada que no sea entregar un documento.',
      ].join('\n'),
      user: text,
      maxTokens: 200,
    });

    return (
      drafted ??
      `Puedo buscarte documentos de ${companies}. Dime cuál necesitas y de qué mes.`
    );
  }

  /** Empresa mencionada en el texto, si coincide con alguna del alcance. */
  private resolveCompany(
    hint: string | null,
    scopes: readonly OrgScope[],
  ): string | null {
    if (scopes.length === 1) return scopes[0]!.organizationId;
    if (!hint) return null;

    const needle = hint.toLowerCase();
    const match = scopes.find(
      (s) =>
        s.organizationName.toLowerCase().includes(needle) ||
        needle.includes(s.organizationName.toLowerCase()),
    );

    return match?.organizationId ?? null;
  }

  /**
   * El contador de preguntas vive en los slots del ticket, no en memoria:
   * el core puede reiniciarse o correr en varias instancias entre un
   * mensaje y el siguiente.
   */
  private async countUp(
    ticketId: string,
    slots: unknown,
  ): Promise<void> {
    const current = countQuestions(slots);
    await this.tickets.updateSlots(ticketId, { preguntas: current + 1 });
  }
}

function countQuestions(slots: unknown): number {
  if (typeof slots !== 'object' || slots === null) return 0;
  const value = (slots as Record<string, unknown>).preguntas;
  return typeof value === 'number' ? value : 0;
}

function describe(doc: Document): string {
  const period = doc.period ? doc.period.toISOString().slice(0, 7) : 'sin fecha';
  return `${doc.name} (${period}${doc.folio ? `, folio ${doc.folio}` : ''})`;
}
