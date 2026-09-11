import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { InvalidPhoneError } from '../../domain/contact/phone';
import { DirectoryService } from '../support/directory.service';
import { TicketAssignmentService } from '../support/ticket-assignment.service';
import { TicketService } from '../support/ticket.service';

/**
 * Alta, baja y reparto de agentes de soporte. Solo para el dueño.
 *
 * El número se normaliza y se verifica contra WhatsApp igual que los
 * miembros del directorio: un agente guardado con el formato equivocado
 * es un agente al que nunca le llega ningún aviso, y el síntoma sería
 * "los tickets se escalan y nadie se entera".
 */
@Injectable()
export class AgentAdminCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryService,
    private readonly tickets: TicketService,
    private readonly assignment: TicketAssignmentService,
  ) {}

  /** /agente <nombre> | <teléfono> */
  async alta(args: string): Promise<string> {
    const [nombre, telefono] = args.split('|').map((s) => s.trim());
    if (!nombre || !telefono) {
      return 'Uso: /agente <nombre> | <teléfono>\nEjemplo: /agente Paula | 998 486 2017';
    }

    let resolved;
    try {
      resolved = await this.directory.resolveWaId(telefono);
    } catch (err) {
      if (err instanceof InvalidPhoneError) return err.message;
      throw err;
    }

    const agente = await this.prisma.supportAgent.upsert({
      where: { waId: resolved.waId },
      create: { waId: resolved.waId, name: nombre },
      // Dar de alta a alguien que ya estaba lo reactiva y le corrige el
      // nombre: es la operación normal cuando alguien vuelve al equipo.
      update: { name: nombre, active: true },
    });

    const aviso = resolved.unverified
      ? '\n(No pude verificarlo contra WhatsApp; si no le llegan avisos, revisa el número.)'
      : !resolved.exists
        ? '\n⚠️ WhatsApp dice que ese número no tiene cuenta. Revísalo.'
        : '';

    return `✅ ${agente.name} (${resolved.display}) recibe tickets desde ahora.${aviso}`;
  }

  /** /agente-baja <teléfono> */
  async baja(args: string): Promise<string> {
    if (!args.trim()) return 'Uso: /agente-baja <teléfono>';

    let resolved;
    try {
      resolved = await this.directory.resolveWaId(args);
    } catch (err) {
      if (err instanceof InvalidPhoneError) return err.message;
      throw err;
    }

    const agente = await this.prisma.supportAgent.findUnique({
      where: { waId: resolved.waId },
    });
    if (!agente) return `${resolved.display} no está dado de alta como agente.`;

    await this.prisma.supportAgent.update({
      where: { id: agente.id },
      data: { active: false },
    });

    // Lo que tenía pendiente se reparte entre los demás, para que no se
    // quede huérfano con la baja.
    const pendientes = await this.prisma.ticket.findMany({
      where: { assignedToWaId: agente.waId, state: 'EN_REVISION' },
      select: { id: true, number: true },
    });

    const repartidos: string[] = [];
    for (const ticket of pendientes) {
      const nuevo = await this.assignment.asignar(ticket.id, 'reasignado');
      repartidos.push(
        nuevo ? `#${ticket.number} → ${nuevo.name}` : `#${ticket.number} sin asignar`,
      );
    }

    return [
      `${agente.name} ya no recibe tickets.`,
      ...(repartidos.length > 0 ? ['Se repartieron:', ...repartidos] : []),
    ].join('\n');
  }

  /** /agentes */
  async lista(): Promise<string> {
    const agentes = await this.prisma.supportAgent.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { tickets: { where: { state: 'EN_REVISION' } } } },
      },
    });

    if (agentes.length === 0) {
      return 'No hay agentes. Da de alta uno con /agente <nombre> | <teléfono>.';
    }

    return [
      'Agentes de soporte:',
      ...agentes.map(
        (a) =>
          `${a.active ? '🟢' : '⚫'} ${a.name} · ${a.waId.split('@')[0]} · ${a._count.tickets} en revisión`,
      ),
    ].join('\n');
  }

  /** /asignar <número de ticket> <teléfono> */
  async asignar(args: string): Promise<string> {
    const [numeroRaw, ...resto] = args.trim().split(/\s+/);
    const numero = Number(numeroRaw);
    const telefono = resto.join(' ');

    if (!Number.isInteger(numero) || numero <= 0 || !telefono) {
      return 'Uso: /asignar <número de ticket> <teléfono del agente>';
    }

    const ticket = await this.prisma.ticket.findUnique({ where: { number: numero } });
    if (!ticket) return `No existe el ticket #${numero}.`;
    if (ticket.state === 'CERRADO') return `El ticket #${numero} ya está cerrado.`;

    let resolved;
    try {
      resolved = await this.directory.resolveWaId(telefono);
    } catch (err) {
      if (err instanceof InvalidPhoneError) return err.message;
      throw err;
    }

    if (ticket.state === 'ABIERTO') {
      await this.tickets.escalate(ticket.id, 'pidio_humano', resolved.waId);
    }

    try {
      const agente = await this.assignment.asignarA(
        ticket.id,
        resolved.waId,
        'pidio_humano',
        'owner',
      );
      return `Ticket #${numero} asignado a ${agente.name}; ya tiene el aviso.`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
}
