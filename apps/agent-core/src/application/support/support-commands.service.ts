import { Injectable, Logger } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { AccessScopeService, type OrgScope } from './access-scope.service';
import { DocumentSearchService } from './document-search.service';
import { parseQuery } from './query-parser';
import { DocumentDeliveryService } from './document-delivery.service';
import { TicketService } from './ticket.service';

/**
 * Comandos de soporte, sin LLM de por medio.
 *
 * Existen por dos razones. La primera es probar hoy el camino completo
 * —identidad, permisos, búsqueda, ticket, entrega— sin depender del modelo.
 * La segunda es que ese camino siga siendo verificable después: cuando el LLM
 * entre, va a llamar a estos mismos servicios, así que un `/buscar` que
 * funciona y un agente que no, señala al prompt y no a los permisos.
 */

export interface SupportContext {
  contactId: string;
  conversationId: string;
}

@Injectable()
export class SupportCommandsService {
  private readonly logger = new Logger(SupportCommandsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly search: DocumentSearchService,
    private readonly tickets: TicketService,
    private readonly delivery: DocumentDeliveryService,
  ) {}

  async tryHandle(
    message: IncomingMessage,
    ctx: SupportContext,
  ): Promise<string | null> {
    const text = message.body.trim();
    if (!text.startsWith('/')) return null;

    const [rawName, ...rest] = text.slice(1).split(/\s+/);
    const name = (rawName ?? '').toLowerCase();
    const args = rest.join(' ');

    switch (name) {
      case 'buscar':
        return this.buscar(message, ctx, args);
      case 'permisos':
        return this.permisos(message);
      case 'tickets':
        return this.listarTickets(ctx);
      case 'id':
        // Disponible para cualquiera a propósito: solo muestra los
        // identificadores de QUIEN pregunta, y es la única forma de averiguar
        // el valor correcto de OWNER_WA_ID cuando el rol todavía no cuadra.
        return [
          `chatId: ${message.chatId}`,
          `senderId: ${message.senderId}`,
        ].join('\n');
      default:
        return null;
    }
  }

  /**
   * El camino completo en un comando: alcance → slots → búsqueda → ticket.
   *
   * Nótese lo que NO pasa aquí: en ningún punto se le dice al usuario que un
   * documento existe pero está prohibido. Sin permiso y sin resultados dan la
   * misma respuesta, porque distinguirlas permite mapear el Drive ajeno a
   * base de preguntas.
   */
  private async buscar(
    message: IncomingMessage,
    ctx: SupportContext,
    args: string,
  ): Promise<string> {
    if (!args) return 'Uso: /buscar factura febrero 2026';

    const scope = await this.scope.resolve(message.senderId);
    const query = parseQuery(args);

    if (scope.decision !== 'ALLOW') {
      await this.audit(message.senderId, args, null, scope.decision, scope.decidedBy);
      return 'No encontré ningún documento con esos datos.';
    }

    const ticket = await this.tickets.openOrReattach({
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      organizationId:
        scope.scopes.length === 1 ? scope.scopes[0]!.organizationId : null,
      subject: args,
      priority: this.tickets.priorityFor(query),
      slots: {
        category: query.category,
        period: query.period?.toISOString() ?? null,
        folio: query.folio,
      },
    });

    // Varias organizaciones y la consulta no dice cuál: se pregunta. Elegir
    // la primera es cómo se entrega la factura de la empresa equivocada.
    if (scope.scopes.length > 1 && !this.mentionsOrg(args, scope.scopes)) {
      return [
        `Ticket #${ticket.number}. Tienes acceso a varias empresas:`,
        ...scope.scopes.map((s) => `• ${s.organizationName}`),
        '',
        'Dime de cuál lo necesitas.',
      ].join('\n');
    }

    const organizationId = this.mentionsOrg(args, scope.scopes);
    const results = await this.search.search(scope.scopes, {
      ...query,
      organizationId,
    });

    if (results.length === 0) {
      const denial = query.category
        ? this.scope.denialFor(scope.scopes, query.category, query.period)
        : null;

      await this.audit(
        message.senderId,
        args,
        null,
        denial ?? 'NOT_FOUND',
        denial ? 'fuera del alcance' : 'sin coincidencias en el índice',
      );

      await this.tickets.escalate(
        ticket.id,
        denial ? 'sin_permiso' : 'sin_resultados',
        null,
      );

      return [
        'No encontré ningún documento con esos datos.',
        `Lo pasé a revisión con el folio #${ticket.number}; alguien del equipo lo revisa.`,
      ].join('\n');
    }

    if (results.length > 1) {
      return [
        `Ticket #${ticket.number}. Encontré ${results.length} documentos:`,
        ...results.map((doc, i) => `${i + 1}. ${this.describe(doc)}`),
        '',
        'Dime cuál con su folio.',
      ].join('\n');
    }

    const doc = results[0]!;
    await this.audit(message.senderId, args, doc.id, 'ALLOW', 'dentro del alcance');

    const sent = await this.delivery.deliver(
      message.chatId,
      doc,
      `Ticket #${ticket.number} — ${doc.name}`,
    );

    await this.tickets.record(ticket.id, 'entrega', 'bot', {
      documentId: doc.id,
      name: doc.name,
      entregado: sent.ok,
      motivo: sent.ok ? null : sent.reason,
    });

    // Solo se cierra si el documento salió. Un ticket cerrado con el archivo
    // sin entregar es justo el caso que nadie vuelve a revisar.
    if (sent.ok) {
      await this.tickets.close(ticket.id, 'resuelto');
      return `Ticket #${ticket.number} — aquí está tu ${doc.name}:`;
    }

    await this.tickets.escalate(ticket.id, 'sin_resultados', null);

    const excuse =
      sent.reason === 'too_big'
        ? 'El archivo pesa más de lo que WhatsApp acepta.'
        : 'No pude recuperar el archivo del repositorio.';

    return [
      `Ticket #${ticket.number} — encontré el documento pero no pude enviártelo.`,
      excuse,
      'Ya lo pasé a revisión con el equipo.',
    ].join('\n');
  }

