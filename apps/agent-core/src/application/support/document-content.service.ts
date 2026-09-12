import { Inject, Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import {
  DOCUMENT_SOURCE_PORT,
  type DocumentSourcePort,
} from '../ports/document-source.port';
import { normalizarContenido } from './document-content.parser';

/**
 * Lee el texto de un documento para que el bot sepa qué contiene ANTES de
 * mandarlo.
 *
 * Con solo el nombre del archivo el bot adivina: "Cotizacion_Vega_2026"
 * puede ser de cualquier mes, y "REP-0045" puede ser de cualquier cosa.
 * Con el texto de adentro se sabe de qué mes es, a nombre de quién va y
 * qué folio trae — y una petición como "la factura de Parcia Ima" o "el
 * reporte contable de junio" se puede contestar con el documento que de
 * verdad dice eso.
 *
 * Se lee UNA vez, al indexar, y se guarda un extracto. Ni el modelo ni la
 * conversación tocan el archivo: lo que se busca es texto en la base.
 */

/** Cuánto texto se guarda por documento. Lo importante está al principio. */
const MAX_CHARS = 8000;

/** Más de esto no se baja solo para leerlo: un escaneo pesado no trae texto. */
const MAX_BYTES = 12 * 1024 * 1024;

/** Páginas que se leen de un PDF. El encabezado con fecha y folio está en la primera. */
const MAX_PAGES = 4;

@Injectable()
export class DocumentContentService {
  private readonly logger = new Logger(DocumentContentService.name);

  constructor(
    @Inject(DOCUMENT_SOURCE_PORT) private readonly source: DocumentSourcePort,
  ) {}

  /** ¿Este tipo de archivo trae texto que se pueda leer sin OCR? */
  static legible(mimeType: string): boolean {
    return (
      mimeType === 'application/pdf' ||
      mimeType === 'text/plain' ||
      mimeType === 'text/csv'
    );
  }

  /**
   * El texto del archivo, normalizado y recortado, o null si no se pudo
   * leer. Un fallo aquí nunca impide indexar: el documento entra igual,
   * solo que con lo que diga su nombre.
   */
  async leer(file: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<string | null> {
    if (!DocumentContentService.legible(file.mimeType)) return null;
    if (file.sizeBytes > MAX_BYTES) return null;

    try {
      const bytes = await this.source.download(file.id);
      const crudo =
        file.mimeType === 'application/pdf'
          ? await textoDePdf(bytes)
          : bytes.toString('utf8');

      const texto = normalizarContenido(crudo).slice(0, MAX_CHARS);
      return texto.length > 0 ? texto : null;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`no pude leer "${file.name}": ${detail}`);
      return null;
    }
  }
}

async function textoDePdf(bytes: Buffer): Promise<string> {
  const parsed = await pdfParse(bytes, { max: MAX_PAGES });
  return parsed.text ?? '';
}
