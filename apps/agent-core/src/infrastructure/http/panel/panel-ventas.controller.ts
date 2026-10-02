import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { DeliveryMode, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../persistence/prisma.service';
import { OutboxDispatcher } from '../../persistence/outbox.dispatcher';
import { DIAS, cuandoEnPalabras, leerHorario } from '../../../application/sales/horario';
import { PanelGuard, ParaEmpresa, type PanelRequest } from './panel.guard';

const MODOS: DeliveryMode[] = ['RECOGER', 'DOMICILIO', 'PAQUETERIA', 'DIGITAL'];

/**
 * Ventas en el panel: configuración, catálogo y pedidos de UNA empresa.
 *
 * El equipo (ADMIN) elige la empresa con ?empresa= o en el cuerpo; un
 * usuario de empresa siempre trabaja sobre la suya, mande lo que mande.
 * Aceptar o rechazar un pedido le avisa al cliente por WhatsApp.
 */
@Controller('panel/api/ventas')
@UseGuards(PanelGuard)
@ParaEmpresa()
export class PanelVentasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxDispatcher,
  ) {}

  /** La empresa sobre la que se trabaja. Para escribir hace falta ADMIN o EMPRESA. */
  private empresa(req: PanelRequest, pedida: string | undefined, escribir: boolean): { id: string; email: string } {
    const u = req.panelUser;
    if (!u) throw new ForbiddenException();
    if (u.role === 'EMPRESA') return { id: u.organizationId!, email: u.email };
    if (escribir && u.role !== 'ADMIN') throw new ForbiddenException('hace falta ser ADMIN');
    if (!pedida) throw new BadRequestException('falta la empresa');
    return { id: pedida, email: u.email };
  }

  // ── Configuración ───────────────────────────────────────────────────

  @Get('config')
  async getConfig(@Req() req: PanelRequest, @Query('empresa') empresa?: string) {
    const { id } = this.empresa(req, empresa, false);
    const s = await this.prisma.salesSettings.findUnique({ where: { organizationId: id } });
    return s ?? {
      organizationId: id, enabled: false, businessType: '', pitch: '', hours: {}, timezone: 'America/Mexico_City',
      deliveryModes: ['RECOGER'], zones: [], prepMinutes: 30, minOrder: 0,
    };
  }

  @Post('config')
  async setConfig(
    @Req() req: PanelRequest,
    @Body() body: {
      organizationId?: string; enabled?: boolean; businessType?: string; pitch?: string; hours?: unknown;
      timezone?: string; deliveryModes?: string[]; zones?: unknown; prepMinutes?: number; minOrder?: number;
    },
  ) {
    const { id } = this.empresa(req, body.organizationId, true);

    const deliveryModes = (body.deliveryModes ?? []).filter((m): m is DeliveryMode => MODOS.includes(m as DeliveryMode));
    if (body.enabled && deliveryModes.length === 0) throw new BadRequestException('elige al menos una forma de entrega');

    const hours = leerHorario(body.hours);
    if (body.enabled && !DIAS.some((d) => (hours[d] ?? []).length > 0)) {
      throw new BadRequestException('captura al menos un día con horario');
    }
    const timezone = body.timezone?.trim() || 'America/Mexico_City';
    try { new Intl.DateTimeFormat('es-MX', { timeZone: timezone }); } catch {
      throw new BadRequestException('zona horaria no válida');
    }

    const zones = (Array.isArray(body.zones) ? body.zones : [])
      .map((z) => (typeof z === 'object' && z !== null ? z as Record<string, unknown> : {}))
      .filter((z) => typeof z.nombre === 'string' && z.nombre.trim())
      .slice(0, 50)
      .map((z) => ({ nombre: String(z.nombre).trim().slice(0, 60), costo: Math.max(0, Math.round(Number(z.costo) || 0)) }));

    const datos = {
      enabled: body.enabled === true,
      businessType: (body.businessType ?? '').trim().slice(0, 120),
      pitch: (body.pitch ?? '').trim().slice(0, 4000),
      hours: hours as Prisma.InputJsonValue,
      timezone,
      deliveryModes,
      zones: zones as Prisma.InputJsonValue,
      prepMinutes: Math.min(24 * 60, Math.max(5, Math.round(Number(body.prepMinutes) || 30))),
      minOrder: Math.max(0, Math.round(Number(body.minOrder) || 0)),
    };

    if (datos.enabled) {
      const org = await this.prisma.organization.findUnique({
        where: { id },
        select: { waLineId: true, _count: { select: { products: { where: { active: true } } } } },
      });
      if (!org?.waLineId) throw new BadRequestException('primero conecta el WhatsApp propio de la empresa: las ventas entran por ahí');
      if (org._count.products === 0) throw new BadRequestException('agrega al menos un producto activo antes de activar las ventas');
    }

    return this.prisma.salesSettings.upsert({
      where: { organizationId: id },
      create: { organizationId: id, ...datos },
      update: datos,
    });
  }

  // ── Catálogo ────────────────────────────────────────────────────────

  @Get('productos')
  async products(@Req() req: PanelRequest, @Query('empresa') empresa?: string) {
    const { id } = this.empresa(req, empresa, false);
    return this.prisma.product.findMany({
      where: { organizationId: id },
      orderBy: [{ active: 'desc' }, { section: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      take: 500,
    });
  }

  @Post('productos')
  async saveProduct(
    @Req() req: PanelRequest,
    @Body() body: {
      organizationId?: string; id?: string; name?: string; description?: string; section?: string;
      price?: number; active?: boolean; availableDays?: string[];
    },
  ) {
    const { id: organizationId } = this.empresa(req, body.organizationId, true);
    const name = body.name?.trim() ?? '';
    const price = Number(body.price);
    if (name.length < 2) throw new BadRequestException('escribe el nombre del producto');
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw new BadRequestException('el precio no es válido');

    const datos = {
      name: name.slice(0, 120),
      description: (body.description ?? '').trim().slice(0, 300),
      section: (body.section ?? '').trim().slice(0, 60),
      priceCents: Math.round(price * 100),
      active: body.active !== false,
      // Todos los días marcados es lo mismo que ninguno: se vende siempre.
      availableDays: (() => {
        const dias = [...new Set((body.availableDays ?? []).filter((d) => (DIAS as readonly string[]).includes(d)))];
        return dias.length === DIAS.length ? [] : dias;
      })(),
    };

    if (body.id) {
      const actual = await this.prisma.product.findUnique({ where: { id: body.id }, select: { organizationId: true } });
      if (!actual || actual.organizationId !== organizationId) throw new BadRequestException('no existe ese producto');
      return this.prisma.product.update({ where: { id: body.id }, data: datos });
    }
    return this.prisma.product.create({ data: { ...datos, organizationId } });
  }

  // ── Pedidos ─────────────────────────────────────────────────────────

  @Get('pedidos')
  async orders(@Req() req: PanelRequest, @Query('empresa') empresa?: string, @Query('estado') estado?: string) {
    const { id } = this.empresa(req, empresa, false);
    const status: Prisma.OrderWhereInput['status'] =
      estado === 'armando' ? 'ARMANDO'
        : estado === 'cerrados' ? { in: ['ENTREGADO', 'RECHAZADO', 'CANCELADO'] }
          : { in: ['POR_ACEPTAR', 'ACEPTADO'] };

    return this.prisma.order.findMany({
      where: {
        organizationId: id,
        status,
        ...(estado === 'armando' ? { updatedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } : {}),
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
      include: { contact: { select: { waId: true, displayName: true } } },
    });
  }

  @Post('pedidos/aceptar')
  async accept(@Req() req: PanelRequest, @Body() body: { organizationId?: string; id?: string; minutos?: number }) {
    const { id: organizationId, email } = this.empresa(req, body.organizationId, true);
    const orden = await this.pedidoDe(organizationId, body.id, ['POR_ACEPTAR']);
    const minutos = Math.min(24 * 60, Math.max(0, Math.round(Number(body.minutos) || 0)));

    const ahora = new Date();
    const eta = orden.scheduledFor && orden.scheduledFor > ahora
      ? orden.scheduledFor
      : new Date(ahora.getTime() + minutos * 60 * 1000);

    await this.prisma.order.update({
      where: { id: orden.id },
      data: { status: 'ACEPTADO', etaAt: eta, decidedBy: email },
    });

    const tz = orden.organization.sales?.timezone ?? 'America/Mexico_City';
    const cuando = cuandoEnPalabras(eta, ahora, tz);
    const llega = orden.deliveryMode === 'DOMICILIO' ? `Llega aproximadamente ${cuando}` : `Estará listo ${cuando}`;
    await this.avisar(orden.conversationId,
      `¡Buenas noticias! ${orden.organization.name} aceptó tu pedido *P-${orden.number}*. ${llega}. ¡Gracias por tu compra!`);
    return { ok: true };
  }

  @Post('pedidos/rechazar')
  async reject(@Req() req: PanelRequest, @Body() body: { organizationId?: string; id?: string; motivo?: string }) {
    const { id: organizationId, email } = this.empresa(req, body.organizationId, true);
    const orden = await this.pedidoDe(organizationId, body.id, ['POR_ACEPTAR', 'ACEPTADO']);
    const motivo = body.motivo?.trim().slice(0, 200) ?? '';
    if (motivo.length < 3) throw new BadRequestException('escribe el motivo: se le dice al cliente');

    await this.prisma.order.update({
      where: { id: orden.id },
      data: { status: 'RECHAZADO', rejectReason: motivo, decidedBy: email },
    });
    await this.avisar(orden.conversationId,
      `Lo siento, ${orden.organization.name} no puede tomar tu pedido *P-${orden.number}*: ${motivo}. ¿Te ayudo a armar otro?`);
    return { ok: true };
  }

  @Post('pedidos/entregado')
  async delivered(@Req() req: PanelRequest, @Body() body: { organizationId?: string; id?: string }) {
    const { id: organizationId, email } = this.empresa(req, body.organizationId, true);
    const orden = await this.pedidoDe(organizationId, body.id, ['ACEPTADO']);
    await this.prisma.order.update({ where: { id: orden.id }, data: { status: 'ENTREGADO', decidedBy: email } });
    return { ok: true };
  }

  private async pedidoDe(organizationId: string, id: string | undefined, estados: OrderStatus[]) {
    if (!id) throw new BadRequestException('falta el pedido');
    const orden = await this.prisma.order.findUnique({
      where: { id },
      include: { organization: { select: { name: true, sales: { select: { timezone: true } } } } },
    });
    if (!orden || orden.organizationId !== organizationId) throw new BadRequestException('no existe ese pedido');
    if (!estados.includes(orden.status)) throw new BadRequestException('ese pedido ya no está en ese paso');
    return orden;
  }

  /** El aviso al cliente sale por el mismo chat (la línea de la empresa). */
  private async avisar(conversationId: string, texto: string): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { chatId: true } });
    if (!conv) return;
    await this.prisma.outboxMessage.create({ data: { chatId: conv.chatId, payload: { kind: 'text', text: texto } } });
    await this.outbox.drain();
  }
}
