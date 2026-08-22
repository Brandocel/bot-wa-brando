import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

const WINDOW_MS = 60_000;
const MAX_REPLIES_PER_WINDOW = 5;

/**
 * Cortacircuitos anti-bucle.
 *
 * El gateway usa onAnyMessage, así que nos reenvía también lo que el bot
 * acaba de enviar. La defensa principal es el IdempotencyFilter (guardamos
 * el messageId de cada mensaje saliente), pero eso depende de que open-wa
 * devuelva el mismo id con el que luego reentrega — y no quiero apostar mi
 * chat personal a esa suposición.
 *
 * Esto es el seguro de vida: pase lo que pase, el bot no manda más de 5
 * mensajes por minuto al mismo chat. Un bucle infinito en tu propio WhatsApp
 * es la clase de bug que además te gana un ban.
 */
@Injectable()
export class LoopGuardFilter implements MessageFilter {
  readonly name = 'LoopGuardFilter';
  private readonly logger = new Logger(LoopGuardFilter.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { chatId: ctx.message.chatId },
      select: { id: true },
    });

    if (conversation) {
      const recentReplies = await this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          direction: 'OUT',
          createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
        },
      });

      if (recentReplies >= MAX_REPLIES_PER_WINDOW) {
        this.logger.warn(
          `posible bucle en ${ctx.message.chatId}: ${recentReplies} respuestas en 60s`,
        );
        return stop(ctx, this.name, 'límite de respuestas por minuto');
      }
    }

    await next();
  }
}
