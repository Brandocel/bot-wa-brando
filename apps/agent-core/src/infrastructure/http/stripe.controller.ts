import { BadRequestException, Controller, Get, Header, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PlanService } from '../../application/plan/plan.service';
import { config } from '../../config';
import { firmaValida } from '../pagos/stripe.client';

/**
 * Lo que Stripe ve de nosotros: el webhook firmado y las dos páginas a las
 * que regresa a quien paga.
 */
@Controller()
export class StripeController {
  private readonly log = new Logger(StripeController.name);

  constructor(private readonly plan: PlanService) {}

  @Post('stripe/webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    const secreto = config.stripe.webhookSecret;
    if (!secreto || !req.rawBody) throw new BadRequestException('webhook apagado');
    if (!firmaValida(req.rawBody, req.header('stripe-signature'), secreto)) {
      throw new BadRequestException('firma inválida');
    }
    const evento = JSON.parse(req.rawBody.toString('utf8'));
    try {
      await this.plan.manejarEvento(evento);
    } catch (err) {
      // Un 500 hace que Stripe lo reintente, que es justo lo que se quiere.
      this.log.error(`${evento.type} ${evento.id}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
    return { ok: true };
  }

  @Get('plan/listo')
  @Header('Content-Type', 'text/html; charset=utf-8')
  listo(): string {
    return pagina('Listo', 'Tu plan quedó activo. Ya puedes volver a WhatsApp.');
  }

  @Get('plan/cancelado')
  @Header('Content-Type', 'text/html; charset=utf-8')
  cancelado(): string {
    return pagina('Sin cargo', 'No se hizo ningún cargo. Puedes usar la liga cuando quieras.');
  }
}

const pagina = (titulo: string, texto: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis · ${titulo}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1412;color:#e8eeeb;font:16px/1.5 system-ui,sans-serif}
  main{padding:24px;text-align:center;max-width:360px}
  h1{margin:0 0 8px;font-size:24px;font-weight:600}
  p{margin:0;color:#9aa8a1}
  b{display:inline-grid;place-items:center;width:48px;height:48px;margin-bottom:16px;border-radius:50%;background:#173d2c;color:#3ddc97;font-size:22px}
</style></head>
<body><main><b>✓</b><h1>${titulo}</h1><p>${texto}</p></main></body></html>`;
