import { createHash, randomBytes, randomInt } from 'node:crypto';
import { posix } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { ConnectorDevice, Organization } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { PC_FILE_PREFIX } from '../../infrastructure/storage/routing-document-source';
import { isDeliverable } from './document-name.parser';
import { DriveSyncService } from './drive-sync.service';

/**
 * Conector de PC: empareja computadoras y recibe lo que suben.
 *
 * El flujo, visto desde el cliente:
 *  1. En el panel pulsa "Conectar mi computadora" y le sale un código.
 *  2. Instala el conector, teclea el código y elige la carpeta.
 *  3. Nada más. El conector sube lo nuevo y avisa lo borrado.
 *
 * El bot nunca se conecta a la PC. Todo llega empujado y se guarda aquí,
 * así que el bot contesta aunque la PC esté apagada.
 */

/** Cuánto vive un código de emparejamiento. */
const PAIR_CODE_TTL_MS = 15 * 60 * 1000;

/** Más grande que esto no se guarda: no se podría entregar por WhatsApp. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** lastSeenAt se escribe como mucho una vez por minuto por equipo. */
const SEEN_THROTTLE_MS = 60 * 1000;

export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 413 | 415 = 400,
  ) {
    super(message);
  }
}

export type AuthenticatedDevice = ConnectorDevice & { organization: Organization };

@Injectable()
export class ConnectorService {
  private readonly logger = new Logger(ConnectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: DriveSyncService,
  ) {}

  // ── Panel ───────────────────────────────────────────────────────────────

