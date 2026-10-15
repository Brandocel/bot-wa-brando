import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { separarChat } from '../../../domain/message/linea';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

/**
 * Qué chats se atienden en la línea de una empresa o persona.
 *
 * - EMPRESA: sus clientes, nunca su chat propio (ahí el dueño se escribe
 *   a sí mismo y no le habla al bot).
 * - PERSONA: es su WhatsApp personal. El bot vive SOLO en su chat propio;
 *   lo que le escriban sus contactos es suyo y ni se contesta ni se guarda.
 */
@Injectable()
export class LineaPropiaFilter implements MessageFilter {
  readonly name = 'LineaPropiaFilter';

  constructor(private readonly prisma: PrismaService) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    const { linea } = separarChat(ctx.message.chatId);
    if (!linea) return next();

    const org = await this.prisma.organization.findUnique({
      where: { waLineId: linea },
      select: { kind: true },
    });
    const propio = ctx.message.isLineSelfChat === true;

    if (org?.kind === 'PERSONA') {
      if (!propio) return stop(ctx, this.name, 'línea personal: chat de un contacto');
    } else if (propio) {
      return stop(ctx, this.name, 'chat propio de la empresa');
    }

    await next();
  }
}
