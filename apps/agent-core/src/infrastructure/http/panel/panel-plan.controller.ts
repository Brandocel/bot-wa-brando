import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PlanService } from '../../../application/plan/plan.service';
import { PanelGuard, ParaEmpresa, type PanelRequest } from './panel.guard';

/**
 * El plan de una cuenta en el panel. La persona ve el suyo y saca su liga;
 * del equipo, solo un ADMIN genera ligas, da el mes gratis o cancela.
 */
@Controller('panel/api/plan')
@UseGuards(PanelGuard)
@ParaEmpresa()
export class PanelPlanController {
  constructor(private readonly plan: PlanService) {}

  private cuenta(req: PanelRequest, pedida: string | undefined, escribir: boolean): string {
    const u = req.panelUser;
    if (!u) throw new ForbiddenException();
    if (u.role === 'EMPRESA') return u.organizationId!;
    if (escribir && u.role !== 'ADMIN') throw new ForbiddenException('hace falta ser ADMIN');
    if (!pedida) throw new BadRequestException('falta la empresa');
    return pedida;
  }

  private async intentar<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  @Get()
  ver(@Req() req: PanelRequest, @Query('empresa') empresa?: string) {
    return this.plan.vista(this.cuenta(req, empresa, false));
  }

  @Post('liga')
  liga(@Req() req: PanelRequest, @Body() body: { empresa?: string; conFactura?: boolean; email?: string }) {
    const id = this.cuenta(req, body.empresa, true);
    return this.intentar(async () => ({ url: await this.plan.crearLiga(id, !!body.conFactura, body.email?.trim()) }));
  }

  /** Mes gratis de la prueba piloto. Solo el equipo: una persona no se lo da a sí misma. */
  @Post('prueba')
  prueba(@Req() req: PanelRequest, @Body() body: { empresa?: string; desde?: string }) {
    if (req.panelUser?.role !== 'ADMIN') throw new ForbiddenException('hace falta ser ADMIN');
    const id = this.cuenta(req, body.empresa, true);
    // "2026-10-15" se toma como ese día a mediodía en México, no a medianoche UTC.
    const desde = body.desde ? new Date(`${body.desde}T12:00:00-06:00`) : new Date();
    return this.intentar(async () => {
      await this.plan.darPrueba(id, desde);
      return { ok: true };
    });
  }

  @Post('cancelar')
  cancelar(@Req() req: PanelRequest, @Body() body: { empresa?: string }) {
    const id = this.cuenta(req, body.empresa, true);
    return this.intentar(async () => {
      await this.plan.cancelar(id);
      return { ok: true };
    });
  }
}

/**
 * Cuántos pagan y cuánto entró, de todas las cuentas. Solo el equipo: sin
 * @ParaEmpresa, el guard se lo niega a un usuario de empresa.
 */
@Controller('panel/api/cobros')
@UseGuards(PanelGuard)
export class PanelCobrosController {
  constructor(private readonly plan: PlanService) {}

  @Get()
  resumen() {
    return this.plan.resumen();
  }
}
