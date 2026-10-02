import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import {
  Prisma,
  type DocCategory,
  type DocClass,
  type DocStatus,
  type Organization,
} from '@prisma/client';
import { config } from '../../config';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import {
  DOCUMENT_SOURCE_PORT,
  type DocumentSourcePort,
  type SourceFile,
} from '../ports/document-source.port';
import { isDeliverable, parseDocumentName } from './document-name.parser';
import { parseDocumentContent } from './document-content.parser';
import { DocumentContentService } from './document-content.service';
import { CATEGORIAS, type Clasificacion } from './document-classification';
import { DocumentClassifierService } from './document-classifier.service';
import { contenidoSensible, esSensible } from './document-safety';
import { claveTitular } from '../../domain/contact/nombre';

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

/** Documentos que se clasifican por pasada, de los que quedaron pendientes. */
const LOTE_CLASIFICACION = 20;

/** Sin Drive, cada cuánto se revisan los pendientes de clasificar. */
const PENDIENTES_MS = 2 * 60 * 1000;

/** Qué pasó con un archivo al indexarlo. */
export type Resultado = 'indexado' | 'revision' | 'excluido' | 'sensible' | 'omitido';

export interface SyncReport {
  indexed: number;
  /** Esperan revisión en el panel. */
  quarantined: number;
  /** Clasificados como no entregables: internos, ajenos o sensibles. */
  excluded: number;
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
    private readonly contenido: DocumentContentService,
    private readonly clasificador: DocumentClassifierService,
  ) {}

  onModuleInit(): void {
    if (!config.google.serviceAccount) {
      this.logger.warn(
        'Sin GOOGLE_SERVICE_ACCOUNT_JSON: la sincronización con Drive queda apagada.',
      );

      // Aunque no haya Drive, lo que suben los conectores de PC también
      // tiene documentos por clasificar.
      const timer = setInterval(() => {
        this.clasificarPendientes().catch((err: unknown) =>
          this.logger.error(`clasificación de pendientes falló: ${String(err)}`),
        );
      }, PENDIENTES_MS);
      timer.unref();
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
    const report = reporteVacio();

    // Un solo sync a la vez: dos pasadas concurrentes se pisan el cursor.
    if (this.running) {
      report.errors.push('ya hay una sincronización en curso');
      return report;
    }
    this.running = true;

    try {
      // Solo las que leen de Drive. Las de PC no se sondean: su conector
      // empuja los archivos por /connector y se indexan al llegar.
      const organizations = await this.prisma.organization.findMany({
        where: { active: true, sourceType: 'DRIVE', driveFolderId: { not: null } },
      });

      if (organizations.length === 0) {
        report.errors.push('no hay organizaciones activas registradas');
        await this.clasificarLote(report);
        return report;
      }

      const state = await this.prisma.driveSyncState.findUnique({
        where: { id: SYNC_STATE_ID },
      });

      /**
       * Primero el cursor, y se guarda antes de leer nada.
       *
       * Antes el cursor solo se guardaba si NINGUNA carpeta fallaba, y con
       * una empresa mal configurada eso no pasaba nunca: cada pasada
       * repetía el barrido completo, fallaba igual, y los cambios de las
       * empresas que sí funcionaban no se veían jamás. Una empresa rota
       * bloqueaba a todas.
       *
       * Pedirlo antes de leer también evita perder cambios: lo que alguien
       * suba durante el barrido cae dentro de la ventana del cursor y se
       * procesa en la vuelta siguiente.
       */
      let cursor = state?.pageToken ?? null;

      if (!cursor) {
        cursor = await this.source.startCursor();
        await this.prisma.driveSyncState.upsert({
          where: { id: SYNC_STATE_ID },
          create: { id: SYNC_STATE_ID, pageToken: cursor },
          update: { pageToken: cursor },
        });
      }

      // Empresas nunca barridas, o que acaban de cambiar de carpeta. Cada
      // una va por su cuenta: si una falla, las demás siguen.
      const pendientes = organizations.filter((o) => o.lastScanAt === null);

      for (const organization of pendientes) {
        await this.scanOrganization(organization, report);
      }

      // Y los cambios desde el cursor, para todo lo ya barrido.
      if (state?.pageToken) {
        await this.incremental(state.pageToken, organizations, report);
      }

      // Y se clasifica lo pendiente: lo indexado antes de que existiera el
      // clasificador y lo que el modelo no alcanzó a contestar. Lo que está
      // en cuarentena ya NO se promueve solo: ahí espera a una persona.
      await this.clasificarLote(report);

      return report;
    } finally {
      this.running = false;
    }
  }

  /**
   * Recorre la carpeta de UNA empresa y reconcilia su índice.
   *
   * Por empresa y no todas juntas: un fallo aquí ya no arrastra al resto,
   * y la que falló se vuelve a intentar en la pasada siguiente porque su
   * lastScanAt sigue en null.
   */
  private async scanOrganization(
    organization: Organization,
    report: SyncReport,
  ): Promise<void> {
    try {
      if (!organization.driveFolderId) return;
      const files = await this.source.listFolder(organization.driveFolderId);

      for (const file of files) {
        await this.upsert(file, organization, report);
      }

      // Lo que el índice tenía y la carpeta ya no: se marca como borrado.
      //
      // Un barrido completo SÍ conoce la lista entera, así que puede
      // afirmar lo que falta — el incremental no, porque solo ve cambios.
      // Sin esto, un documento que dejó de estar en Drive seguiría ganando
      // búsquedas y el bot lo prometería para después fallar al bajarlo.
      const huerfanos = await this.prisma.document.updateMany({
        where: {
          organizationId: organization.id,
          status: { not: 'DELETED' },
          driveFileId: { notIn: files.map((f) => f.id) },
        },
        data: { status: 'DELETED' },
      });

      report.deleted += huerfanos.count;

      await this.prisma.organization.update({
        where: { id: organization.id },
        data: { lastScanAt: new Date() },
      });

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
    const roots = new Map(
      organizations
        .filter((o) => o.driveFolderId !== null)
        .map((o) => [o.driveFolderId!, o]),
    );

    for (const parentId of file.parentIds) {
      const direct = roots.get(parentId);
      if (direct) return direct;
    }

    return null;
  }

  /**
   * Indexa un archivo que llegó por fuera del barrido de Drive (el conector
   * de PC). Mismas reglas que Drive: mismo parser, misma lectura de
   * contenido, misma clasificación, mismo destino.
   */
  async indexarArchivo(file: SourceFile, organization: Organization): Promise<Resultado> {
    return this.upsert(file, organization, reporteVacio());
  }

  /**
   * Escribe el archivo en el índice, ya clasificado.
   *
   * El orden importa: primero las reglas duras (nombre y contenido con
   * credenciales), después el clasificador, y al final lo que haya decidido
   * una persona. Nada de lo que venga después de las reglas duras puede
   * volver entregable algo que ellas bloquearon.
   */
  private async upsert(
    file: SourceFile,
    organization: Organization,
    report: SyncReport,
  ): Promise<Resultado> {
    if (!isDeliverable(file.mimeType)) {
      report.skipped += 1;
      return 'omitido';
    }

    const previo = await this.prisma.document.findUnique({
      where: { driveFileId: file.id },
      select: {
        driveVersion: true,
        extractedText: true,
        status: true,
        docClass: true,
        classifiedBy: true,
        classifiedVersion: true,
        classification: true,
        counterpart: true,
        holderKey: true,
        holderByOperator: true,
      },
    });
    const mismaVersion = previo !== null && previo.driveVersion === file.version;

    // Credenciales por nombre o carpeta: ni se lee ni se le pregunta a nadie.
    if (esSensible([...file.folderPath, file.name].join('/'))) {
      return this.descartarSensible(file, organization, 'el nombre o la carpeta indican credenciales', 'reglas', report);
    }
    if (mismaVersion && previo.docClass === 'SENSIBLE') {
      return this.descartarSensible(file, organization, motivoDe(previo.classification), 'reglas', report);
    }

    /**
     * El texto de adentro se lee una vez por versión del archivo. Si ya
     * lo teníamos y el archivo no cambió, no se vuelve a bajar.
     */
    const contenido =
      mismaVersion && previo.extractedText !== null
        ? sinCarpeta(previo.extractedText)
        : ((await this.contenido.leer(file)) ?? '');

    // Y por contenido, antes de mandárselo al modelo: un secreto no se le
    // enseña a nadie para preguntarle si es un secreto.
    if (contenidoSensible(contenido)) {
      return this.descartarSensible(file, organization, 'el contenido trae contraseñas o llaves', 'reglas', report);
    }

    // Una clasificación se hace una vez por versión. La de reglas se repite
    // cuando ya hay modelo: fue un "no sé" por falta de él.
    const guardada =
      mismaVersion &&
      previo.classifiedVersion === file.version &&
      !(previo.classifiedBy === 'reglas' && this.clasificador.conModelo)
        ? clasificacionGuardada(previo.classification)
        : null;

    const clas =
      guardada ??
      (await this.clasificador.clasificar({
        name: file.name,
        folderPath: file.folderPath,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        texto: contenido,
        organizacion: organization.name,
      }));

    if (clas?.clase === 'SENSIBLE') {
      return this.descartarSensible(file, organization, clas.motivo, clas.fuente, report);
    }

    // Lo que decidió una persona se respeta aunque el archivo cambie de
    // versión: aprobó "el Excel del contador", no una versión concreta.
    let clase: DocClass | null = clas?.clase ?? null;
    let classifiedBy: string | null = clas?.fuente ?? null;
    if (
      previo?.classifiedBy === 'operador' &&
      (previo.docClass === 'ENTREGABLE' || previo.docClass === 'INTERNO')
    ) {
      clase = previo.docClass;
      classifiedBy = 'operador';
    }

    const status: DocStatus =
      clase === 'ENTREGABLE'
        ? 'INDEXED'
        : clase === 'INTERNO'
          ? 'EXCLUDED'
          : clase === 'DUDOSO'
            ? 'QUARANTINE'
            : // El modelo no contestó: lo que ya estaba no se degrada por un
              // fallo de la API, y lo nuevo espera sin entregarse.
              mismaVersion && previo.status !== 'DELETED'
              ? previo.status
              : 'QUARANTINE';

    const meta = combinar(parseDocumentName(file.name, file.folderPath), contenido, clas);

    // Las carpetas también se buscan: "la foto del cenote" tiene que dar con
    // Cenote/galeria/vista.png aunque el archivo no diga nada de cenotes.
    const extractedText = conCarpeta(contenido, file.folderPath);

    const datos = {
      organizationId: organization.id,
      driveVersion: file.version,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      category: meta.category,
      period: meta.period,
      folio: meta.folio,
      extractedText,
      status,
      docClass: clase,
      summary: clas?.resumen ?? null,
      // El titular que corrigió una persona manda sobre el clasificador.
      ...(previo?.holderByOperator
        ? { counterpart: previo.counterpart, holderKey: previo.holderKey }
        : { counterpart: clas?.contraparte ?? null, holderKey: claveTitular(clas?.contraparte) }),
      classifiedBy,
      // Sin respuesta del modelo queda sin versión: se reintenta después.
      classifiedVersion: clas ? file.version : null,
      classification: clas ? guardarClasificacion(clas) : Prisma.DbNull,
    };

    await this.prisma.document.upsert({
      where: { driveFileId: file.id },
      create: { driveFileId: file.id, ...datos },
      update: datos,
    });

    if (status === 'INDEXED') {
      report.indexed += 1;
      return 'indexado';
    }
    if (status === 'EXCLUDED') {
      report.excluded += 1;
      return 'excluido';
    }
    report.quarantined += 1;
    return 'revision';
  }

  /**
   * Un archivo con credenciales: la fila queda para la auditoría y para
   * que el conector no lo vuelva a subir, pero sin texto, sin resumen y,
   * si vino de una PC, sin los bytes.
   */
  private async descartarSensible(
    file: SourceFile,
    organization: Organization,
    motivo: string,
    fuente: 'modelo' | 'reglas',
    report: SyncReport,
  ): Promise<Resultado> {
    const datos = {
      organizationId: organization.id,
      driveVersion: file.version,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      category: 'OTRO' as const,
      period: null,
      folio: null,
      extractedText: null,
      status: 'EXCLUDED' as const,
      docClass: 'SENSIBLE' as const,
      summary: null,
      counterpart: null,
      holderKey: null,
      classifiedBy: fuente,
      classifiedVersion: file.version,
      classification: { clase: 'SENSIBLE', fuente, motivo },
    };

    // Los de Drive no tienen bytes aquí: el deleteMany no encuentra nada.
    await this.prisma.$transaction([
      this.prisma.document.upsert({
        where: { driveFileId: file.id },
        create: { driveFileId: file.id, ...datos },
        update: datos,
      }),
      this.prisma.storedFile.deleteMany({
        where: { id: file.id, organizationId: organization.id },
      }),
    ]);

    this.logger.warn(`${organization.name}: "${file.name}" descartado como sensible (${motivo})`);
    report.excluded += 1;
    return 'sensible';
  }

  /**
   * Clasifica lo que se indexó antes de que existiera el clasificador, lo
   * que el modelo no alcanzó a contestar y lo que se decidió por reglas a
   * falta de modelo. Un lote chico por pasada: cada archivo es una
   * descarga y una llamada al modelo.
   */
  private async clasificarLote(report: SyncReport): Promise<void> {
    const pendientes = await this.prisma.document.findMany({
      where: {
        status: { in: ['INDEXED', 'QUARANTINE'] },
        OR: [
          { classifiedVersion: null },
          ...(this.clasificador.conModelo ? [{ classifiedBy: 'reglas' }] : []),
        ],
      },
      include: { organization: true },
      orderBy: { indexedAt: 'desc' },
      take: LOTE_CLASIFICACION,
    });

    for (const doc of pendientes) {
      try {
        await this.upsert(
          {
            id: doc.driveFileId,
            version: doc.driveVersion,
            name: doc.name,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            parentIds: [],
            folderPath: carpetasDe(doc.extractedText),
            removed: false,
          },
          doc.organization,
          report,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        report.errors.push(`clasificar "${doc.name}": ${detail}`);
      }
    }
  }

  /**
   * Solo el lote de clasificación, para cuando no hay Drive que sondear:
   * las empresas con conector de PC también tienen documentos por revisar.
   */
  async clasificarPendientes(): Promise<SyncReport> {
    const report = reporteVacio();
    if (this.running) return report;
    this.running = true;
    try {
      await this.clasificarLote(report);
      return report;
    } finally {
      this.running = false;
    }
  }

  /**
   * Lo que una persona decide desde el panel sobre un documento en
   * revisión. Aprobar nunca pasa por encima de las reglas duras: un
   * archivo con credenciales no se vuelve entregable ni a mano.
   */
  async revisar(
    documentId: string,
    decision: 'aprobar' | 'rechazar',
    por: string,
  ): Promise<{ status: DocStatus }> {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.status === 'DELETED') throw new RevisionError('el documento ya no existe');

    if (decision === 'aprobar') {
      const ruta = [...carpetasDe(doc.extractedText), doc.name].join('/');
      if (doc.docClass === 'SENSIBLE' || esSensible(ruta) || contenidoSensible(doc.extractedText)) {
        throw new RevisionError('parece contener credenciales: no se puede entregar');
      }
    }

    const status: DocStatus = decision === 'aprobar' ? 'INDEXED' : 'EXCLUDED';
    await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        status,
        docClass: decision === 'aprobar' ? 'ENTREGABLE' : 'INTERNO',
        classifiedBy: 'operador',
        classifiedVersion: doc.driveVersion,
        reviewedBy: por,
        reviewedAt: new Date(),
      },
    });

    this.logger.log(`"${doc.name}" ${decision === 'aprobar' ? 'aprobado' : 'rechazado'} por ${por}`);
    return { status };
  }

  /** Fuerza un barrido completo: borra el cursor y vuelve a leer todo. */
  async resetCursor(): Promise<void> {
    await this.prisma.driveSyncState.deleteMany({ where: { id: SYNC_STATE_ID } });

    // Y todas las empresas vuelven a "nunca barrida": un cursor nuevo no
    // trae historia, así que sin esto el resync solo veía cambios futuros
    // y lo que se había perdido seguía perdido.
    await this.prisma.organization.updateMany({
      where: { active: true, sourceType: 'DRIVE' },
      data: { lastScanAt: null },
    });
  }
}

