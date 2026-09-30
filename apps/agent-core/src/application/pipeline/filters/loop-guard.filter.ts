import { Injectable, Logger } from '@nestjs/common';
import { LimitesService } from '../../../infrastructure/persistence/limites.service';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

const WINDOW_MS = 60_000;

/**
 * Cortacircuitos anti-bucle.
 *
 * El gateway (Baileys) nos reenvía también lo que el bot acaba de enviar.
 * La defensa principal es el IdempotencyFilter (guardamos el messageId de
 * cada mensaje saliente), pero eso depende de que el gateway devuelva el
 * mismo id con el que luego reentrega — y no quiero apostar el número del
 * bot a esa suposición.
 *
 * Esto es el seguro de vida: pase lo que pase, el bot no manda más de N
 * respuestas por minuto al mismo chat (Ajustes del panel). Los documentos
 * no cuentan salvo que así se configure: un lote de facturas no es un
 * bucle, y un bucle se nota en el texto.
 */
@Injectable()
export class LoopGuardFilter implements MessageFilter {
  readonly name = 'LoopGuardFilter';
  private readonly logger = new Logger(LoopGuardFilter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
  ) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { chatId: ctx.message.chatId },
      select: { id: true },
    });

    if (conversation) {
      const limites = await this.limites.actuales();
      const recentReplies = await this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          ...this.limites.salientesQueCuentan(limites),
          createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
        },
      });

      if (recentReplies >= limites.porChatMinuto) {
        this.logger.warn(
          `posible bucle en ${ctx.message.chatId}: ${recentReplies} respuestas en 60s`,
        );
        return stop(ctx, this.name, 'límite de respuestas por minuto');
      }
    }

    await next();
  }
}
