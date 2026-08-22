import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

/**
 * open-wa reentrega mensajes (reconexiones, refresh de Chromium) y la cola
 * reintenta jobs. Sin esto, un mismo mensaje se contesta dos o tres veces.
 *
 * La llave de idempotencia es el messageId de WhatsApp, que además es la PK
 * de la tabla Message: la base es la fuente de verdad, no un caché en RAM.
 */
@Injectable()
export class IdempotencyFilter implements MessageFilter {
  readonly name = 'IdempotencyFilter';

  constructor(private readonly prisma: PrismaService) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    const seen = await this.prisma.message.findUnique({
      where: { id: ctx.message.id },
      select: { id: true },
    });

    if (seen) {
      return stop(ctx, this.name, 'mensaje ya procesado');
    }

    await next();
  }
}
