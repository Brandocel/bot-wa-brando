import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../../config';
import { QueueService } from '../queue/queue.service';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Puerta de entrada. Su único trabajo: autenticar, encolar y devolver 200.
 *
 * Nada de procesar aquí. Si este handler tarda, open-wa acumula reintentos
 * y termina reentregando el mismo mensaje varias veces.
 */
@Controller('webhooks')
export class WaWebhookController {
  constructor(private readonly queue: QueueService) {}

  @Post('wa')
  @HttpCode(200)
  async receive(
    @Headers('x-gateway-key') key: string | undefined,
    @Body() body: { event?: string; payload?: Record<string, unknown> },
  ): Promise<{ ok: true }> {
    if (!safeEqual(key ?? '', config.gatewayApiKey)) {
      throw new UnauthorizedException();
    }

    if (body.event !== 'message' || !body.payload) {
      // Eventos que todavía no manejamos: se aceptan y se ignoran, para que
      // el gateway no los reintente en vano.
      return { ok: true };
    }

    await this.queue.enqueueIncoming({ raw: body.payload });
    return { ok: true };
  }
}
