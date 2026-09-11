import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config';

/**
 * Enlaces de descarga firmados, como vía alterna cuando el adjunto falla.
 *
 * open-wa no logra mandar archivos a los hilos que WhatsApp direcciona por
 * LID: el chat existe con un id y el contacto con otro, y cada destino
 * tropieza en una comprobación distinta. Es un límite de la librería, no de
 * nuestro código, y no se arregla desde aquí.
 *
 * Un enlace firmado entrega el documento igual. No es tan cómodo como un
 * adjunto —hay que tocar un enlace— pero llega, y llega hoy.
 *
 * El enlace NO es público: lleva una firma que ata el documento a una
 * caducidad corta. Sin la firma correcta no se descarga nada, y el
 * identificador del documento por sí solo no sirve de llave.
 */

/** Caduca pronto: un enlace reenviado por ahí deja de servir enseguida. */
const VIGENCIA_MS = 30 * 60 * 1000;

export interface EnlaceFirmado {
  token: string;
  url: string;
  expiraEn: Date;
}

@Injectable()
export class DocumentLinkService {
  /**
   * La firma usa la llave del gateway, que ya es un secreto compartido del
   * despliegue. Con DOWNLOAD_SECRET se puede separar si algún día conviene
   * rotarlas por separado.
   */
  private get secreto(): string {
    return process.env.DOWNLOAD_SECRET || config.gatewayApiKey;
  }

  private firmar(documentId: string, expira: number): string {
    return createHmac('sha256', this.secreto)
      .update(`${documentId}.${expira}`)
      .digest('base64url');
  }

  crear(documentId: string): EnlaceFirmado {
    const expira = Date.now() + VIGENCIA_MS;
    const token = `${documentId}.${expira}.${this.firmar(documentId, expira)}`;

    return {
      token,
      url: `${config.publicUrl}/d/${token}`,
      expiraEn: new Date(expira),
    };
  }

  /** Devuelve el id del documento, o null si el enlace no vale. */
  verificar(token: string): string | null {
    const partes = token.split('.');
    if (partes.length !== 3) return null;

    const [documentId, expiraRaw, firma] = partes as [string, string, string];
    const expira = Number(expiraRaw);

    if (!Number.isFinite(expira) || expira < Date.now()) return null;

    const esperada = Buffer.from(this.firmar(documentId, expira));
    const recibida = Buffer.from(firma);

    // Comparación en tiempo constante: con `===` el tiempo de respuesta
    // delata cuántos caracteres de la firma se acertaron.
    if (esperada.length !== recibida.length) return null;
    if (!timingSafeEqual(esperada, recibida)) return null;

    return documentId;
  }
}
