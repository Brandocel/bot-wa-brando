import { Injectable } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import { config } from '../../config';
import type {
  ChangePage,
  DocumentSourcePort,
  SourceFile,
} from '../../application/ports/document-source.port';

/**
 * ADAPTER de Google Drive. Junto con el sincronizador, el único lugar del
 * proyecto que sabe que del otro lado hay un Drive.
 *
 * Cuenta de servicio, NO OAuth de usuario, y con scope de solo lectura. Si
 * el bot no puede escribir, ningún bug puede borrar el Drive del cliente.
 * El acceso se otorga compartiendo cada carpeta raíz con el correo de la
 * cuenta de servicio, igual que se comparte con una persona.
 *
 * Se usa la API REST con `fetch` en vez del paquete `googleapis`: ese trae
 * un cliente generado para ~300 APIs y pesa decenas de megas para usar tres
 * endpoints.
 */

const API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Campos que pedimos explícitamente; Drive por defecto devuelve casi nada. */
const FILE_FIELDS = 'id,name,mimeType,size,parents,trashed,headRevisionId';

@Injectable()
export class GoogleDriveAdapter implements DocumentSourcePort {
  private client: JWT | null = null;

  /** id de carpeta -> nombre. Cadena vacía = no la pudimos leer. */
  private readonly folderNames = new Map<string, string>();

  /**
   * El JWT se construye una vez y él solo renueva su token de acceso. Crear
   * uno por request funcionaría, pero pagaría un intercambio de token con
   * Google en cada llamada.
   */
  private auth(): JWT {
    if (this.client) return this.client;

    const credentials = config.google.serviceAccount;
    if (!credentials) {
      throw new Error(
        'Falta GOOGLE_SERVICE_ACCOUNT_JSON: el adaptador de Drive no puede autenticarse.',
      );
    }

    this.client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [SCOPE],
    });

    return this.client;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${API}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    // Las unidades compartidas necesitan estos dos flags o Drive responde
    // como si la carpeta no existiera — sin error, simplemente vacía.
    url.searchParams.set('supportsAllDrives', 'true');
    if (path !== '/changes/startPageToken') {
      url.searchParams.set('includeItemsFromAllDrives', 'true');
    }

    const { token } = await this.auth().getAccessToken();

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token ?? ''}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Drive ${path} respondió ${res.status}: ${detail.slice(0, 300)}`);
    }

    return (await res.json()) as T;
  }

  async startCursor(): Promise<string> {
    const data = await this.request<{ startPageToken: string }>(
      '/changes/startPageToken',
      {},
    );
    return data.startPageToken;
  }

  /**
   * Barrido recursivo de una carpeta. Solo para el primer indexado de una
   * organización nueva: después, todo va por `changesSince`.
   */
  async listFolder(folderId: string): Promise<SourceFile[]> {
    const found: SourceFile[] = [];
    const pending: { id: string; path: string[] }[] = [{ id: folderId, path: [] }];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const current = pending.shift()!;
      if (visited.has(current.id)) continue; // Drive permite atajos circulares
      visited.add(current.id);

      let pageToken: string | undefined;

      do {
        const data = await this.request<{
          files: RawFile[];
          nextPageToken?: string;
        }>('/files', {
          q: `'${current.id}' in parents and trashed = false`,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '200',
          ...(pageToken ? { pageToken } : {}),
        });

        for (const raw of data.files ?? []) {
          if (raw.mimeType === 'application/vnd.google-apps.folder') {
            // El nombre de la carpeta se cachea aquí para que los cambios
            // incrementales no tengan que volver a preguntarlo.
            this.folderNames.set(raw.id, raw.name);
            pending.push({ id: raw.id, path: [...current.path, raw.name] });
            continue;
          }
          found.push(toSourceFile(raw, false, current.path));
        }

        pageToken = data.nextPageToken;
      } while (pageToken);
    }

    return found;
  }

  /**
   * Nombre de una carpeta, cacheado.
   *
   * Los cambios incrementales solo traen el id del padre, y sin el nombre
   * se pierde la clasificación por carpeta — que es justo el caso común:
   * el cliente sube "A1234.pdf" a su carpeta "Facturas" y el nombre del
   * archivo por sí solo no dice nada. Una llamada por carpeta nueva, no
   * por archivo.
   */
  private async folderName(folderId: string): Promise<string | null> {
    const cached = this.folderNames.get(folderId);
    if (cached !== undefined) return cached;

    try {
      const data = await this.request<{ name: string }>(`/files/${folderId}`, {
        fields: 'name',
      });
      this.folderNames.set(folderId, data.name);
      return data.name;
    } catch {
      // Una carpeta que no podemos leer no es un error fatal: el archivo
      // se clasifica solo por su nombre y, si no alcanza, va a cuarentena.
      this.folderNames.set(folderId, '');
      return null;
    }
  }

  async changesSince(cursor: string): Promise<ChangePage> {
    const data = await this.request<{
      changes: { fileId: string; removed?: boolean; file?: RawFile }[];
      nextPageToken?: string;
      newStartPageToken?: string;
    }>('/changes', {
      pageToken: cursor,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      pageSize: '200',
    });

    const files: SourceFile[] = [];

    for (const change of data.changes ?? []) {
      // Un archivo puede desaparecer de tres formas: borrado, mandado a la
      // papelera, o dejando de estar compartido con nosotros. Las tres son
      // lo mismo para el índice.
      if (change.removed || !change.file || change.file.trashed) {
        files.push(removedFile(change.fileId, change.file));
        continue;
      }

      if (change.file.mimeType === 'application/vnd.google-apps.folder') {
        // Se cachea por si algún archivo de esta carpeta llega después.
        this.folderNames.set(change.file.id, change.file.name);
        continue;
      }

      const path: string[] = [];
      for (const parentId of change.file.parents ?? []) {
        const name = await this.folderName(parentId);
        if (name) path.push(name);
      }

      files.push(toSourceFile(change.file, false, path));
    }

    return {
      files,
      nextCursor: data.nextPageToken ?? data.newStartPageToken ?? cursor,
      done: !data.nextPageToken,
    };
  }

  async download(fileId: string): Promise<Buffer> {
    const { token } = await this.auth().getAccessToken();

    const url = new URL(`${API}/files/${fileId}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token ?? ''}` },
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new Error(`Drive no entregó el archivo ${fileId}: ${res.status}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }

  /** Diagnóstico: qué correo somos y a qué carpetas llegamos. */
  async whoAmI(): Promise<string> {
    const credentials = config.google.serviceAccount;
    return credentials?.client_email ?? '(sin credenciales)';
  }
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  headRevisionId?: string;
}

function toSourceFile(
  raw: RawFile,
  removed: boolean,
  folderPath: string[] = [],
): SourceFile {
  return {
    id: raw.id,
    // Los Google Docs nativos no tienen headRevisionId. No los indexamos por
    // ahora, pero si llegan, el nombre sirve de versión de emergencia.
    version: raw.headRevisionId ?? raw.name,
    name: raw.name,
    mimeType: raw.mimeType,
    sizeBytes: Number(raw.size ?? 0),
    parentIds: raw.parents ?? [],
    folderPath,
    removed,
  };
}

function removedFile(fileId: string, raw: RawFile | undefined): SourceFile {
  return {
    id: fileId,
    version: raw?.headRevisionId ?? '',
    name: raw?.name ?? '(borrado)',
    mimeType: raw?.mimeType ?? '',
    sizeBytes: 0,
    parentIds: raw?.parents ?? [],
    folderPath: [],
    removed: true,
  };
}
