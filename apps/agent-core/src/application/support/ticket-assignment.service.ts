import { Injectable, Logger } from '@nestjs/common';
import type { DocCategory, SupportAgent } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { EscalationReason } from './ticket.service';

/**
 * Reparto de tickets escalados entre los agentes de soporte, y el aviso.
 *
 * Es programático a propósito: nadie tiene que estar mirando el panel para
 * que un ticket llegue a alguien. Al escalar, se elige al agente activo
 * con menos tickets en revisión —a igual carga, el que lleva más tiempo
 * sin recibir uno— y se le manda por WhatsApp un resumen con el enlace al
 * chat del cliente para retomar la conversación desde su propio teléfono.
 *
 * El aviso sale por el outbox, no directo: si el gateway está caído en ese
 * momento, el mensaje espera en la base en vez de perderse. Y sin agentes
 * dados de alta el ticket queda EN_REVISION sin asignar, visible en el
 * panel, que es lo que pasaba antes de que existiera esta clase.
 */

/** Cómo se le explica al agente por qué le llegó el ticket. */
const MOTIVOS: Record<EscalationReason, string> = {
  sin_resultados: 'no se encontró el documento que pidió',
  sin_permiso: 'pidió algo fuera de lo que puede consultar',
  pidio_humano: 'pidió hablar con una persona',
  slots_incompletos: 'el bot no logró entender qué necesita',
  molesto: 'el cliente se nota molesto',
  sla_vencido: 'lleva demasiado tiempo sin que nadie lo atienda',
  tema_sensible: 'es un tema delicado',
  reasignado: 'lo tenía otro agente que ya no está disponible',
};

const NOMBRES: Record<DocCategory, string> = {
  FACTURA: 'factura',
  CONTRATO: 'contrato',
  COTIZACION: 'cotización',
  REPORTE: 'reporte',
  POLIZA: 'póliza',
  OTRO: 'documento',
};

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface AssignedAgent {
  waId: string;
  name: string;
}

