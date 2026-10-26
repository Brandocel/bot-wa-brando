import { Inject, Injectable, Optional } from '@nestjs/common';
import { MESSAGING_PORT, type MessagingPort } from '../../ports/messaging.port';
import { PistasVozService } from '../../support/pistas-voz.service';
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

  constructor(
    private readonly voz: VozService,
    @Optional() @Inject(MESSAGING_PORT) private readonly messaging?: MessagingPort,
    @Optional() private readonly pistas?: PistasVozService,
  ) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    const { message } = ctx;
    const audio = message.attachment;
    // Sin la herramienta Voz, el audio sigue como audio y se pide por escrito.
    if (message.kind === 'AUDIO' && (!this.pistas || (await this.pistas.vozPermitida(message.chatId)))) {
      // Con los nombres de la cuenta como pistas. Primero Groq si hay llave
      // (modelo grande, el más acertado); si no, whisper local en el
      // gateway, que es gratis.
      const esAudio = audio?.mimetype.startsWith('audio/') ? audio : null;
      const pistas = esAudio ? ((await this.pistas?.para(message.chatId)) ?? '') : '';
      const texto =
        message.transcripcion ??
        (esAudio ? await this.voz.transcribir(esAudio, pistas) : null) ??
        (esAudio && this.messaging?.transcribir ? await this.messaging.transcribir(esAudio, pistas) : null);
      if (texto) {
        ctx.message = { ...message, kind: 'TEXT', body: texto, esVoz: true, attachment: null };
      }
    }
    await next();
  }
}
