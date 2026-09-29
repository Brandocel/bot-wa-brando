import { Injectable } from '@nestjs/common';
import type {
  ChangePage,
  DocumentSourcePort,
  SourceFile,
} from '../../application/ports/document-source.port';
import { GoogleDriveAdapter } from '../drive/google-drive.adapter';
import { PrismaService } from '../persistence/prisma.service';

/** Prefijo de los ids de archivos que subió un conector de PC. */
export const PC_FILE_PREFIX = 'pc:';

/**
 * El origen documental que ve el resto del core.
 *
 * Cada empresa elige de dónde salen sus documentos, pero la búsqueda, la
 * entrega y la descarga no deberían enterarse: solo necesitan bajar un
 * archivo por su id. Los ids con prefijo "pc:" viven en Postgres (los subió
 * el conector); todo lo demás es un id de Drive.
 *
 * Barrido y cambios siguen siendo cosa de Drive: los archivos de PC no se
 * sondean, llegan empujados por el conector.
 */
@Injectable()
export class RoutingDocumentSource implements DocumentSourcePort {
  constructor(
    private readonly drive: GoogleDriveAdapter,
    private readonly prisma: PrismaService,
  ) {}

  startCursor(): Promise<string> {
    return this.drive.startCursor();
  }

  listFolder(folderId: string): Promise<SourceFile[]> {
    return this.drive.listFolder(folderId);
  }

  changesSince(cursor: string): Promise<ChangePage> {
    return this.drive.changesSince(cursor);
  }

  async download(fileId: string): Promise<Buffer> {
    if (!fileId.startsWith(PC_FILE_PREFIX)) return this.drive.download(fileId);

    const stored = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      select: { data: true },
    });
    if (!stored) throw new Error(`el archivo ${fileId} ya no está guardado`);

    return Buffer.from(stored.data);
  }
}
