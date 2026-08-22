import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import type { MessagingPort } from '../../application/ports/messaging.port';

/**
 * ADAPTER del MessagingPort. Habla el contrato HTTP del wa-gateway.
 *
 * Para migrar a Baileys se escribe un `BaileysMessagingAdapter` con esta misma
 * interfaz y se cambia una línea del módulo. Nada más del core se entera.
 */
@Injectable()
export class GatewayMessagingAdapter implements MessagingPort {
  private readonly logger = new Logger(GatewayMessagingAdapter.name);

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${config.gatewayUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gateway-key': config.gatewayApiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`gateway ${path} respondió ${res.status}: ${detail}`);
    }

    return (await res.json()) as T;
  }

  async sendText(to: string, text: string): Promise<string> {
    const { messageId } = await this.post<{ messageId: string }>(
      '/messages/text',
      { to, text },
    );
    return messageId;
  }

  async setTyping(to: string, on: boolean): Promise<void> {
    // "Escribiendo..." es cosmético: si falla, no vale la pena tumbar el turno.
    try {
      await this.post('/messages/typing', { to, on });
    } catch (err) {
      this.logger.warn(`no se pudo simular typing: ${String(err)}`);
    }
  }

  async markSeen(to: string): Promise<void> {
    try {
      await this.post('/messages/seen', { to });
    } catch (err) {
      this.logger.warn(`no se pudo marcar como visto: ${String(err)}`);
    }
  }
}
