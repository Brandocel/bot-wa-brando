/**
 * PORT hacia el repositorio documental del cliente. Hoy es Google Drive;
 * mañana puede ser SharePoint, un S3 o un ERP, y nada del dominio cambia.
 *
 * El puerto habla de "carpetas" y "archivos", no de Drive: no aparece un
 * `driveFileId` ni un `pageToken` en esta interfaz. Lo que sí aparece es
 * `cursor`, que es el mismo concepto sin casarse con el proveedor.
 */

export interface SourceFile {
  /** Identificador en el origen. Único y estable. */
  id: string;
  /** Versión del contenido: si cambia, hay que reindexar. */
  version: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Cadena de carpetas ancestro, de la más cercana a la raíz del Drive. */
  parentIds: string[];
  /**
   * Nombres de las carpetas que lo contienen. Una carpeta "Facturas" es
   * tan buena señal de categoría como el prefijo del archivo, y muchos
   * clientes nombran los archivos solo con el folio.
   */
  folderPath: string[];
  /** true = borrado o fuera de nuestro alcance en el origen. */
  removed: boolean;
}

export interface ChangePage {
  files: SourceFile[];
  /** Cursor para la siguiente pasada. Se guarda SOLO si el lote completo se procesó. */
  nextCursor: string;
  /** false = quedan más páginas de este mismo barrido. */
  done: boolean;
}

export interface DocumentSourcePort {
  /** Cursor inicial, para el primer arranque. */
  startCursor(): Promise<string>;

  /** Barrido completo de una carpeta y sus subcarpetas. Solo la primera vez. */
  listFolder(folderId: string): Promise<SourceFile[]>;

  /** Cambios desde el cursor: altas, modificaciones y borrados. */
  changesSince(cursor: string): Promise<ChangePage>;

  /** Contenido del archivo. El core lo descarga porque el gateway no tiene credenciales. */
  download(fileId: string): Promise<Buffer>;
}

export const DOCUMENT_SOURCE_PORT = Symbol('DocumentSourcePort');
