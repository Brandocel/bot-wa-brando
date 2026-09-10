import { Injectable } from '@nestjs/common';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

/**
 * Primer eslabón, y el más barato: descarta lo que jamás debe recibir respuesta.
 *
 * Sin esto, un bot de eco contesta a los estados de todos tus contactos y te
 * ganas un reporte de spam el primer día.
 */
@Injectable()
export class SourceFilter implements MessageFilter {
  readonly name = 'SourceFilter';

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    const { message } = ctx;

    // El chat "Mensajes contigo mismo" es donde vive el asistente personal, y
    // ahi TODO llega con fromMe: true. Es la unica excepcion: mis mensajes
    // escritos a mano en el chat de un cliente siguen ignorandose, para no
    // meterme cuando yo mismo estoy atendiendo.
    if (message.isFromMe && !message.isSelfChat) {
      return stop(ctx, this.name, 'mensaje propio');
    }

    // Un archivo propio tampoco, ni en el chat propio: es el eco de un
    // documento que el bot acaba de entregar. Si llegara a procesarse, su
    // leyenda ("Ticket #98 — FACTURA...") se leería como una petición nueva
    // y el bot se lo volvería a mandar a sí mismo, en bucle.
    if (message.isFromMe && message.kind !== 'TEXT') {
      return stop(ctx, this.name, 'archivo propio');
    }

    if (message.isBroadcast) {
      return stop(ctx, this.name, 'status/broadcast');
    }

    // Grupos en silencio salvo mención explícita.
    if (message.isGroup && !message.mentionsMe) {
      return stop(ctx, this.name, 'grupo sin mención');
    }

    if (message.kind === 'UNSUPPORTED') {
      return stop(ctx, this.name, 'tipo de mensaje no soportado');
    }

    await next();
  }
}
