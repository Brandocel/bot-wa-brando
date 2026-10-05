import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { separarChat } from '../../../domain/message/linea';
import { PrismaService } from '../../persistence/prisma.service';
import { PanelGuard, ParaEmpresa, type PanelRequest } from './panel.guard';

export type TipoPendiente = 'persona' | 'sin_responder' | 'pedido' | 'factura' | 'documentos';

export interface Pendiente {
  id: string;
  tipo: TipoPendiente;
  /** Quién pide: la persona, el cliente del pedido o el receptor de la factura. */
  quien: string;
  titulo: string;
  empresa: string;
  organizationId: string | null;
  /** Lo que conviene leer antes de decidir (último mensaje, renglones, receptor). */
  detalle: string;
  /** Desde cuándo espera: la lista va de lo más viejo a lo más nuevo. */
  desde: string;
  urgente: boolean;
  ref: Record<string, string | number | null>;
}

const MAX = 60;

/**
 * Pendientes: todo lo que pide que una persona haga algo, en una sola lista.
 *
 * Antes estaba repartido: chats en Conversaciones, pedidos y facturas en
 * Ventas (empresa por empresa), documentos en Cuarentena, y un contador
 * suelto por cada cosa en el encabezado. Aquí se junta, de lo que lleva más
 * tiempo esperando a lo más nuevo. Lo que no pide acción no aparece.
 *
 * Un usuario de empresa ve solo lo de su empresa, y solo pedidos y
 * facturas: las conversaciones y la cuarentena son del equipo.
 */
@Controller('panel/api/pendientes')
@UseGuards(PanelGuard)
@ParaEmpresa()
export class PanelPendientesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async lista(@Req() req: PanelRequest): Promise<{ items: Pendiente[] }> {
    const u = req.panelUser;
    if (!u) throw new ForbiddenException();
    const propia = u.role === 'EMPRESA' ? u.organizationId : null;
    const deEquipo = u.role !== 'EMPRESA';

    const orgs = await this.prisma.organization.findMany({
      where: propia ? { id: propia } : {},
      select: { id: true, name: true, waLineId: true },
    });
    const nombre = new Map(orgs.map((o) => [o.id, o.name]));
    const porLinea = new Map(orgs.filter((o) => o.waLineId).map((o) => [o.waLineId!, o]));
    const items: Pendiente[] = [];
    const ahora = new Date();

