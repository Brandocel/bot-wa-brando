import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PlanService } from '../../../application/plan/plan.service';
import { PanelGuard, ParaEmpresa, type PanelRequest } from './panel.guard';

/**
 * El plan de una cuenta en el panel. La persona ve el suyo y saca su liga;
 * del equipo, solo un ADMIN genera ligas o cancela.
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

  @Post('cancelar')
  cancelar(@Req() req: PanelRequest, @Body() body: { empresa?: string }) {
    const id = this.cuenta(req, body.empresa, true);
    return this.intentar(async () => {
      await this.plan.cancelar(id);
      return { ok: true };
    });
  }
}
