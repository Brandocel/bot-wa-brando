import { Injectable } from '@nestjs/common';
import { VozService } from '../../../infrastructure/voz/voz.service';
import { type MessageFilter, type Next, type PipelineContext } from '../pipeline';

/**
 * Una nota de voz se vuelve texto antes de que nadie la lea: desde aquí
 * el resto del flujo la trata como si la hubieran escrito, y marca que
 * llegó en voz (para contestar también con voz en documentos).
 *
 * Si no se puede transcribir (sin llave, o falló), el audio sigue como
 * audio y cada flujo pide el mensaje por escrito, como antes.
 */
@Injectable()
export class TranscripcionFilter implements MessageFilter {
  readonly name = 'TranscripcionFilter';

  constructor(private readonly voz: VozService) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    const { message } = ctx;
    const audio = message.attachment;
    if (message.kind === 'AUDIO' && audio?.mimetype.startsWith('audio/')) {
      const texto = await this.voz.transcribir(audio);
      if (texto) {
        ctx.message = { ...message, kind: 'TEXT', body: texto, esVoz: true, attachment: null };
      }
    }
    await next();
  }
}