    if (deEquipo) {
      const convs = await this.prisma.conversation.findMany({
        where: {
          OR: [{ awaiting: 'AGENTE' }, { awaiting: 'BOT' }, { tickets: { some: { state: 'EN_REVISION' } } }],
        },
        orderBy: { lastInboundAt: 'asc' },
        take: MAX,
        select: {
          chatId: true,
          awaiting: true,
          lastInboundAt: true,
          handoffUntil: true,
          contact: { select: { id: true, displayName: true, waId: true } },
          tickets: {
            where: { state: { not: 'CERRADO' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, number: true, subject: true, state: true, priority: true },
          },
          messages: {
            where: { direction: 'IN' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true },
          },
        },
      });

      // Una fila por persona: el mismo contacto por número y por LID son dos chats.
      const vistos = new Set<string>();
      for (const c of convs) {
        if (vistos.has(c.contact.id)) continue;
        vistos.add(c.contact.id);
        // Alguien ya lo tomó desde el panel: no es pendiente de nadie más.
        if (c.handoffUntil && c.handoffUntil > ahora) continue;

        const t = c.tickets[0];
        const persona = c.awaiting === 'AGENTE' || t?.state === 'EN_REVISION';
        const quien = c.contact.displayName || separarChat(c.contact.waId).chat.replace(/@.*$/, '');
        const linea = separarChat(c.chatId).linea;
        const org = linea ? porLinea.get(linea) : undefined;
        const ultimo = c.messages[0];
        items.push({
          id: 'c:' + c.chatId,
          tipo: persona ? 'persona' : 'sin_responder',
          quien,
          titulo: persona ? `${quien} quiere hablar con alguien` : `${quien} espera respuesta`,
          empresa: org?.name ?? 'Número principal',
          organizationId: org?.id ?? null,
          detalle: (t?.subject && persona ? t.subject : ultimo?.body ?? '').slice(0, 400),
          desde: (ultimo?.createdAt ?? c.lastInboundAt ?? ahora).toISOString(),
          urgente: t?.priority === 'ALTA',
          ref: { chatId: c.chatId, ticketId: t?.id ?? null, ticket: t?.number ?? null },
        });
      }
    }

    const pedidos = await this.prisma.order.findMany({
      where: { status: 'POR_ACEPTAR', ...(propia ? { organizationId: propia } : {}) },
      orderBy: { submittedAt: 'asc' },
      take: MAX,
      include: {
        contact: { select: { displayName: true } },
        organization: { select: { sales: { select: { prepMinutes: true } } } },
      },
    });
    for (const o of pedidos) {
      const renglones = (Array.isArray(o.items) ? o.items : []) as Array<{ nombre?: string; cantidad?: number; nota?: string | null }>;
      const quien = o.customerName || o.contact.displayName || 'Un cliente';
      items.push({
        id: 'o:' + o.id,
        tipo: 'pedido',
        quien,
        titulo: `${quien.split(' ')[0]} hizo el pedido P-${o.number}`,
        empresa: nombre.get(o.organizationId) ?? '',
        organizationId: o.organizationId,
        detalle: renglones.map((r) => `${r.cantidad && r.cantidad > 1 ? r.cantidad + ' × ' : ''}${r.nombre ?? ''}${r.nota ? ` (${r.nota})` : ''}`).join(', ').slice(0, 400),
        desde: (o.submittedAt ?? o.createdAt).toISOString(),
        urgente: false,
        ref: {
          orderId: o.id, numero: o.number, totalCents: o.totalCents, entrega: o.deliveryMode, programado: o.scheduledFor?.toISOString() ?? null,
          minutos: o.organization.sales?.prepMinutes ?? 30,
        },
      });
    }

    const facturas = await this.prisma.invoice.findMany({
      where: {
        ...(propia ? { organizationId: propia } : {}),
        OR: [{ status: 'POR_APROBAR' }, { status: 'ERROR' }, { status: 'TIMBRANDO', error: { not: null } }],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX,
      include: { order: { select: { number: true } } },
    });
    for (const f of facturas) {
      const r = (f.receptor ?? {}) as { nombre?: string; rfc?: string; usoCfdi?: string };
      const quien = r.nombre || 'Un cliente';
      items.push({
        id: 'f:' + f.id,
        tipo: 'factura',
        quien,
        titulo: f.status === 'POR_APROBAR' ? `${quien} pidió su factura` : f.status === 'ERROR' ? `La factura de ${quien} no salió` : `Revisa la factura de ${quien}`,
        empresa: nombre.get(f.organizationId) ?? '',
        organizationId: f.organizationId,
        detalle: [r.rfc, r.usoCfdi && `uso ${r.usoCfdi}`, f.order && `pedido P-${f.order.number}`].filter(Boolean).join(' · '),
        desde: f.createdAt.toISOString(),
        urgente: f.status !== 'POR_APROBAR',
        ref: { invoiceId: f.id, status: f.status, error: f.error, totalCents: f.totalCents, sandbox: f.sandbox ? 1 : 0 },
      });
    }

    if (deEquipo) {
      const docs = await this.prisma.document.groupBy({
        by: ['organizationId'],
        where: { status: 'QUARANTINE' },
        _count: { _all: true },
        _min: { indexedAt: true },
      });
      for (const d of docs) {
        const n = typeof d._count === 'object' ? d._count._all ?? 0 : 0;
        items.push({
          id: 'd:' + d.organizationId,
          tipo: 'documentos',
          quien: nombre.get(d.organizationId) ?? 'Empresa',
          titulo: `${n} ${n === 1 ? 'documento' : 'documentos'} sin clasificar`,
          empresa: nombre.get(d.organizationId) ?? '',
          organizationId: d.organizationId,
          detalle: 'El bot no supo de quién son o de qué tipo. Hasta que los revises, no los entrega.',
          desde: (d._min?.indexedAt ?? ahora).toISOString(),
          urgente: false,
          ref: { cantidad: n },
        });
      }
    }

    // Lo urgente primero; después, lo que lleva más tiempo esperando.
    items.sort((a, b) => Number(b.urgente) - Number(a.urgente) || a.desde.localeCompare(b.desde));
    return { items };
  }
}
