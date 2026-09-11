import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { AccessScopeService } from './access-scope.service';
import { SupportStrategy } from './support.strategy';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly strategy: SupportStrategy,
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

    /**
     * Mismo camino que la conversación normal: alcance, solicitud, búsqueda,
     * entrega, y ticket solo si hace falta una persona. Antes /buscar abría
     * un ticket por cada búsqueda; un ticket es soporte, no bitácora.
     */
    const reply = await this.strategy.handle({ ...message, body: args }, ctx);
    return reply?.text ?? 'No encontré ningún documento con esos datos.';
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
}
