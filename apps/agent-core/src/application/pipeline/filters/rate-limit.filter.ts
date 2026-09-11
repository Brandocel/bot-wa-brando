import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

const WINDOW_MS = 60 * 60 * 1000; // 1 hora
const MAX_REPLIES_PER_CHAT = 30;
const MAX_REPLIES_GLOBAL = 120;

/**
 * Techo de mensajes salientes. Dos defensas distintas:
 *
 *  - Por chat: nadie recibe más de 30 respuestas por hora. Protege contra un
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

        // Un solo aviso, justo al tocar el techo; después, silencio. Sin
        // esto la persona escribía y no pasaba nada, que desde fuera es
        // "el bot se murió" — y lo siguiente que hace es escribir más.
        if (perChat === MAX_REPLIES_PER_CHAT) {
          await this.prisma.outboxMessage.create({
            data: {
              chatId: ctx.message.chatId,
              payload: {
                kind: 'text',
                text: 'Llevamos muchos mensajes seguidos; dame un rato y te sigo atendiendo. Ya quedó marcado para que alguien del equipo lo vea por si es urgente.',
              },
            },
          });

          // Y que el panel lo enseñe como pendiente de una persona: un chat
          // que toca el techo es un chat que un humano tiene que mirar.
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { awaiting: 'AGENTE' },
          });
        }

        return stop(ctx, this.name, 'techo por chat');
      }
    }

    await next();
  }
}