export class RevisionError extends Error {}

function reporteVacio(): SyncReport {
  return { indexed: 0, quarantined: 0, excluded: 0, deleted: 0, skipped: 0, errors: [] };
}

/** Marca de la línea con la ruta de carpetas dentro de extractedText. */
const MARCA_CARPETA = '\n[carpeta] ';

function conCarpeta(texto: string, carpetas: readonly string[]): string {
  return carpetas.length > 0 ? texto + MARCA_CARPETA + carpetas.join(' / ') : texto;
}

function sinCarpeta(texto: string): string {
  const i = texto.indexOf(MARCA_CARPETA);
  return i === -1 ? texto : texto.slice(0, i);
}

/** La ruta de carpetas que se guardó junto al texto, de vuelta en lista. */
function carpetasDe(texto: string | null): string[] {
  if (!texto) return [];
  const i = texto.indexOf(MARCA_CARPETA);
  return i === -1 ? [] : texto.slice(i + MARCA_CARPETA.length).split(' / ');
}

function guardarClasificacion(c: Clasificacion): Prisma.InputJsonObject {
  return {
    clase: c.clase,
    fuente: c.fuente,
    categoria: c.categoria,
    periodo: c.periodo?.toISOString() ?? null,
    folio: c.folio,
    contraparte: c.contraparte,
    resumen: c.resumen,
    motivo: c.motivo,
  };
}

