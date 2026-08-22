import { Injectable } from '@nestjs/common';
import { FlagsService } from '../../../infrastructure/persistence/flags.service';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

/**
 * El interruptor de emergencia.
 *
 * Cuando el bot está en pausa nadie recibe respuesta automática — EXCEPTO yo,
 * porque si el asistente personal también se callara no habría forma de mandar
 * `/reanuda` y el bot quedaría apagado hasta entrar al servidor a mano.
 *
 * Va después de Authorization justamente para poder distinguir quién escribe.
 */
@Injectable()
export class KillSwitchFilter implements MessageFilter {
  readonly name = 'KillSwitchFilter';

  constructor(private readonly flags: FlagsService) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    if (ctx.role === 'OWNER') return next();

    if (await this.flags.isPaused()) {
      return stop(ctx, this.name, 'bot en pausa');
    }

    await next();
  }
}
