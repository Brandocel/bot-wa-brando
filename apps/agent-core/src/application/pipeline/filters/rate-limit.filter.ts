import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

const WINDOW_MS = 60 * 60 * 1000; // 1 hora
const MAX_REPLIES_PER_CHAT = 20;
const MAX_REPLIES_GLOBAL = 120;

/**
 * Techo de mensajes salientes. Dos defensas distintas:
 *
 *  - Por chat: nadie recibe más de 20 respuestas por hora. Protege contra un
 *    contacto que se obsesiona con el bot y contra bucles lentos que el
 *    LoopGuardFilter (5 por minuto) deja pasar.
 *  - Global: si por un bug el bot empieza a contestarle a medio mundo, se
 *    frena solo antes de que WhatsApp lo note. Es lo único que separa un bug
 *    de una cuenta baneada.
 *
 * Corre al final del pipeline: es la consulta más cara y no tiene sentido
 * pagarla por mensajes que ya se iban a descartar antes.
 */
@Injectable()
export class RateLimitFilter implements MessageFilter {
  readonly name = 'RateLimitFilter';
  private readonly logger = new Logger(RateLimitFilter.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    // A mí no me limita: si me estoy pasando, es a propósito.
    if (ctx.role === 'OWNER') return next();

    const since = new Date(Date.now() - WINDOW_MS);

    const [globalCount, conversation] = await Promise.all([
      this.prisma.message.count({
        where: { direction: 'OUT', createdAt: { gte: since } },
      }),
      this.prisma.conversation.findUnique({
        where: { chatId: ctx.message.chatId },
        select: { id: true },
      }),
    ]);

    if (globalCount >= MAX_REPLIES_GLOBAL) {
      this.logger.error(
        `TECHO GLOBAL alcanzado: ${globalCount} respuestas en 1h. Bot silenciado.`,
      );
      return stop(ctx, this.name, 'techo global de envíos');
    }

    if (conversation) {
      const perChat = await this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          direction: 'OUT',
          createdAt: { gte: since },
        },
      });

      if (perChat >= MAX_REPLIES_PER_CHAT) {
        this.logger.warn(
          `${ctx.message.chatId} llegó a ${perChat} respuestas en 1h`,
        );
        return stop(ctx, this.name, 'techo por chat');
      }
    }

    await next();
  }
}
