import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { Awaiting, DocCategory } from '@prisma/client';
import {
  MESSAGING_PORT,
  type MessagingPort,
} from '../ports/messaging.port';
import {
  PrismaService,
  type TransactionClient,
} from '../../infrastructure/persistence/prisma.service';

/**
 * Estado de la conversación: de quién es el turno, de qué trata y desde
 * cuándo está parada.
 *
 * Va en la conversación y no en el ticket porque son cosas distintas: el
 * ticket es UNA solicitud, la conversación es el hilo con la persona. Un
 * hilo puede tener tres tickets cerrados y aun así estar esperando
 * respuesta sobre el cuarto.
 *
 * La bandera que ordena la bandeja es `awaiting`. Lo que espera al cliente
 * no corre prisa; lo que nos espera a nosotros, sí. Sin esa distinción, una
 * bandeja ordenada por fecha pone arriba justo lo que no hay que atender.
 */

/** Sin respuesta del cliente pasado esto, el hilo se marca como parado. */
const SILENCIO_CLIENTE_MS = 12 * 60 * 60 * 1000;

/** Escalado sin que un humano lo toque pasado esto, sube de nivel. */
const SILENCIO_AGENTE_MS = 4 * 60 * 60 * 1000;

const BARRIDO_MS = 15 * 60 * 1000;

export interface StaleConversation {
  id: string;
  chatId: string;
  awaiting: Awaiting;
  quietFor: string;
}

@Injectable()
export class ConversationStateService implements OnModuleInit {
  private readonly logger = new Logger(ConversationStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      this.sweep().catch((err: unknown) =>
        this.logger.error(`barrido de conversaciones falló: ${String(err)}`),
      );
    }, BARRIDO_MS);

    timer.unref();
  }

  /**
   * Acuse de recibo en WhatsApp. SOLO red: los campos de la conversación
   * los escribe el caso de uso dentro de su transacción.
   *
   * Antes esto también hacía un update, y ahí estaba el fallo: la
   * conversación se crea dentro de una transacción que todavía no ha hecho
   * commit, así que otra conexión no la ve. Con un hilo que ya existía
   * funcionaba; con uno nuevo reventaba en cada mensaje con "No record was
   * found for an update". El síntoma era que el bot no contestaba
   * justamente a los números recién dados de alta.
   *
   * Marcar como leído va al recibir y no al responder: el acuse inmediato
   * es lo que evita la sensación de "ni me leyeron" mientras el bot piensa.
   * Si falla, se registra y se sigue — es cosmético.
   */
  async onInbound(input: { chatId: string }): Promise<void> {
    try {
      await this.messaging.markSeen(input.chatId);
    } catch (err) {
      this.logger.warn(`no se pudo marcar como visto: ${String(err)}`);
    }
  }

  /**
   * Respondimos. De quién pase a ser el turno depende de QUÉ respondimos:
   * una pregunta deja la pelota en el cliente, una entrega no deja nada
   * pendiente, y un escalado deja el hilo esperando a una persona.
   */
  async onOutbound(input: {
    conversationId: string;
    awaiting: Awaiting;
    topic?: DocCategory | null;
    /**
     * El cliente de la transacción en curso. Obligatorio en la práctica:
     * escribir con otra conexión no ve lo que la transacción aún no ha
     * confirmado.
     */
    tx: TransactionClient;
  }): Promise<void> {
    await input.tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        awaiting: input.awaiting,
        lastOutboundAt: new Date(),
        // El tema solo se escribe cuando se resolvió: un null no debe
        // borrar la clasificación que ya tenía el hilo.
        ...(input.topic ? { topic: input.topic } : {}),
      },
    });
  }

  /**
   * Barrido de hilos parados.
   *
   * No manda recordatorios al cliente a propósito: perseguir a alguien que
   * no contestó es la forma más rápida de que bloquee el número. Lo que
   * hace es dejar el estado correcto para que el operador lo vea en el
   * panel, y subir de nivel lo que lleva demasiado esperando a una persona.
   */
  async sweep(): Promise<{ dormidos: number; escalados: number }> {
    const ahora = Date.now();

    // Le preguntamos algo al cliente y no volvió: el hilo se duerme.
    const dormidos = await this.prisma.conversation.updateMany({
      where: {
        awaiting: 'CLIENTE',
        lastOutboundAt: { lt: new Date(ahora - SILENCIO_CLIENTE_MS) },
      },
      data: { awaiting: 'NADIE' },
    });

    // Escalado que nadie tocó: sube a nivel 2 para que salte en la bandeja.
    const vencidos = await this.prisma.ticket.findMany({
      where: {
        state: 'EN_REVISION',
        level: { lt: 2 },
        updatedAt: { lt: new Date(ahora - SILENCIO_AGENTE_MS) },
      },
      select: { id: true },
      take: 50,
    });

    for (const ticket of vencidos) {
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { level: 2, priority: 'ALTA' },
      });

      await this.prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'escalado',
          actor: 'bot',
          data: { reason: 'sla_vencido', level: 2 },
        },
      });
    }

    if (dormidos.count > 0 || vencidos.length > 0) {
      this.logger.log(
        `barrido: ${dormidos.count} hilo(s) dormido(s), ${vencidos.length} escalado(s) a nivel 2`,
      );
    }

    return { dormidos: dormidos.count, escalados: vencidos.length };
  }

  /** Lo que lleva rato esperando por nosotros. Alimenta el panel. */
  async stale(): Promise<StaleConversation[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { awaiting: { in: ['BOT', 'AGENTE'] } },
      orderBy: { lastInboundAt: 'asc' },
      take: 50,
      select: { id: true, chatId: true, awaiting: true, lastInboundAt: true },
    });

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chatId,
      awaiting: row.awaiting,
      quietFor: humanize(row.lastInboundAt),
    }));
  }
}

function humanize(since: Date | null): string {
  if (!since) return 'sin actividad';

  const minutos = Math.floor((Date.now() - since.getTime()) / 60000);
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h`;

  return `${Math.floor(horas / 24)} d`;
}
