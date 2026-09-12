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

/** Chats a los que se les manda a la vez. Cada uno sigue yendo en orden. */
const CHATS_EN_PARALELO = 3;

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
  /**
   * Qué decirle a la persona si el archivo no sale después de todos los
   * reintentos. Sin esto el fallo es mudo: el bot dijo "aquí está" y nunca
   * llegó nada, y quien espera no sabe si volver a pedirlo o a quién.
   */
  fallbackText?: string;
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
        take: 40,
      });

      /**
       * Por chat, en orden; entre chats, en paralelo (con tope).
       *
       * Dentro de un chat el orden es sagrado: el archivo antes que el
       * "aquí está", y si algo falla lo que venga detrás espera al
       * siguiente barrido. Pero el retardo humano (uno a seis segundos
       * por mensaje) no tiene por qué pagarlo cada persona por las demás:
       * con diez chats activos, la décima esperaba medio minuto por una
       * respuesta que ya estaba escrita. El tope existe por WhatsApp: no
       * es buena idea disparar a veinte chats en el mismo segundo.
       */
      const porChat = new Map<string, typeof pending>();
      for (const row of pending) {
        const fila = porChat.get(row.chatId) ?? [];
        fila.push(row);
        porChat.set(row.chatId, fila);
      }

      const colas = [...porChat.values()];
      let siguiente = 0;
      const trabajador = async (): Promise<void> => {
        while (siguiente < colas.length) {
          const cola = colas[siguiente++]!;
          for (const row of cola) {
            const ok = await this.enviarFila(row);
            if (!ok) break;
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CHATS_EN_PARALELO, colas.length) }, () => trabajador()),
      );
    } finally {
      this.draining = false;
    }
  }

  /** Manda una fila del outbox. Devuelve false si falló (el chat se detiene por este barrido). */
  private async enviarFila(row: {
    id: string;
    chatId: string;
    attempts: number;
    payload: unknown;
  }): Promise<boolean> {
    const payload = row.payload as unknown as OutboxPayload;
    const attempts = row.attempts + 1;

    /**
     * Reclamar la fila ANTES de enviar, y de forma atómica.
     *
     * Durante un deploy conviven dos instancias del core unos segundos,
     * y las dos barren el mismo outbox. Sin esto las dos leían la misma
     * fila PENDING, las dos la mandaban, y el cliente recibía cada
     * respuesta dos veces. El `attempts` en el where es el cerrojo: solo
     * una de las dos consigue subirlo, y la otra ve 0 filas y se aparta.
     */
    const claimed = await this.prisma.outboxMessage.updateMany({
      where: { id: row.id, status: 'PENDING', attempts: row.attempts },
      data: { attempts },
    });
    if (claimed.count === 0) return true;

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
        data: { status: 'SENT', sentAt: new Date() },
      });

      await this.recordOutbound(row.chatId, sent.id, sent.body, sent.kind);
      return true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`outbox ${row.id} intento ${attempts}: ${detail}`);

      const agotado = attempts >= MAX_ATTEMPTS;

      // La fila pudo desaparecer entre el findMany y este update (otro
      // proceso, una limpieza). Registrar el fallo es lo secundario aqui:
      // que reviente el manejo de errores seria peor que el error mismo.
      try {
        await this.prisma.outboxMessage.update({
          where: { id: row.id },
          data: {
            lastError: detail,
            status: agotado ? 'FAILED' : 'PENDING',
          },
        });

        // Se rindió con el archivo: que la persona lo sepa, en vez de
        // quedarse esperando un PDF que ya no va a llegar.
        if (agotado && payload.kind === 'file' && payload.fallbackText) {
          await this.prisma.outboxMessage.create({
            data: {
              chatId: row.chatId,
              payload: { kind: 'text', text: payload.fallbackText },
            },
          });
        }
      } catch {
        this.logger.warn(`outbox ${row.id} ya no existe; se ignora`);
      }
      return false;
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
    /**
     * Se cita el último mensaje que escribió la persona.
     *
     * No es un adorno de conversación: es lo que hace que el archivo salga.
     * WhatsApp direcciona el hilo por LID y open-wa resuelve el contacto por
     * teléfono, así que cada destino falla en una comprobación distinta —uno
     * por "no existe ese chat", el otro por "no es un contacto"—. Citando, el
     * chat se resuelve desde el mensaje citado y ninguna de las dos hace
     * falta.
     */
    const ultimoEntrante = await this.prisma.message.findFirst({
      where: { conversation: { chatId }, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const id = await this.messaging.sendFile(chatId, {
      url: payload.url,
      base64: payload.base64,
      filename: payload.filename,
      caption: payload.caption,
      quotedMsgId: ultimoEntrante?.id,
    });
    // La leyenda va en el cuerpo: es lo que el bot "dijo" al entregar, y el
    // historial que lee el modelo tiene que verlo para no repetirlo.
    const body = payload.caption
      ? `[documento] ${payload.filename}\n${payload.caption}`
      : `[documento] ${payload.filename}`;
    return { id, body, kind: 'DOCUMENT' };
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