  /** Para que el operador pueda verificar el alcance real de un número. */
  private async permisos(message: IncomingMessage): Promise<string> {
    const scope = await this.scope.resolve(message.senderId);

    if (scope.decision !== 'ALLOW') {
      return `Sin acceso: ${scope.decidedBy}.`;
    }

    return scope.scopes
      .map((s) => {
        const cats = s.windows
          .map((w) => {
            const from = w.periodFrom
              ? w.periodFrom.toISOString().slice(0, 7)
              : '—';
            const to = w.periodTo ? w.periodTo.toISOString().slice(0, 7) : '—';
            const window =
              w.periodFrom || w.periodTo ? ` (${from} a ${to})` : '';
            return `  • ${w.category}${window}`;
          })
          .join('\n');
        return `${s.organizationName}:\n${cats}`;
      })
      .join('\n\n');
  }

  private async listarTickets(ctx: SupportContext): Promise<string> {
    const rows = await this.prisma.ticket.findMany({
      where: { conversationId: ctx.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (rows.length === 0) return 'No tienes tickets en esta conversación.';

    return rows
      .map(
        (t) =>
          `#${t.number} [${t.state}/${t.priority}] ${t.subject}` +
          (t.level > 0 ? ` (nivel ${t.level})` : ''),
      )
      .join('\n');
  }

  /** Devuelve el id de la organización mencionada en el texto, si alguna. */
  private mentionsOrg(text: string, scopes: readonly OrgScope[]): string | null {
    const haystack = text.toLowerCase();
    const hit = scopes.find((s) =>
      haystack.includes(s.organizationName.toLowerCase()),
    );
    return hit?.organizationId ?? null;
  }

  private describe(doc: Document): string {
    const period = doc.period ? doc.period.toISOString().slice(0, 7) : 's/f';
    return `${doc.name} — ${doc.category} ${period}${doc.folio ? ` folio ${doc.folio}` : ''}`;
  }

  /**
   * Toda decisión de acceso queda escrita, permitida o no. Falla en silencio
   * a propósito: perder una línea de auditoría es malo, pero tumbar la
   * respuesta por no poder escribirla es peor.
   */
  private async audit(
    waId: string,
    query: string,
    documentId: string | null,
    decision: string,
    decidedBy: string,
  ): Promise<void> {
    try {
      await this.prisma.accessAudit.create({
        data: { waId, query, documentId, decision, decidedBy },
      });
    } catch (err) {
      this.logger.warn(`no se pudo auditar el acceso: ${String(err)}`);
    }
  }
}
