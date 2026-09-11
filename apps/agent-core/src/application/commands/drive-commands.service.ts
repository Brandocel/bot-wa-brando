import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { DriveSyncService } from '../support/drive-sync.service';

/**
 * Panel de operador para Drive, desde WhatsApp.
 *
 * Existe porque dar de alta una empresa no puede exigir un despliegue ni una
 * consola de base de datos. Son comandos del DUEÑO: quien los llama ya pasó
 * por el AuthorizationFilter, que resuelve OWNER solo contra OWNER_WA_ID.
 */
@Injectable()
export class DriveCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: DriveSyncService,
  ) {}

  /**
   * `/empresa Flores de Paula | 1a2B3c4D...`
   *
   * El id de la carpeta sale de su URL en Drive:
   * drive.google.com/drive/folders/ESTO_DE_AQUI
   */
  /**
   * Baja de una empresa: deja de sincronizarse y sus números dejan de ver
   * documentos. No se borra nada: el índice y los tickets siguen ahí por
   * si hay que volver, y por auditoría.
   */
  async deactivateOrganization(args: string): Promise<string> {
    const nombre = args.trim().toLowerCase();
    if (!nombre) return 'Uso: /empresa-baja <nombre>';

    const empresas = await this.prisma.organization.findMany({ where: { active: true } });
    const hit = empresas.filter((o) => o.name.toLowerCase().includes(nombre));

    if (hit.length === 0) return `No hay ninguna empresa activa que se llame "${args.trim()}".`;
    if (hit.length > 1) {
      return ['Varias coinciden; sé más específico:', ...hit.map((o) => `• ${o.name}`)].join('\n');
    }

    await this.prisma.organization.update({
      where: { id: hit[0]!.id },
      data: { active: false },
    });

    return `${hit[0]!.name} dada de baja: ya no se sincroniza ni se entregan sus documentos.`;
  }

  async registerOrganization(args: string): Promise<string> {
    const [name, folderId] = args.split('|').map((part) => part.trim());

    if (!name || !folderId) {
      return [
        'Uso: /empresa <nombre> | <id de carpeta de Drive>',
        '',
        'El id está en la URL de la carpeta:',
        'drive.google.com/drive/folders/ESTO_ES_EL_ID',
      ].join('\n');
    }

    const existing = await this.prisma.organization.findUnique({
      where: { driveFolderId: folderId },
    });

    if (existing) {
      return `Esa carpeta ya está registrada como "${existing.name}".`;
    }

    const organization = await this.prisma.organization.create({
      data: { name, driveFolderId: folderId },
    });

    return [
      `✓ ${organization.name} registrada.`,
      '',
      'Falta compartir la carpeta en Drive con:',
      config.google.serviceAccount?.client_email ?? '(sin cuenta de servicio configurada)',
      '',
      'Con permiso de Lector. Después corre /sync.',
    ].join('\n');
  }

  /** `/sync` — dispara una pasada a mano sin esperar al temporizador. */
  async runSync(): Promise<string> {
    if (!config.google.serviceAccount) {
      return 'No hay GOOGLE_SERVICE_ACCOUNT_JSON configurado: la sincronización está apagada.';
    }

    const report = await this.sync.sync();

    const lines = [
      `Indexados: ${report.indexed}`,
      `En cuarentena: ${report.quarantined}`,
      `Borrados: ${report.deleted}`,
      `Ignorados: ${report.skipped}`,
    ];

    if (report.errors.length > 0) {
      lines.push('', 'Errores:', ...report.errors.map((e) => `• ${e}`));
    }

    return lines.join('\n');
  }

  /**
   * `/drive` — diagnóstico. Es lo primero que se mira cuando "no encuentra
   * nada": casi siempre la carpeta no está compartida con la cuenta de
   * servicio, y desde WhatsApp no hay forma de saberlo sin esto.
   */
  async status(): Promise<string> {
    const account = config.google.serviceAccount;

    if (!account) {
      return 'Drive apagado: falta GOOGLE_SERVICE_ACCOUNT_JSON.';
    }

    const [organizations, state, indexed, quarantined] = await Promise.all([
      this.prisma.organization.findMany({ where: { active: true } }),
      this.prisma.driveSyncState.findUnique({ where: { id: 'singleton' } }),
      this.prisma.document.count({ where: { status: 'INDEXED' } }),
      this.prisma.document.count({ where: { status: 'QUARANTINE' } }),
    ]);

    const lines = [
      `Cuenta de servicio: ${account.client_email}`,
      `Última sincronización: ${state?.lastSyncAt.toISOString() ?? 'nunca'}`,
      `Documentos entregables: ${indexed}`,
      `En cuarentena: ${quarantined}`,
      '',
      'Empresas:',
      ...organizations.map((o) => `• ${o.name} → ${o.driveFolderId}`),
    ];

    if (state?.lastError) lines.push('', `Último error: ${state.lastError}`);

    return lines.join('\n');
  }

  /**
   * `/cuarentena` — los archivos que Drive tiene pero el bot no puede
   * entregar porque no logró clasificarlos. Esta lista es la tarea del
   * operador: cada línea es un archivo mal nombrado en el Drive del cliente.
   */
  async listQuarantine(): Promise<string> {
    const documents = await this.prisma.document.findMany({
      where: { status: 'QUARANTINE' },
      include: { organization: { select: { name: true } } },
      take: 15,
      orderBy: { indexedAt: 'desc' },
    });

    if (documents.length === 0) return 'No hay documentos en cuarentena.';

    return [
      'Sin clasificar (no se pueden entregar):',
      ...documents.map((d) => `• [${d.organization.name}] ${d.name}`),
      '',
      'Les falta categoría o periodo en el nombre.',
      'Formato esperado: FACTURA_2026-02_A1234.pdf',
    ].join('\n');
  }

  /** `/resync` — borra el cursor y vuelve a leer todo desde cero. */
  async fullResync(): Promise<string> {
    await this.sync.resetCursor();
    return 'Cursor borrado. Corre /sync para rehacer el barrido completo.';
  }
}
