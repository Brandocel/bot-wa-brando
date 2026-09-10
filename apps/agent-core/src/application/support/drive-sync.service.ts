import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { DocStatus, Organization } from '@prisma/client';
import { config } from '../../config';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import {
  DOCUMENT_SOURCE_PORT,
  type DocumentSourcePort,
  type SourceFile,
} from '../ports/document-source.port';
import { isDeliverable, parseDocumentName } from './document-name.parser';

/**
 * Sincronizador Drive → índice local.
 *
 * Por qué existe un índice y no se busca en vivo (§1.2 de la arquitectura):
 * buscar en vivo obliga a filtrar DESPUÉS de traer resultados, y un bug de
 * filtrado entrega la factura de otra empresa. Con índice propio el filtro
 * es un WHERE que no se puede omitir por accidente.
 *
 * El cursor solo avanza si el lote completo se procesó. Perder tiempo
 * reprocesando es barato; perder un cambio es un documento que el cliente
 * pide y no existe.
 */

const SYNC_STATE_ID = 'singleton';

export interface SyncReport {
  indexed: number;
  quarantined: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

@Injectable()
export class DriveSyncService implements OnModuleInit {
  private readonly logger = new Logger(DriveSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_SOURCE_PORT) private readonly source: DocumentSourcePort,
  ) {}

  onModuleInit(): void {
    if (!config.google.serviceAccount) {
      this.logger.warn(
        'Sin GOOGLE_SERVICE_ACCOUNT_JSON: la sincronización con Drive queda apagada.',
      );
      return;
    }

    const timer = setInterval(() => {
      this.sync().catch((err: unknown) =>
        this.logger.error(`sincronización falló: ${String(err)}`),
      );
    }, config.google.syncIntervalMs);

    timer.unref();
    this.logger.log(
      `Sincronización con Drive cada ${config.google.syncIntervalMs / 60000} min`,
    );
  }

  /**
   * Pasada incremental. La primera vez de cada organización hace un barrido
   * completo de su carpeta; después solo cambios.
   */
  async sync(): Promise<SyncReport> {
    const report: SyncReport = {
      indexed: 0,
      quarantined: 0,
      deleted: 0,
      skipped: 0,
      errors: [],
    };

    // Un solo sync a la vez: dos pasadas concurrentes se pisan el cursor.
    if (this.running) {
      report.errors.push('ya hay una sincronización en curso');
      return report;
    }
    this.running = true;

    try {
      const organizations = await this.prisma.organization.findMany({
        where: { active: true },
      });

      if (organizations.length === 0) {
        report.errors.push('no hay organizaciones activas registradas');
        return report;
      }

      const state = await this.prisma.driveSyncState.findUnique({
        where: { id: SYNC_STATE_ID },
      });

      if (!state) {
        await this.fullScan(organizations, report);
        return report;
      }

      await this.incremental(state.pageToken, organizations, report);
      return report;
    } finally {
      this.running = false;
    }
  }

