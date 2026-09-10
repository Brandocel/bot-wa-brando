import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { config } from '../../config';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import {
  DOCUMENT_SOURCE_PORT,
  type DocumentSourcePort,
} from '../ports/document-source.port';

/**
 * Entrega del documento por WhatsApp.
 *
 * El archivo lo baja el CORE, no el gateway: las credenciales de Drive viven
 * solo aquí. Mandarle al gateway una URL de Drive no serviría — necesita un
 * token para descargarla, y darle el token al gateway sería repartir el
 * acceso al Drive del cliente por un servicio que no lo necesita.
 *
 * Va en base64 por el mismo canal HTTP que el texto. Simple y suficiente:
 * una factura son cientos de kilobytes.
 */

export type DeliveryResult =
  | { ok: true }
  | { ok: false; reason: 'too_big' | 'not_available' | 'download_failed' };

/** Extensión por tipo de archivo, para los que Drive puede entregar. */
const EXTENSIONES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/**
 * Garantiza que el nombre lleve extensión.
 *
 * WhatsApp deduce el tipo de archivo del nombre, no de la cabecera: un PDF
 * llamado "FACTURA_2026-02_V3001" a secas lo rechaza sin más explicación
 * que un "false" de open-wa. Y en Drive la gente sube archivos sin
 * extensión constantemente, porque ahí no hace falta para nada.
 *
 * El tipo real lo tenemos del propio Drive, así que la extensión se deduce
 * de ahí y no de adivinar mirando el nombre.
 */
function conExtension(nombre: string, mimeType: string): string {
  const esperada = EXTENSIONES[mimeType];
  if (!esperada) return nombre;

  return nombre.toLowerCase().endsWith(esperada) ? nombre : nombre + esperada;
}

@Injectable()
export class DocumentDeliveryService {
  private readonly logger = new Logger(DocumentDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_SOURCE_PORT) private readonly source: DocumentSourcePort,
  ) {}

  /**
   * Encola el archivo en el outbox. No envía aquí: enviar es trabajo del
   * despachador, que ya sabe reintentar si el gateway está caído.
   *
   * `fallbackText` es lo que se le dice a la persona si, después de todos
   * los reintentos, el archivo no sale. El envío es asíncrono, así que
   * quien llama ya no está ahí cuando eso pasa; deja aquí el mensaje.
   */
  async deliver(
    chatId: string,
    document: Document,
    caption: string,
    fallbackText?: string,
  ): Promise<DeliveryResult> {
    if (document.status !== 'INDEXED') {
      return { ok: false, reason: 'not_available' };
    }

    // El tope se revisa ANTES de descargar: no tiene sentido bajar 40 MB de
    // Drive para descubrir después que no se pueden mandar.
    if (document.sizeBytes > config.google.maxDeliverableBytes) {
      return { ok: false, reason: 'too_big' };
    }

    let bytes: Buffer;
    try {
      bytes = await this.source.download(document.driveFileId);
    } catch (err) {
      this.logger.error(
        `no se pudo bajar ${document.driveFileId}: ${String(err)}`,
      );
      return { ok: false, reason: 'download_failed' };
    }

    // Un archivo puede haber crecido desde la última indexación; el tamaño
    // del índice es una foto vieja, el buffer es la verdad.
    if (bytes.byteLength > config.google.maxDeliverableBytes) {
      return { ok: false, reason: 'too_big' };
    }

    const base64 = `data:${document.mimeType};base64,${bytes.toString('base64')}`;
    const filename = conExtension(document.name, document.mimeType);

    await this.prisma.outboxMessage.create({
      data: {
        chatId,
        payload: {
          kind: 'file',
          base64,
          filename,
          caption,
          fallbackText,
        },
      },
    });

    return { ok: true };
  }
}
