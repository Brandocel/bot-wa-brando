import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  MESSAGING_PORT,
  type MessagingPort,
} from '../../application/ports/messaging.port';
import { PrismaService } from './prisma.service';

const MAX_ATTEMPTS = 5;
const SWEEP_MS = 15_000;

/**
 * Lo que el caso de uso escribe en `OutboxMessage.payload`. Union discriminada
 * a propósito: agregar un tipo de envío (ubicación, botones) es un caso nuevo
 * en `drain()` que el compilador obliga a cubrir.
 */
interface OutboxTextPayload {
  kind: 'text';
  text: string;
}

interface OutboxFilePayload {
  kind: 'file';
  /** URL de descarga; el gateway la baja. Camino normal para Drive. */
  url?: string;
  /** Data URI completo. Solo para archivos chicos que ya están en RAM. */
  base64?: string;
  filename: string;
  caption?: string;
}

type OutboxPayload = OutboxTextPayload | OutboxFilePayload;

interface SentMessage {
  id: string;
  body: string;
  kind: 'TEXT' | 'DOCUMENT';
}

/**
 * Patrón OUTBOX.
 *
 * El caso de uso escribe la intención de enviar dentro de su transacción;
 * este despachador la drena contra el gateway. Si open-wa está caído o
 * redeployando, el mensaje espera en la base en vez de perderse.
 *
 * El barrido periódico es lo que da el reintento: no hace falta lógica de
 * retry en el caso de uso.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
  ) {}

  onModuleInit(): void {
    // El .catch() NO es decorativo: sin el, cualquier rechazo dentro de
    // drain() se vuelve un unhandled rejection y Node 22 mata el proceso.
    // Un fallo al ENVIAR jamas debe tumbar el core.
    this.timer = setInterval(() => {
      this.drain().catch((err: unknown) =>
        this.logger.error(`barrido del outbox fallo: ${String(err)}`),
      );
    }, SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    // Un solo drenado a la vez por proceso: evita mandar el mismo mensaje
    // dos veces cuando el barrido coincide con un turno recién procesado.
    if (this.draining) return;
    this.draining = true;

    try {
      const pending = await this.prisma.outboxMessage.findMany({
        where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });

      for (const row of pending) {
        const payload = row.payload as unknown as OutboxPayload;

        try {
          // Ritmo humano: nada de responder en 200ms como una máquina.
          await this.messaging.setTyping(row.chatId, true);

          const sent =
            payload.kind === 'file'
              ? await this.sendFilePayload(row.chatId, payload)
              : await this.sendTextPayload(row.chatId, payload);

          await this.messaging.setTyping(row.chatId, false);

          await this.prisma.outboxMessage.update({
            where: { id: row.id },
            data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1 },
          });

          await this.recordOutbound(row.chatId, sent.id, sent.body, sent.kind);
        } catch (err) {
          const attempts = row.attempts + 1;
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.warn(`outbox ${row.id} intento ${attempts}: ${detail}`);

          // La fila pudo desaparecer entre el findMany y este update (otro
          // proceso, una limpieza). Registrar el fallo es lo secundario aqui:
          // que reviente el manejo de errores seria peor que el error mismo.
          try {
            await this.prisma.outboxMessage.update({
              where: { id: row.id },
              data: {
                attempts,
                lastError: detail,
                status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
              },
            });
          } catch {
            this.logger.warn(`outbox ${row.id} ya no existe; se ignora`);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async sendTextPayload(
    chatId: string,
    payload: OutboxTextPayload,
  ): Promise<SentMessage> {
    await this.humanDelay(payload.text ?? '');
    const id = await this.messaging.sendText(chatId, payload.text);
    return { id, body: payload.text, kind: 'TEXT' };
  }

  /**
   * Los documentos NO llevan retardo humano: nadie teclea un PDF, y la
   * descarga desde Drive ya mete su propia latencia.
   *
   * El cuerpo que se guarda en el historial es el nombre del archivo, no su
   * contenido. La tabla Message es un índice de la conversación, no un
   * almacén de binarios.
   */
  private async sendFilePayload(
    chatId: string,
    payload: OutboxFilePayload,
  ): Promise<SentMessage> {
    const id = await this.messaging.sendFile(chatId, {
      url: payload.url,
      base64: payload.base64,
      filename: payload.filename,
      caption: payload.caption,
    });
    return { id, body: `[documento] ${payload.filename}`, kind: 'DOCUMENT' };
  }

  /**
   * Guarda el mensaje saliente con el messageId que devolvió WhatsApp.
   *
   * Doble propósito: historial de la conversación, y sobre todo idempotencia
   * — el gateway nos va a reenviar este mismo mensaje (usa onAnyMessage), y
   * el IdempotencyFilter lo va a descartar porque ya está en la tabla.
   */
  private async recordOutbound(
    chatId: string,
    messageId: string,
    body: string,
    kind: 'TEXT' | 'DOCUMENT',
  ): Promise<void> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { chatId },
        select: { id: true },
      });
      if (!conversation) return;

      await this.prisma.message.create({
        data: {
          id: messageId,
          conversationId: conversation.id,
          direction: 'OUT',
          kind,
          body,
        },
      });
    } catch (err) {
      // El mensaje YA se envió: fallar aquí no debe reintentar el envío.
      this.logger.warn(`no se pudo registrar el saliente ${messageId}: ${String(err)}`);
    }
  }

  /** ~1s por cada 40 caracteres, con tope y algo de aleatoriedad. */
  private async humanDelay(text: string): Promise<void> {
    const base = Math.min(6000, (text.length / 40) * 1000);
    const jitter = Math.random() * 700;
    await new Promise((r) => setTimeout(r, 800 + base + jitter));
  }
}
