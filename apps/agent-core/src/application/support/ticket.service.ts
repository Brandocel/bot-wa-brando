import { Injectable } from '@nestjs/common';
import type { DocCategory, Prisma, Ticket, TicketPriority } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/**
 * Ciclo de vida del ticket: ABIERTO → EN_REVISION → CERRADO.
 *
 * Cada transición escribe un TicketEvent. El campo `state` existe por
 * comodidad de consulta; la verdad de lo que pasó está en la bitácora, que
 * es append-only y nunca se actualiza.
 */

/** Cuánto vive un ticket ABIERTO sin actividad antes del cierre automático. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Ventana de reapertura: después de esto, es un ticket nuevo. */
const REOPEN_MS = 72 * 60 * 60 * 1000;

/** Cuánto sigue contando lo dicho en el ticket anterior de la conversación. */
const CONTINUIDAD_MS = 30 * 60 * 1000;

export type EscalationReason =
  | 'sin_resultados'
  | 'sin_permiso'
  | 'pidio_humano'
  | 'slots_incompletos'
  | 'molesto'
  | 'sla_vencido'
  | 'tema_sensible';

/** El nivel al que sube cada motivo. Tabla, no `if` desperdigados. */
const ESCALATION_LEVEL: Record<EscalationReason, number> = {
  sin_resultados: 1,
  sin_permiso: 1,
  pidio_humano: 1,
  slots_incompletos: 1,
  molesto: 1,
  tema_sensible: 1,
  sla_vencido: 2,
};

