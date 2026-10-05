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
 *
 * También el modo "solo estos números" (/solo): mientras haya lista, a
 * cualquier otro número no se le contesta nada, en ninguna línea. Sirve para
 * probar en producción sin que un desconocido hable con el bot a medias.
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

    const solo = await this.flags.soloNumeros();
    if (solo.length > 0 && !solo.includes(ctx.message.senderId)) {
      return stop(ctx, this.name, 'número fuera de la lista de /solo');
    }

    await next();
  }
}