@Injectable()
export class TicketAssignmentService {
  private readonly logger = new Logger(TicketAssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asigna el ticket al agente con menos carga y le avisa.
   *
   * Devuelve null si no hay ningún agente activo: el ticket se queda sin
   * asignar y quien llama sigue igual. Nunca lanza por esto — un escalado
   * que revienta porque no hay a quién avisar dejaría al cliente sin la
   * respuesta de "ya lo pasé al equipo", que es lo único que le importa.
   */
  async asignar(
    ticketId: string,
    reason: EscalationReason,
  ): Promise<AssignedAgent | null> {
    const agente = await this.elegir();
    if (!agente) {
      this.logger.warn(`ticket ${ticketId} escalado sin agentes activos a quien asignar`);
      return null;
    }

    return this.asignarA(ticketId, agente, reason, 'bot');
  }

  /**
   * Asigna (o reasigna) a un agente concreto. Para /asignar y /tomar.
   *
   * Lanza si el número no corresponde a un agente activo: aquí sí es un
   * error del operador, y tiene que enterarse.
   */
  async asignarA(
    ticketId: string,
    agente: SupportAgent | string,
    reason: EscalationReason,
    actor: string,
  ): Promise<AssignedAgent> {
    const elegido =
      typeof agente === 'string'
        ? await this.prisma.supportAgent.findFirst({
            where: { waId: agente, active: true },
          })
        : agente;

    if (!elegido) {
      throw new Error(`${String(agente)} no es un agente de soporte activo.`);
    }

    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: { assignedToWaId: elegido.waId },
      }),
      this.prisma.supportAgent.update({
        where: { id: elegido.id },
        data: { lastAssignedAt: new Date() },
      }),
      this.prisma.ticketEvent.create({
        data: {
          ticketId,
          type: 'asignado',
          actor,
          data: { agente: elegido.name, waId: elegido.waId, reason },
        },
      }),
    ]);

    await this.avisar(ticketId, elegido, MOTIVOS[reason]);

    return { waId: elegido.waId, name: elegido.name };
  }

  /**
   * Recordatorio cuando un ticket asignado venció su SLA. Si nadie lo
   * tenía, se reparte ahora: que haya vencido sin dueño es exactamente el
   * caso en el que más urge que alguien lo vea.
   */
  async recordarVencido(ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { assignedTo: true },
    });

    if (!ticket) return;

    if (!ticket.assignedTo || !ticket.assignedTo.active) {
      await this.asignar(ticketId, 'sla_vencido');
      return;
    }

    await this.avisar(ticketId, ticket.assignedTo, MOTIVOS.sla_vencido);
  }

  /**
   * El agente activo con menos tickets en revisión; a igual carga, el que
   * lleva más tiempo sin recibir uno. Es un round-robin que respeta la
   * carga real: alguien que cerró rápido sus tres tickets vuelve a estar
   * primero en la fila.
   */
  private async elegir(): Promise<SupportAgent | null> {
    const agentes = await this.prisma.supportAgent.findMany({
      where: { active: true },
      include: {
        _count: { select: { tickets: { where: { state: 'EN_REVISION' } } } },
      },
    });

    if (agentes.length === 0) return null;

    agentes.sort((a, b) => {
      const carga = a._count.tickets - b._count.tickets;
      if (carga !== 0) return carga;

      const ta = a.lastAssignedAt?.getTime() ?? 0;
      const tb = b.lastAssignedAt?.getTime() ?? 0;
      return ta - tb;
    });

    return agentes[0]!;
  }

  /**
   * El mensaje que recibe el agente en su WhatsApp.
   *
   * Lleva lo que necesita para retomar sin abrir el panel: quién es el
   * cliente, qué pedía, por qué llegó hasta aquí, lo último que escribió
   * y el enlace directo a su chat. Y cómo cerrar el ticket desde ahí mismo.
   */
  private async avisar(
    ticketId: string,
    agente: SupportAgent,
    motivo: string,
  ): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        contact: { select: { waId: true, displayName: true } },
        organization: { select: { name: true } },
        conversation: {
          select: {
            messages: {
              where: { direction: 'IN' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { body: true },
            },
          },
        },
      },
    });

    if (!ticket) return;

    const slots = (ticket.slots ?? {}) as Record<string, unknown>;
    const empresa =
      ticket.organization?.name ??
      (typeof slots.organizationId === 'string'
        ? (
            await this.prisma.organization.findUnique({
              where: { id: slots.organizationId },
              select: { name: true },
            })
          )?.name
        : null) ??
      'empresa sin identificar';

    const telefono = digitosDe(ticket.contact.waId);
    const cliente = ticket.contact.displayName
      ? `${ticket.contact.displayName}${telefono ? ` (+${telefono})` : ''}`
      : telefono
        ? `+${telefono}`
        : ticket.contact.waId;

    const ultimo = ticket.conversation.messages[0]?.body?.trim();

    const texto = [
      `🎫 Ticket #${ticket.number} — ${empresa}`,
      `Cliente: ${cliente}`,
      `Pidió: ${describirPedido(slots) ?? ticket.subject}`,
      `Motivo: ${motivo}.`,
      ...(ultimo ? [`Último mensaje: "${recortar(ultimo)}"`] : []),
      '',
      telefono
        ? `Retoma el chat: https://wa.me/${telefono}`
        : 'Este cliente no tiene número visible; ábrelo desde el panel.',
      `Cuando quede resuelto: /cerrar ${ticket.number}`,
    ].join('\n');

    await this.prisma.outboxMessage.create({
      data: { chatId: agente.waId, payload: { kind: 'text', text: texto } },
    });
  }
}

/** "5219984862017@c.us" → "5219984862017". Un LID no es un número: null. */
function digitosDe(waId: string): string | null {
  const match = /^(\d{7,15})@(c\.us|s\.whatsapp\.net)$/.exec(waId);
  return match ? match[1]! : null;
}

function describirPedido(slots: Record<string, unknown>): string | null {
  if (typeof slots.folio === 'string') return `documento con folio ${slots.folio}`;

  const category =
    typeof slots.category === 'string' && slots.category in NOMBRES
      ? NOMBRES[slots.category as DocCategory]
      : null;
  if (!category) return null;

  const period = typeof slots.period === 'string' ? new Date(slots.period) : null;
  const mes =
    period && !Number.isNaN(period.getTime())
      ? ` de ${MESES[period.getUTCMonth()]} de ${period.getUTCFullYear()}`
      : '';

  return `${category}${mes}`;
}

function recortar(text: string): string {
  const limpio = text.replace(/\s+/g, ' ');
  return limpio.length > 140 ? `${limpio.slice(0, 140)}…` : limpio;
}
