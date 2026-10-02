import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
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
 * El enlace NO es público: lleva una firma que ata el documento, la
 * persona a la que se le dio y una caducidad corta. Al abrirlo se vuelve a
 * comprobar que ESA persona siga pudiendo verlo: quitarle el permiso
 * apaga también los enlaces que ya tiene.
 *
 * A quién se le dio va cifrado dentro del token: un enlace reenviado no
 * deja ver el número de nadie.
 */

/** Caduca pronto: un enlace reenviado por ahí deja de servir enseguida. */
const VIGENCIA_MS = 30 * 60 * 1000;

export interface EnlaceFirmado {
  token: string;
  url: string;
  expiraEn: Date;
}

export interface Destino {
  waId: string;
  chatId: string;
}

export interface EnlaceVerificado extends Destino {
  documentId: string;
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

  private get llaveCifrado(): Buffer {
    return createHash('sha256').update(`destino:${this.secreto}`).digest();
  }

  private firmar(contenido: string): string {
    return createHmac('sha256', this.secreto).update(contenido).digest('base64url');
  }

  private cifrar(destino: Destino): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.llaveCifrado, iv);
    const datos = Buffer.concat([
      cipher.update(JSON.stringify([destino.waId, destino.chatId]), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), datos]).toString('base64url');
  }

  private descifrar(texto: string): Destino | null {
    try {
      const crudo = Buffer.from(texto, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.llaveCifrado, crudo.subarray(0, 12));
      decipher.setAuthTag(crudo.subarray(12, 28));
      const plano = Buffer.concat([decipher.update(crudo.subarray(28)), decipher.final()]).toString('utf8');
      const [waId, chatId] = JSON.parse(plano) as [unknown, unknown];
      return typeof waId === 'string' && typeof chatId === 'string' ? { waId, chatId } : null;
    } catch {
      return null;
    }
  }

  crear(documentId: string, destino: Destino): EnlaceFirmado {
    const expira = Date.now() + VIGENCIA_MS;
    const contenido = `${documentId}.${expira}.${this.cifrar(destino)}`;
    const token = `${contenido}.${this.firmar(contenido)}`;

    return {
      token,
      url: `${config.publicUrl}/d/${token}`,
      expiraEn: new Date(expira),
    };
  }

  /**
   * El documento y a quién se le dio, si la firma es válida y no caducó.
   * Los enlaces de antes (sin destino) ya no sirven: caducaban en media
   * hora de todos modos.
   */
  verificar(token: string): EnlaceVerificado | null {
    const partes = token.split('.');
    if (partes.length !== 4) return null;

    const [documentId, expiraRaw, destinoCifrado, firma] = partes as [string, string, string, string];
    const expira = Number(expiraRaw);

    if (!Number.isFinite(expira) || expira < Date.now()) return null;

    const esperada = Buffer.from(this.firmar(`${documentId}.${expiraRaw}.${destinoCifrado}`));
    const recibida = Buffer.from(firma);

    // Comparación en tiempo constante: con `===` el tiempo de respuesta
    // delata cuántos caracteres de la firma se acertaron.
    if (esperada.length !== recibida.length) return null;
    if (!timingSafeEqual(esperada, recibida)) return null;

    const destino = this.descifrar(destinoCifrado);
    return destino ? { documentId, ...destino } : null;
  }
}
