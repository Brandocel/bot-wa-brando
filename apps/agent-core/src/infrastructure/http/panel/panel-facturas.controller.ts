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
import type { InvoiceStatus } from '@prisma/client';
import { FacturacionService, type ConfigFacturacion } from '../../../application/facturacion/facturacion.service';
import { FORMAS_PAGO, MOTIVOS_CANCELACION, REGIMENES, USOS_CFDI } from '../../../application/facturacion/catalogos';
import type { Receptor } from '../../../application/facturacion/validacion';
import { PrismaService } from '../../persistence/prisma.service';
import { PanelGuard, ParaEmpresa, type PanelRequest } from './panel.guard';

/**
 * Facturación en el panel: configuración de Factura.com y las facturas de
 * UNA empresa. Aquí es donde la empresa aprueba lo que el bot armó.
 *
 * Mismas reglas que Ventas: un usuario de empresa solo ve la suya; el
 * equipo elige con ?empresa= y solo un ADMIN escribe.
 */
@Controller('panel/api/facturas')
@UseGuards(PanelGuard)
@ParaEmpresa()
export class PanelFacturasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
  ) {}

  private empresa(req: PanelRequest, pedida: string | undefined, escribir: boolean): { id: string; email: string } {
    const u = req.panelUser;
    if (!u) throw new ForbiddenException();
    if (u.role === 'EMPRESA') return { id: u.organizationId!, email: u.email };
    if (escribir && u.role !== 'ADMIN') throw new ForbiddenException('hace falta ser ADMIN');
    if (!pedida) throw new BadRequestException('falta la empresa');
    return { id: pedida, email: u.email };
  }

  /** Los errores del servicio ya vienen en palabras para el panel. */
  private async intentar<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  @Get('catalogos')
  catalogos() {
    return { regimenes: REGIMENES, usos: USOS_CFDI, formasPago: FORMAS_PAGO, motivosCancelacion: MOTIVOS_CANCELACION };
  }

  // ── Configuración ───────────────────────────────────────────────────

  @Get('config')
  async getConfig(@Req() req: PanelRequest, @Query('empresa') empresa?: string) {
    const { id } = this.empresa(req, empresa, false);
    return this.facturacion.verConfig(id);
  }

  @Post('config')
  async setConfig(@Req() req: PanelRequest, @Body() body: ConfigFacturacion & { organizationId?: string }) {
    const { id } = this.empresa(req, body.organizationId, true);
    return this.intentar(() => this.facturacion.guardarConfig(id, body));
  }

  /** Prueba las llaves contra Factura.com y regresa las series para elegir. */
  @Post('probar')
  async probar(@Req() req: PanelRequest, @Body() body: { organizationId?: string }) {
    const { id } = this.empresa(req, body.organizationId, true);
    return this.intentar(() => this.facturacion.probarConexion(id));
  }

  // ── Facturas ────────────────────────────────────────────────────────

  @Get()
  async lista(@Req() req: PanelRequest, @Query('empresa') empresa?: string, @Query('estado') estado?: string) {
    const { id } = this.empresa(req, empresa, false);
    const status: InvoiceStatus[] =
      estado === 'timbradas' ? ['TIMBRADA']
        : estado === 'cerradas' ? ['CANCELADA', 'RECHAZADA']
          : ['POR_APROBAR', 'TIMBRANDO', 'ERROR'];
    return this.prisma.invoice.findMany({
      where: { organizationId: id, status: { in: status } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: { select: { number: true } },
        contact: { select: { waId: true, displayName: true } },
      },
    });
  }

  /** Arma una factura desde el panel (cuando el cliente mandó sus datos por otro lado). */
  @Post('crear')
  async crear(
    @Req() req: PanelRequest,
    @Body() body: { organizationId?: string; orderId?: string; receptor?: Receptor; formaPago?: string; metodoPago?: 'PUE' | 'PPD' },
  ) {
    const { id } = this.empresa(req, body.organizationId, true);
    if (!body.orderId || !body.receptor || !body.formaPago) throw new BadRequestException('faltan el pedido, los datos fiscales o la forma de pago');
    const orden = await this.prisma.order.findUnique({ where: { id: body.orderId }, select: { organizationId: true, contactId: true } });
    if (!orden || orden.organizationId !== id) throw new BadRequestException('no existe ese pedido');
    const r = await this.facturacion.proponer({
      organizationId: id,
      contactId: orden.contactId,
      orderId: body.orderId,
      receptor: body.receptor,
      formaPago: body.formaPago,
      metodoPago: body.metodoPago,
      origen: 'MANUAL',
    });
    if (!r.ok) throw new BadRequestException(r.errores.join(' '));
    return r.factura;
  }

  @Post('aprobar')
  async aprobar(@Req() req: PanelRequest, @Body() body: { organizationId?: string; id?: string }) {
    const { id, email } = this.empresa(req, body.organizationId, true);
    if (!body.id) throw new BadRequestException('falta la factura');
    return this.intentar(() => this.facturacion.aprobar(id, body.id!, email));
  }

  @Post('rechazar')
  async rechazar(@Req() req: PanelRequest, @Body() body: { organizationId?: string; id?: string; motivo?: string }) {
    const { id, email } = this.empresa(req, body.organizationId, true);
    const motivo = body.motivo?.trim().slice(0, 300) ?? '';
    if (!body.id) throw new BadRequestException('falta la factura');
    if (motivo.length < 3) throw new BadRequestException('escribe el motivo: se le dice al cliente');
    await this.intentar(() => this.facturacion.rechazar(id, body.id!, motivo, email));
    return { ok: true };
  }

  /** Se quedó en "timbrando" y ya se revisó en Factura.com que no salió. */
  @Post('liberar')
  async liberar(@Req() req: PanelRequest, @Body() body: { organizationId?: string; id?: string }) {
    const { id, email } = this.empresa(req, body.organizationId, true);
    if (!body.id) throw new BadRequestException('falta la factura');
    await this.intentar(() => this.facturacion.liberar(id, body.id!, email));
    return { ok: true };
  }

  @Post('cancelar')
  async cancelar(
    @Req() req: PanelRequest,
    @Body() body: { organizationId?: string; id?: string; motivo?: string; sustituto?: string },
  ) {
    const { id, email } = this.empresa(req, body.organizationId, true);
    if (!body.id || !body.motivo) throw new BadRequestException('faltan la factura o el motivo');
    return this.intentar(() => this.facturacion.cancelar(id, body.id!, body.motivo!, body.sustituto?.trim() || null, email));
  }

  @Post('reenviar')
  async reenviar(@Req() req: PanelRequest, @Body() body: { organizationId?: string; id?: string }) {
    const { id } = this.empresa(req, body.organizationId, true);
    const f = await this.prisma.invoice.findUnique({ where: { id: body.id ?? '' } });
    if (!f || f.organizationId !== id || f.status !== 'TIMBRADA') throw new BadRequestException('solo se reenvía una factura timbrada');
    await this.intentar(() => this.facturacion.entregar(f));
    return { ok: true };
  }
}
