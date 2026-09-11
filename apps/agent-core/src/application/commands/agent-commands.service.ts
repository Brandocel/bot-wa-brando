import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { TicketAssignmentService } from '../support/ticket-assignment.service';
import { TicketService } from '../support/ticket.service';

/**
 * Comandos de los agentes de soporte, desde su propio WhatsApp.
 *
 * El agente recibe el aviso del ticket en su teléfono y retoma el chat del
 * cliente desde ahí; lo que le falta es poder cerrar el ticket sin abrir
 * el panel. Eso es lo que hay aquí: ver los suyos, cerrar uno, tomar uno.
 *
 * Solo contesta a números que están en la tabla de agentes y activos. Para
 * cualquier otro devuelve null y el mensaje sigue su camino: un cliente
 * que escriba "/cerrar 5" recibe el "no conozco ese comando" de siempre.
 */
@Injectable()
export class AgentCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly assignment: TicketAssignmentService,
  ) {}

  async tryHandle(message: IncomingMessage): Promise<string | null> {
    const text = message.body.trim();
    if (!text.startsWith('/')) return null;

    const [rawName, ...rest] = text.slice(1).split(/\s+/);
    const name = (rawName ?? '').toLowerCase();
    if (!['mios', 'míos', 'cerrar', 'tomar'].includes(name)) return null;

    const agente = await this.prisma.supportAgent.findFirst({
      where: { waId: message.senderId, active: true },
    });
    if (!agente) return null;

    switch (name) {
      case 'mios':
      case 'míos':
        return this.mios(agente.waId);
      case 'cerrar':
        return this.cerrar(agente, rest);
      case 'tomar':
        return this.tomar(agente, rest[0]);
      default:
        return null;
    }
  }

  private async mios(waId: string): Promise<string> {
    const abiertos = await this.prisma.ticket.findMany({
      where: { assignedToWaId: waId, state: 'EN_REVISION' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 10,
      include: {
        contact: { select: { displayName: true, waId: true } },
        organization: { select: { name: true } },
      },
    });

    if (abiertos.length === 0) return 'No tienes tickets pendientes.';

    return [
      `Tus tickets (${abiertos.length}):`,
      ...abiertos.map((t) => {
        const quien = t.contact.displayName ?? t.contact.waId.split('@')[0];
        const empresa = t.organization?.name ?? 'sin empresa';
        return `#${t.number} · ${empresa} · ${quien} · ${t.priority}`;
      }),
      '',
      'Cierra uno con /cerrar <número> [nota].',
    ].join('\n');
  }

  private async cerrar(
    agente: { waId: string; name: string },
    args: string[],
  ): Promise<string> {
    const numero = Number(args[0]);
    if (!Number.isInteger(numero) || numero <= 0) {
      return 'Dime cuál: /cerrar <número de ticket> [nota].';
    }

    const ticket = await this.prisma.ticket.findUnique({ where: { number: numero } });
    if (!ticket) return `No existe el ticket #${numero}.`;

    if (ticket.state === 'CERRADO') return `El ticket #${numero} ya estaba cerrado.`;

    // Solo el asignado lo cierra. Cerrar el de otro es pisarle el trabajo
    // sin que se entere; para eso está /tomar primero.
    if (ticket.assignedToWaId !== agente.waId) {
      return `El ticket #${numero} no está asignado a ti. Si lo vas a atender, primero /tomar ${numero}.`;
    }

    const nota = args.slice(1).join(' ').trim();
    await this.tickets.close(
      ticket.id,
      nota ? `resuelto por agente: ${nota}` : 'resuelto por agente',
      `agente:${agente.waId}`,
    );

    // El hilo del cliente deja de esperar a una persona.
    await this.prisma.conversation.update({
      where: { id: ticket.conversationId },
      data: { awaiting: 'NADIE' },
    });

    return `Listo, ticket #${numero} cerrado.`;
  }

  private async tomar(
    agente: { waId: string; name: string },
    arg: string | undefined,
  ): Promise<string> {
    const numero = Number(arg);
    if (!Number.isInteger(numero) || numero <= 0) {
      return 'Dime cuál: /tomar <número de ticket>.';
    }

    const ticket = await this.prisma.ticket.findUnique({ where: { number: numero } });
    if (!ticket) return `No existe el ticket #${numero}.`;
    if (ticket.state === 'CERRADO') return `El ticket #${numero} ya está cerrado.`;

    if (ticket.assignedToWaId === agente.waId) {
      return `El ticket #${numero} ya es tuyo.`;
    }

    // Si el bot todavía lo estaba atendiendo, deja de hacerlo: tomar un
    // ticket es sacarlo del automático.
    if (ticket.state === 'ABIERTO') {
      await this.tickets.escalate(ticket.id, 'pidio_humano', agente.waId);
    }

    await this.assignment.asignarA(
      ticket.id,
      agente.waId,
      'pidio_humano',
      `agente:${agente.waId}`,
    );

    return `El ticket #${numero} ahora es tuyo. Te acabo de mandar el resumen.`;
  }
}