  /** Primer arranque: se recorre cada carpeta raíz y se fija el cursor. */
  private async fullScan(
    organizations: Organization[],
    report: SyncReport,
  ): Promise<void> {
    // El cursor se pide ANTES de leer, no después: si alguien sube un archivo
    // durante el barrido, el cambio queda dentro de la ventana del cursor y
    // se procesa en la siguiente pasada. Al revés, se perdería.
    const cursor = await this.source.startCursor();

    for (const organization of organizations) {
      try {
        const files = await this.source.listFolder(organization.driveFolderId);
        for (const file of files) {
          await this.upsert(file, organization, report);
        }

        // Lo que el índice tenía y la carpeta ya no: se marca como borrado.
        //
        // Un barrido completo SÍ conoce la lista entera, así que puede
        // afirmar lo que falta — el incremental no, porque solo ve cambios.
        // Sin esto, un documento que dejó de estar en Drive seguiría
        // ganando búsquedas y el bot lo prometería para después fallar al
        // descargarlo. Es exactamente lo que pasa al cambiar una empresa de
        // carpeta: los documentos de la carpeta vieja se quedan colgados.
        const vistos = files.map((f) => f.id);

        const huerfanos = await this.prisma.document.updateMany({
          where: {
            organizationId: organization.id,
            status: { not: 'DELETED' },
            driveFileId: { notIn: vistos },
          },
          data: { status: 'DELETED' },
        });

        report.deleted += huerfanos.count;

        this.logger.log(
          `${organization.name}: ${files.length} archivo(s) leídos` +
            (huerfanos.count > 0
              ? `, ${huerfanos.count} ya no está(n) en la carpeta`
              : ''),
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        report.errors.push(`${organization.name}: ${detail}`);
        this.logger.error(`barrido de ${organization.name} falló: ${detail}`);
      }
    }

    // Solo se guarda el cursor si ninguna carpeta falló. Con un error a medias
    // el próximo arranque repite el barrido, que es idempotente; guardarlo
    // dejaría a esa organización sin indexar para siempre.
    if (report.errors.length === 0) {
      await this.prisma.driveSyncState.upsert({
        where: { id: SYNC_STATE_ID },
        create: { id: SYNC_STATE_ID, pageToken: cursor },
        update: { pageToken: cursor, lastError: null },
      });
    }
  }

  private async incremental(
    cursor: string,
    organizations: Organization[],
    report: SyncReport,
  ): Promise<void> {
    let current = cursor;

    // Se pagina hasta agotar. `done` es del proveedor: mientras haya
    // nextPageToken, seguimos en el mismo barrido.
    for (let page = 0; page < 50; page++) {
      const changes = await this.source.changesSince(current);

      for (const file of changes.files) {
        if (file.removed) {
          const result = await this.prisma.document.updateMany({
            where: { driveFileId: file.id },
            data: { status: 'DELETED' },
          });
          report.deleted += result.count;
          continue;
        }

        const organization = this.ownerOf(file, organizations);
        if (!organization) {
          report.skipped += 1;
          continue;
        }

        await this.upsert(file, organization, report);
      }

      current = changes.nextCursor;

      await this.prisma.driveSyncState.update({
        where: { id: SYNC_STATE_ID },
        data: { pageToken: current, lastError: null },
      });

      if (changes.done) break;
    }
  }

  /**
   * A qué organización pertenece un archivo.
   *
   * Por el ancestro, jamás por el nombre. Drive solo devuelve el padre
   * inmediato, así que para archivos en subcarpetas hay que subir la cadena
   * hasta topar con una carpeta raíz registrada.
   */
  private ownerOf(
    file: SourceFile,
    organizations: Organization[],
  ): Organization | null {
    const roots = new Map(organizations.map((o) => [o.driveFolderId, o]));

    for (const parentId of file.parentIds) {
      const direct = roots.get(parentId);
      if (direct) return direct;
    }

    return null;
  }

  /**
   * Escribe el archivo en el índice. Cuando falta la categoría o el periodo,
   * la fila entra igual pero en QUARANTINE: queda visible para el operador
   * e invisible para la búsqueda.
   */
  private async upsert(
    file: SourceFile,
    organization: Organization,
    report: SyncReport,
  ): Promise<void> {
    if (!isDeliverable(file.mimeType)) {
      report.skipped += 1;
      return;
    }

    const parsed = parseDocumentName(file.name, file.folderPath);
    const status: DocStatus =
      parsed.category && parsed.period ? 'INDEXED' : 'QUARANTINE';

    await this.prisma.document.upsert({
      where: { driveFileId: file.id },
      create: {
        organizationId: organization.id,
        driveFileId: file.id,
        driveVersion: file.version,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        category: parsed.category ?? 'OTRO',
        period: parsed.period,
        folio: parsed.folio,
        status,
      },
      update: {
        organizationId: organization.id,
        driveVersion: file.version,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        category: parsed.category ?? 'OTRO',
        period: parsed.period,
        folio: parsed.folio,
        status,
      },
    });

    if (status === 'INDEXED') report.indexed += 1;
    else report.quarantined += 1;
  }

  /** Fuerza un barrido completo: borra el cursor y vuelve a leer todo. */
  async resetCursor(): Promise<void> {
    await this.prisma.driveSyncState.deleteMany({ where: { id: SYNC_STATE_ID } });
  }
}