function clasificacionGuardada(json: Prisma.JsonValue | null): Clasificacion | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const clases: readonly string[] = ['ENTREGABLE', 'INTERNO', 'SENSIBLE', 'DUDOSO'];
  if (typeof j.clase !== 'string' || !clases.includes(j.clase)) return null;
  const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    clase: j.clase as DocClass,
    fuente: j.fuente === 'modelo' ? 'modelo' : 'reglas',
    categoria: (CATEGORIAS as readonly string[]).includes(String(j.categoria))
      ? (j.categoria as DocCategory)
      : null,
    periodo: typeof j.periodo === 'string' ? new Date(j.periodo) : null,
    folio: texto(j.folio),
    contraparte: texto(j.contraparte),
    resumen: texto(j.resumen),
    motivo: texto(j.motivo) ?? '',
  };
}

function motivoDe(json: Prisma.JsonValue | null): string {
  const j = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  return typeof j.motivo === 'string' ? j.motivo : 'sensible';
}

/**
 * Nombre primero, luego el clasificador, luego el contenido por reglas.
 *
 * El nombre lo puso una persona pensando en encontrarlo; el contenido trae
 * fechas de todo tipo (pago, vencimiento, impresión). Así que el nombre
 * manda y lo demás solo rellena lo que el nombre dejó en blanco: el mes de
 * "Cotizacion_Vega_2026", el folio de "invoice-6a6d58c7.pdf", el tipo de
 * "REP-0045.pdf". El modelo leyó el mismo texto que las reglas, pero lo
 * entiende mejor: va antes que ellas.
 */
function combinar(
  nombre: ReturnType<typeof parseDocumentName>,
  texto: string | null,
  clas: Clasificacion | null,
): { category: DocCategory; period: Date | null; folio: string | null } {
  const contenido = parseDocumentContent(texto);
  const delTexto = clas?.periodo ?? contenido.period;
  // Una marca de tiempo en el nombre es la fecha de descarga: si el texto
  // trae la fecha de emisión, esa es la buena.
  const period = nombre.periodoDebil
    ? (delTexto ?? nombre.period)
    : (nombre.period ?? delTexto);

  return {
    category: nombre.category ?? clas?.categoria ?? contenido.category ?? 'OTRO',
    period,
    folio: nombre.folio ?? clas?.folio ?? contenido.folio,
  };
}
