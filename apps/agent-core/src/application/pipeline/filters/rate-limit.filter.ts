import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../../config';
import { prefijoDeLinea, separarChat } from '../../../domain/message/linea';
import { FlagsService } from '../../../infrastructure/persistence/flags.service';
import { LimitesService } from '../../../infrastructure/persistence/limites.service';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { type MessageFilter, type Next, type PipelineContext, stop } from '../pipeline';

const WINDOW_MS = 60 * 60 * 1000; // 1 hora

/** Cuándo y en qué nivel se avisó al dueño del tope general. */
const CLAVE_AVISO = 'limites.aviso';

/**
 * Techo de mensajes salientes. Dos defensas distintas:
 *
 *  - Por chat: nadie recibe más de N respuestas por hora. Protege contra un
 *    contacto que se obsesiona con el bot y contra bucles lentos que el
 *    LoopGuardFilter deja pasar.
 *  - Global: si por un bug el bot empieza a contestarle a medio mundo, se
 *    frena solo antes de que WhatsApp lo note. Es lo único que separa un bug
 *    de una cuenta baneada.
 *
 * Los números se ajustan en el panel (Ajustes). Al acercarse al tope
 * general, y al llegar, se le avisa al dueño por WhatsApp: un bot que se
 * calla con todos sin que nadie lo sepa es peor que el tope mismo.
 *
 * Corre al final del pipeline: es la consulta más cara y no tiene sentido
 * pagarla por mensajes que ya se iban a descartar antes.
 */
@Injectable()
export class RateLimitFilter implements MessageFilter {
  readonly name = 'RateLimitFilter';
  private readonly logger = new Logger(RateLimitFilter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
    private readonly flags: FlagsService,
  ) {}

  async handle(ctx: PipelineContext, next: Next): Promise<void> {
    // A mí no me limita: si me estoy pasando, es a propósito.
    if (ctx.role === 'OWNER') return next();

    const limites = await this.limites.actuales();
    const since = new Date(Date.now() - WINDOW_MS);

    /**
     * El tope general es POR NÚMERO: WhatsApp restringe números, no bots.
     * Cada línea de empresa lleva su propia cuenta, y el principal la suya;
     * que una empresa tenga un día de mucho tráfico no calla a las demás.
     */
    const linea = separarChat(ctx.message.chatId).linea;
    const deEstaLinea = linea
      ? { conversation: { chatId: { startsWith: prefijoDeLinea(linea) } } }
      : { conversation: { NOT: { chatId: { startsWith: 'linea:' } } } };

    const [globalCount, conversation] = await Promise.all([
      this.prisma.message.count({
        where: { direction: 'OUT', createdAt: { gte: since }, ...deEstaLinea },
      }),
      this.prisma.conversation.findUnique({
        where: { chatId: ctx.message.chatId },
        select: { id: true, contact: { select: { displayName: true } } },
      }),
    ]);

    await this.avisarGlobal(globalCount, limites.globalHora, linea);

    if (globalCount >= limites.globalHora) {
      this.logger.error(
        `TECHO GLOBAL alcanzado: ${globalCount} respuestas en 1h. Bot silenciado.`,
      );
      return stop(ctx, this.name, 'techo global de envíos');
    }

    if (conversation) {
      const perChat = await this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          ...this.limites.salientesQueCuentan(limites),
          createdAt: { gte: since },
        },
      });

      if (perChat >= limites.porChatHora) {
        this.logger.warn(
          `${ctx.message.chatId} llegó a ${perChat} respuestas en 1h`,
        );

        // Un solo aviso, justo al tocar el techo; después, silencio. Sin
        // esto la persona escribía y no pasaba nada, que desde fuera es
        // "el bot se murió" — y lo siguiente que hace es escribir más.
        if (perChat === limites.porChatHora) {
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

          const quien = conversation.contact?.displayName ?? separarChat(ctx.message.chatId).chat.replace(/@.*$/, '');
          await this.avisarDueno(
            `Jarvis: el chat de ${quien} llegó a ${perChat} mensajes en la última hora (tope por chat: ${limites.porChatHora}). ` +
              'Ya no le contesta hasta que baje; quedó en "espera a una persona" en el panel. ' +
              'Si es un cliente legítimo, puedes subir el tope en el panel → Ajustes.',
          );
        }

        return stop(ctx, this.name, 'techo por chat');
      }
    }

    await next();
  }

  /**
   * Avisa al 80 % y al 100 % del tope general, una vez por nivel y por
   * hora: lo bastante pronto para subirlo antes de que el bot se calle.
   */
  private async avisarGlobal(cuenta: number, tope: number, linea: string | null): Promise<void> {
    const nivel = cuenta >= tope ? 100 : cuenta >= Math.ceil(tope * 0.8) ? 80 : 0;
    if (nivel === 0) return;

    const clave = linea ? `${CLAVE_AVISO}.${linea}` : CLAVE_AVISO;
    const ultimo = await this.flags.get<{ nivel: number; en: string } | null>(clave, null);
    const reciente = ultimo && Date.now() - new Date(ultimo.en).getTime() < WINDOW_MS;
    if (reciente && ultimo.nivel >= nivel) return;

    await this.flags.set(clave, { nivel, en: new Date().toISOString() });

    // Qué número es: el principal, o el de qué empresa.
    const empresa = linea
      ? await this.prisma.organization.findUnique({ where: { waLineId: linea }, select: { name: true } })
      : null;
    const quien = linea ? `El número de ${empresa?.name ?? 'una empresa'}` : 'Jarvis';

    await this.avisarDueno(
      nivel === 100
        ? `${quien} llegó al tope general: ${cuenta} de ${tope} mensajes en la última hora. ` +
            'No le contesta a NADIE por ese número hasta que baje. Si es tráfico normal, súbelo en el panel → Ajustes.'
        : `${quien} lleva ${cuenta} de ${tope} mensajes en la última hora (80 % del tope general). ` +
            'Si sigue así, pronto deja de contestar. Puedes subirlo en el panel → Ajustes.',
    );
  }

  private async avisarDueno(text: string): Promise<void> {
    try {
      await this.prisma.outboxMessage.create({
        data: { chatId: config.ownerWaId, payload: { kind: 'text', text } },
      });
    } catch (err) {
      this.logger.warn(`no se pudo avisar al dueño: ${String(err)}`);
    }
  }
}