  /**
   * Genera un código para emparejar una PC. Pedirlo es elegir "mi
   * computadora" como origen: la empresa pasa a PC en el mismo paso, que
   * es un clic menos para quien lo configura.
   */
  async crearCodigo(
    organizationId: string,
    ttlMs = PAIR_CODE_TTL_MS,
  ): Promise<{ code: string; expiresAt: Date; organization: string }> {
    // Solo se limpian los vencidos: un código tecleado y un instalador
    // descargado pueden estar vigentes a la vez para la misma empresa.
    await this.prisma.connectorPairCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { sourceType: 'PC' },
    });

    const expiresAt = new Date(Date.now() + ttlMs);

    // Un choque con otro código vigente es casi imposible, pero la llave
    // primaria lo haría fallar: se reintenta en vez de devolver un error.
    for (let intento = 0; intento < 5; intento++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        await this.prisma.connectorPairCode.create({
          data: { code, organizationId, expiresAt },
        });
        return { code, expiresAt, organization: organization.name };
      } catch {
        continue;
      }
    }

    throw new Error('no se pudo generar un código, intenta de nuevo');
  }

  async revocar(deviceId: string): Promise<void> {
    await this.prisma.connectorDevice.update({
      where: { id: deviceId },
      data: { revokedAt: new Date() },
    });
  }

  // ── Conector ────────────────────────────────────────────────────────────

  /** Canjea un código por un token de equipo. El código se consume. */
  async emparejar(
    code: string,
    deviceName: string,
  ): Promise<{ token: string; organization: string }> {
    const limpio = code.replace(/\D/g, '');
    const pairCode = await this.prisma.connectorPairCode.findUnique({
      where: { code: limpio },
      include: { organization: true },
    });

    if (!pairCode || pairCode.expiresAt < new Date()) {
      throw new ConnectorError('el código no existe o ya caducó', 404);
    }

    const token = randomBytes(32).toString('base64url');

    await this.prisma.$transaction([
      this.prisma.connectorPairCode.delete({ where: { code: limpio } }),
      this.prisma.connectorDevice.create({
        data: {
          organizationId: pairCode.organizationId,
          name: deviceName.trim().slice(0, 80) || 'Computadora',
          tokenHash: hashToken(token),
          lastSeenAt: new Date(),
        },
      }),
    ]);

    this.logger.log(`PC "${deviceName}" emparejada con ${pairCode.organization.name}`);
    return { token, organization: pairCode.organization.name };
  }

  async autenticar(token: string | undefined): Promise<AuthenticatedDevice> {
    if (!token) throw new ConnectorError('falta el token', 401);

    const device = await this.prisma.connectorDevice.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: true },
    });

    // Revocado, empresa apagada o empresa que volvió a Drive: la misma
    // respuesta. El conector solo necesita saber que tiene que re-emparejar.
    if (
      !device ||
      device.revokedAt ||
      !device.organization.active ||
      device.organization.sourceType !== 'PC'
    ) {
      throw new ConnectorError('este equipo ya no está autorizado', 401);
    }

    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > SEEN_THROTTLE_MS) {
      await this.prisma.connectorDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    }

    return device;
  }

  /**
   * El conector manda la lista COMPLETA de lo que hay en su carpeta.
   * Se contesta qué rutas hay que subir (nuevas o cambiadas) y se da por
   * borrado lo que ya no aparece.
   *
   * Es la reconciliación que cubre todo lo que el conector no vio: la PC
   * apagada mientras alguien borraba, un cambio hecho con el conector
   * cerrado, una subida que falló a medias.
   */
  async manifiesto(
    device: AuthenticatedDevice,
    entries: ManifestEntry[],
  ): Promise<{ upload: string[]; deleted: number }> {
    const organizationId = device.organizationId;
    const deseados = new Map<string, ManifestEntry>();

    for (const entry of entries) {
      const path = normalizarRuta(entry.path);
      if (!path) continue;
      deseados.set(fileIdFor(organizationId, path), { ...entry, path });
    }

    const guardados = await this.prisma.storedFile.findMany({
      where: { organizationId },
      select: { id: true, sha256: true },
    });
    const porId = new Map(guardados.map((g) => [g.id, g.sha256]));

    const upload = [...deseados.entries()]
      .filter(([id, entry]) => porId.get(id) !== entry.sha256 && entry.size <= MAX_UPLOAD_BYTES)
      .map(([, entry]) => entry.path);

    const sobrantes = guardados.filter((g) => !deseados.has(g.id)).map((g) => g.id);
    if (sobrantes.length > 0) await this.borrarIds(organizationId, sobrantes);

    return { upload, deleted: sobrantes.length };
  }

  async subir(
    device: AuthenticatedDevice,
    input: { path: string; mimeType: string; sha256?: string; bytes: Buffer },
  ): Promise<{ indexed: boolean }> {
    const path = normalizarRuta(input.path);
    if (!path) throw new ConnectorError('ruta inválida');

    if (input.bytes.length > MAX_UPLOAD_BYTES) {
      throw new ConnectorError('archivo demasiado grande', 413);
    }
    if (!isDeliverable(input.mimeType)) {
      throw new ConnectorError(`tipo de archivo no soportado: ${input.mimeType}`, 415);
    }

    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    if (input.sha256 && input.sha256.toLowerCase() !== sha256) {
      // Llegó cortado o alterado: mejor rechazar que indexar basura.
      throw new ConnectorError('el contenido no coincide con su huella sha256');
    }

    const id = fileIdFor(device.organizationId, path);
    const data = new Uint8Array(input.bytes);

    await this.prisma.storedFile.upsert({
      where: { id },
      create: { id, organizationId: device.organizationId, path, sha256, data },
      update: { path, sha256, data },
    });

    const carpetas = posix.dirname(path) === '.' ? [] : posix.dirname(path).split('/');

    const indexed = await this.sync.indexarArchivo(
      {
        id,
        version: sha256,
        name: posix.basename(path),
        mimeType: input.mimeType,
        sizeBytes: input.bytes.length,
        parentIds: [],
        // De la raíz hacia adentro, igual que el barrido de Drive.
        folderPath: carpetas,
        removed: false,
      },
      device.organization,
    );

    return { indexed };
  }

  async borrar(device: AuthenticatedDevice, rawPath: string): Promise<void> {
    const path = normalizarRuta(rawPath);
    if (!path) throw new ConnectorError('ruta inválida');
    await this.borrarIds(device.organizationId, [fileIdFor(device.organizationId, path)]);
  }

  private async borrarIds(organizationId: string, ids: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.document.updateMany({
        where: { organizationId, driveFileId: { in: ids } },
        data: { status: 'DELETED' },
      }),
      this.prisma.storedFile.deleteMany({ where: { organizationId, id: { in: ids } } }),
    ]);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Id estable por ruta. Lleva la empresa dentro: dos clientes con un
 * "Facturas/enero.pdf" no pueden pisarse.
 */
function fileIdFor(organizationId: string, path: string): string {
  const huella = createHash('sha1').update(path.toLowerCase()).digest('hex');
  return `${PC_FILE_PREFIX}${organizationId}:${huella}`;
}

/**
 * Ruta relativa con "/" y sin trucos. Rechaza lo que intente salirse de la
 * carpeta: aunque aquí no se escribe en disco, una ruta con ".." es señal
 * de un conector roto o de alguien probando.
 */
function normalizarRuta(raw: string): string | null {
  const path = String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

  if (!path || path.length > 500) return null;
  if (path.split('/').some((parte) => parte === '..' || parte === '')) return null;
  return path;
}
