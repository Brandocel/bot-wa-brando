import { Inject, Injectable } from '@nestjs/common';
import type { Document } from '@prisma/client';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import { AccessScopeService, type OrgScope } from './access-scope.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService } from './document-search.service';
import type { SearchQuery } from './document-search.service';
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

    // Una foto o un audio sin texto no traen nada que extraer. Antes caían
    // en el flujo de documentos y provocaban un "¿qué documento necesitas?"
    // que no venía a cuento.
    if (message.kind !== 'TEXT' && message.body.trim() === '') {
      return 'Recibí tu archivo, pero todavía no sé leerlo. Escríbeme qué documento necesitas y de qué mes.';
    }

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
    });

    /**
     * ESTO es lo que convierte mensajes sueltos en una conversación.
     *
     * Cada mensaje se extrae por separado, así que "de este mes" trae
     * periodo y ninguna categoría, y "factura" trae categoría y ningún
     * periodo. Sin fusionar contra lo que ya está en el ticket, el bot
     * pregunta el mes, le contestan el mes, y a la siguiente vuelta ya no
     * se acuerda de que le habían dicho "factura" — y pregunta otra vez.
     *
     * Lo nuevo pisa a lo viejo, pero un hueco NUNCA borra lo que ya
     * estaba: por eso se comprueba contra null en vez de asignar de plano.
     */
    const query = mergeSlots(ticket.slots, extraction.query);

    await this.tickets.updateSlots(ticket.id, {
      category: query.category,
      period: query.period?.toISOString() ?? null,
      folio: query.folio,
    });

    const asked = readAsked(ticket.slots);

    // Presupuesto agotado: escala en vez de seguir preguntando.
    if (asked.total >= MAX_QUESTIONS) {
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
      return this.ask(ticket, asked, 'empresa', [
        'Tienes acceso a varias empresas. ¿De cuál lo necesitas?',
        ...scope.scopes.map((s) => `• ${s.organizationName}`),
      ].join('\n'));
    }

    if (!query.category && !query.folio) {
      return this.ask(
        ticket,
        asked,
        'categoria',
        '¿Qué documento necesitas? Puedo buscarte facturas, contratos, cotizaciones, reportes y pólizas.',
      );
    }

    if (!query.period && !query.folio) {
      return this.ask(ticket, asked, 'periodo', '¿De qué mes lo necesitas?');
    }

    const results = await this.search.search(scope.scopes, {
      ...query,
      organizationId,
    });

    if (results.length === 0) {
      const denial = query.category
        ? this.scope.denialFor(
            scope.scopes,
            query.category,
            query.period,
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

    // Varios resultados NO es ambigüedad de la persona: preguntó bien y hay
    // más de un documento que encaja. Se listan con su folio para que pueda
    // señalar uno, y esta pregunta no cuenta contra el presupuesto.
    if (results.length > 1) {
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
   * Hace una pregunta, pero solo si no se hizo ya.
   *
   * Repetir una pregunta que la persona ya contestó es la forma más rápida
   * de que abandone la conversación: da la sensación de no estar hablando
   * con nadie. Si un dato sigue faltando DESPUÉS de haberlo pedido, el
   * problema no es que falte información — es que no nos estamos
   * entendiendo, y eso lo resuelve una persona, no otra pregunta.
   *
   * Qué se preguntó vive en los slots del ticket, no en memoria: entre un
   * mensaje y el siguiente el core puede reiniciarse o atender desde otra
   * instancia.
   */
  private async ask(
    ticket: { id: string; number: number; slots: unknown },
    asked: AskedState,
    slot: AskableSlot,
    question: string,
  ): Promise<string> {
    if (asked.slots[slot]) {
      await this.tickets.escalate(ticket.id, 'slots_incompletos', null);
      return [
        'Ya te pregunté esto y sigo sin entenderlo bien; no quiero hacerte repetir.',
        `Se lo pasé al equipo con el folio #${ticket.number}.`,
      ].join('\n');
    }

    await this.tickets.updateSlots(ticket.id, {
      preguntas: asked.total + 1,
      preguntado: { ...asked.slots, [slot]: true },
    });

    return question;
  }
}

/**
 * Fusiona lo que el ticket ya sabía con lo que trajo este mensaje.
 *
 * Un campo nuevo gana. Un campo vacío se ignora: "de este mes" no puede
 * borrar el "factura" que la persona dijo hace dos mensajes.
 */
function mergeSlots(stored: unknown, fresh: SearchQuery): SearchQuery {
  const previous = (typeof stored === 'object' && stored !== null
    ? stored
    : {}) as Record<string, unknown>;

  const storedPeriod =
    typeof previous.period === 'string' ? new Date(previous.period) : null;

  return {
    category: fresh.category ?? (previous.category as SearchQuery['category']) ?? null,
    period: fresh.period ?? storedPeriod,
    folio: fresh.folio ?? (typeof previous.folio === 'string' ? previous.folio : null),
    text: fresh.text,
  };
}

/** Los datos que el bot sabe pedir cuando faltan. */
type AskableSlot = 'categoria' | 'periodo' | 'empresa';

interface AskedState {
  /** Cuántas preguntas se han hecho en este ticket. */
  total: number;
  /** Cuáles en concreto, para no repetir ninguna. */
  slots: Partial<Record<AskableSlot, boolean>>;
}

/**
 * El estado de la conversación vive en el ticket.
 *
 * Es la "ventana de contexto" del bot, y a propósito NO es el historial de
 * mensajes: es un puñado de campos resueltos. Mandarle al modelo cuarenta
 * mensajes crudos es la causa número uno de que un bot se pierda, además de
 * lo que hace que cada turno cueste más que el anterior.
 */
function readAsked(slots: unknown): AskedState {
  const raw = (typeof slots === 'object' && slots !== null
    ? slots
    : {}) as Record<string, unknown>;

  const preguntado =
    typeof raw.preguntado === 'object' && raw.preguntado !== null
      ? (raw.preguntado as Partial<Record<AskableSlot, boolean>>)
      : {};

  return {
    total: typeof raw.preguntas === 'number' ? raw.preguntas : 0,
    slots: preguntado,
  };
}

function describe(doc: Document): string {
  const period = doc.period ? doc.period.toISOString().slice(0, 7) : 'sin fecha';
  return `${doc.name} (${period}${doc.folio ? `, folio ${doc.folio}` : ''})`;
}