@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prioridad por tabla determinista. El LLM puede sugerir, pero el valor lo
   * fija esto: si la prioridad la decidiera el modelo, escribir "URGENTE" en
   * mayúsculas sería suficiente para saltarse la cola.
   */
  priorityFor(input: {
    category: DocCategory | null;
    period: Date | null;
    isReopen?: boolean;
  }): TicketPriority {
    if (input.isReopen) return 'ALTA';

    if (input.category === 'FACTURA' && input.period) {
      const now = new Date();
      const currentPeriod = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      if (input.period.getTime() === currentPeriod.getTime()) return 'ALTA';
    }

    return input.category ? 'MEDIA' : 'BAJA';
  }

  /**
   * Abre un ticket o reengancha el que ya está abierto en esta conversación.
   *
   * Un ticket es por SOLICITUD, no por conversación: si el que sigue abierto
   * trata de otra cosa, aquí se abre otro en vez de mezclar dos asuntos en
   * un mismo folio.
   */
  async openOrReattach(input: {
    conversationId: string;
    contactId: string;
    organizationId?: string | null;
    subject: string;
    priority: TicketPriority;
    slots?: Record<string, unknown>;
  }): Promise<Ticket> {
    const open = await this.prisma.ticket.findFirst({
      where: { conversationId: input.conversationId, state: 'ABIERTO' },
      orderBy: { createdAt: 'desc' },
    });

    if (open) {
      return this.prisma.ticket.update({
        where: { id: open.id },
        data: {
          slots: {
            ...(open.slots as Record<string, unknown>),
            ...(input.slots ?? {}),
          } as Prisma.InputJsonValue,
          // La prioridad solo sube. Un mensaje trivial dentro de un ticket
          // urgente no lo vuelve trivial.
          priority: maxPriority(open.priority, input.priority),
        },
      });
    }

    /**
     * Un ticket nuevo hereda lo que ya se sabía, si viene justo detrás.
     *
     * Sin esto, escalar rompía la conversación: el ticket escalado deja de
     * estar ABIERTO, el mensaje siguiente abre uno nuevo con los slots en
     * blanco, y el bot vuelve a preguntar el tipo de documento que la
     * persona acababa de decir. Desde fuera parece amnesia; desde dentro es
     * que la memoria vivía en un ticket que ya se cerró.
     *
     * Solo dentro de la ventana de continuidad: media hora después, quien
     * escribe casi siempre viene a otra cosa.
     */
    const reciente = await this.prisma.ticket.findFirst({
      where: {
        conversationId: input.conversationId,
        createdAt: { gte: new Date(Date.now() - CONTINUIDAD_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { slots: true },
    });

    const heredados = reciente
      ? soloDatos(reciente.slots as Record<string, unknown>)
      : {};

    const ticket = await this.prisma.ticket.create({
      data: {
        conversationId: input.conversationId,
        contactId: input.contactId,
        organizationId: input.organizationId ?? null,
        subject: input.subject.slice(0, 120),
        priority: input.priority,
        slots: { ...heredados, ...(input.slots ?? {}) } as Prisma.InputJsonValue,
        slaDueAt: new Date(Date.now() + TTL_MS),
      },
    });

    await this.record(ticket.id, 'creado', 'bot', { subject: ticket.subject });
    return ticket;
  }

  /**
   * Escalar es UNA operación: cambia estado, sube nivel, asigna y deja rastro.
   * Nunca se avisa a un humano sin mover el estado; un aviso suelto es un
   * ticket que nadie sabe que existe.
   */
  async escalate(
    ticketId: string,
    reason: EscalationReason,
    assignedToWaId: string | null,
  ): Promise<Ticket> {
    const level = ESCALATION_LEVEL[reason];

    const ticket = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { state: 'EN_REVISION', level, assignedToWaId },
    });

    await this.record(ticketId, 'escalado', 'bot', { reason, level });
    return ticket;
  }

  /**
   * El bot solo cierra lo que resolvió él. Un ticket EN_REVISION lo cierra
   * la persona a la que se le asignó.
   */
  async close(
    ticketId: string,
    closeReason: string,
    actor = 'bot',
  ): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { state: true },
    });
    if (!ticket) return;

    if (ticket.state === 'EN_REVISION' && actor === 'bot') return;

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { state: 'CERRADO', closedAt: new Date(), closeReason },
    });

    await this.record(ticketId, 'estado', actor, { to: 'CERRADO', closeReason });
  }

  /** Reapertura dentro de la ventana; fuera de ella, quien llama abre uno nuevo. */
  async reopen(ticketId: string): Promise<Ticket | null> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket?.closedAt) return null;
    if (Date.now() - ticket.closedAt.getTime() > REOPEN_MS) return null;

    const reopened = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        state: 'ABIERTO',
        priority: 'ALTA',
        closedAt: null,
        closeReason: null,
        slaDueAt: new Date(Date.now() + TTL_MS),
      },
    });

    await this.record(ticketId, 'estado', 'bot', { to: 'ABIERTO', motivo: 'reapertura' });
    return reopened;
  }

  /** Mezcla campos en los slots del ticket sin pisar los que ya estaban. */
  async updateSlots(
    ticketId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { slots: true },
    });
    if (!ticket) return;

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        slots: {
          ...(ticket.slots as Record<string, unknown>),
          ...patch,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * La última entrega registrada en esta conversación.
   *
   * Se lee de la bitácora y no de un campo del ticket porque la bitácora
   * es la que sabe qué se entregó y cuándo; el ticket solo sabe su estado.
   */
  async ultimaEntrega(conversationId: string): Promise<{
    ticketId: string;
    ticketNumber: number;
    documentId: string;
  } | null> {
    const evento = await this.prisma.ticketEvent.findFirst({
      where: {
        type: 'entrega',
        ticket: { conversationId },
      },
      orderBy: { createdAt: 'desc' },
      include: { ticket: { select: { id: true, number: true } } },
    });

    const datos = evento?.data as { documentId?: string } | null;
    if (!evento || !datos?.documentId) return null;

    return {
      ticketId: evento.ticket.id,
      ticketNumber: evento.ticket.number,
      documentId: datos.documentId,
    };
  }

  /** El ticket ABIERTO de la conversación: el que el bot sigue atendiendo. */
  async ticketAbierto(conversationId: string) {
    return this.prisma.ticket.findFirst({
      where: { conversationId, state: 'ABIERTO' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** El ticket más reciente de la conversación, escalado o no. */
  async ultimoTicket(conversationId: string) {
    return this.prisma.ticket.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async record(
    ticketId: string,
    type: string,
    actor: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.ticketEvent.create({
      data: { ticketId, type, actor, data: data as Prisma.InputJsonValue },
    });
  }
}

/**
 * Los datos de la solicitud, sin el rastro de la conversación anterior.
 *
 * Se heredan categoría, periodo, folio y empresa. NO se hereda cuántas
 * preguntas se hicieron ni cuáles: un ticket nuevo empieza con el
 * presupuesto entero, o escalar una vez condenaría a la persona a no poder
 * volver a intentarlo.
 */
function soloDatos(slots: Record<string, unknown>): Record<string, unknown> {
  const { category, period, folio, organizationId } = slots;
  return { category, period, folio, organizationId };
}

const ORDER = { BAJA: 0, MEDIA: 1, ALTA: 2 } as const;

function maxPriority(a: TicketPriority, b: TicketPriority): TicketPriority {
  return ORDER[a] >= ORDER[b] ? a : b;
}
