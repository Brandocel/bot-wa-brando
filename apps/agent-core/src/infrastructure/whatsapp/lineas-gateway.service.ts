import { Injectable } from '@nestjs/common';
import { config } from '../../config';

/** Estado de una línea, tal como lo reporta el gateway. */
export interface EstadoLinea {
  linea: string;
  state: 'BOOTING' | 'WAITING_QR' | 'CONNECTED' | 'DISCONNECTED' | 'CRASHED';
  hasQr: boolean;
  lastError: string | null;
  numero: string | null;
  nombre: string | null;
}

/**
 * Administración de las líneas del gateway (un número por empresa): crear,
 * ver su estado, traer su QR y darlas de baja. La llave del gateway se queda
 * en el servidor: el panel nunca la ve.
 */
@Injectable()
export class LineasGatewayService {
  private async llamar(ruta: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${config.gatewayUrl}${ruta}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-gateway-key': config.gatewayApiKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    return res;
  }

  private async json<T>(ruta: string, init: RequestInit = {}): Promise<T> {
    const res = await this.llamar(ruta, init);
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(`el gateway respondió ${res.status}: ${detalle.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  listar(): Promise<EstadoLinea[]> {
    return this.json('/lineas');
  }

  crear(id: string): Promise<EstadoLinea> {
    return this.json('/lineas', { method: 'POST', body: JSON.stringify({ id }) });
  }

  /** null = la línea no existe en el gateway. */
  async estado(id: string): Promise<EstadoLinea | null> {
    const res = await this.llamar(`/lineas/${encodeURIComponent(id)}`);
    if (res.status === 502 || res.status === 404) return null;
    if (!res.ok) throw new Error(`el gateway respondió ${res.status}`);
    return (await res.json()) as EstadoLinea;
  }

  /** El PNG del QR pendiente, o null si no hay uno ahora mismo. */
  async qr(id: string): Promise<Buffer | null> {
    const res = await this.llamar(`/lineas/${encodeURIComponent(id)}/qr.png`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  async borrar(id: string): Promise<void> {
    await this.json(`/lineas/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
