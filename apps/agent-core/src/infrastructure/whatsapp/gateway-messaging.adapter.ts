import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import { separarChat } from '../../domain/message/linea';
import type {
  MessagingPort,
  NumberCheck,
  OutgoingFile,
} from '../../application/ports/messaging.port';

/**
 * ADAPTER del MessagingPort. Habla el contrato HTTP del wa-gateway.
 *
 * Para migrar a Baileys se escribe un `BaileysMessagingAdapter` con esta misma
 * interfaz y se cambia una línea del módulo. Nada más del core se entera.
 */
@Injectable()
export class GatewayMessagingAdapter implements MessagingPort {
  private readonly logger = new Logger(GatewayMessagingAdapter.name);

  private async post<T>(
    path: string,
    body: unknown,
    timeoutMs = 15_000,
  ): Promise<T> {
    const res = await fetch(`${config.gatewayUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gateway-key': config.gatewayApiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`gateway ${path} respondió ${res.status}: ${detail}`);
    }

    return (await res.json()) as T;
  }

  /**
   * Los chats de la línea de una empresa llegan con un chatId compuesto
   * (`linea:<id>:<chat>`). Aquí se separa: el gateway recibe el chat de
   * WhatsApp de verdad y por qué línea mandarlo. Así la respuesta sale
   * siempre por el mismo número por el que escribieron.
   */
  private destino(to: string): { to: string; linea?: string } {
    const { linea, chat } = separarChat(to);
    return linea ? { to: chat, linea } : { to: chat };
  }

  async sendText(to: string, text: string): Promise<string> {
    const { messageId } = await this.post<{ messageId: string }>(
      '/messages/text',
      { ...this.destino(to), text },
    );
    return messageId;
  }

  async sendFile(to: string, file: OutgoingFile): Promise<string> {
    // Timeout más largo que el de texto: el gateway tiene que descargar el
    // archivo de Drive antes de poder mandarlo.
    const { messageId } = await this.post<{ messageId: string }>(
      '/messages/file',
      { ...file, ...this.destino(to) },
      60_000,
    );
    return messageId;
  }

  async checkNumber(candidate: string): Promise<NumberCheck> {
    const res = await fetch(
      `${config.gatewayUrl}/contacts/check?number=${encodeURIComponent(candidate)}`,
      {
        headers: { 'x-gateway-key': config.gatewayApiKey },
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`el gateway no pudo comprobar el número: ${detail.slice(0, 200)}`);
    }

    return (await res.json()) as NumberCheck;
  }

  async setTyping(to: string, on: boolean): Promise<void> {
    // "Escribiendo..." es cosmético: si falla, no vale la pena tumbar el turno.
    try {
      await this.post('/messages/typing', { ...this.destino(to), on });
    } catch (err) {
      this.logger.warn(`no se pudo simular typing: ${String(err)}`);
    }
  }

  async markSeen(to: string): Promise<void> {
    try {
      await this.post('/messages/seen', this.destino(to));
    } catch (err) {
      this.logger.warn(`no se pudo marcar como visto: ${String(err)}`);
    }
  }
}
