import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import { toBuffer as qrToBuffer } from 'qrcode';

/**
 * Una línea de WhatsApp: un número vinculado, con su propia sesión.
 *
 * Antes el gateway tenía UNA conexión global. Con un número por empresa,
 * cada línea es una instancia de esta clase: su socket, su QR, su estado y
 * su carpeta de credenciales. Lo que le pase a una —que la desvinculen
 * desde el teléfono, que WhatsApp la deje de atender— no toca a las demás.
 *
 * La línea "principal" es el número de siempre: guarda su sesión donde
 * estaba (así no hay que reescanear nada) y es la única que atiende los
 * mensajes propios del dueño y el latido de ida y vuelta.
 */

export type ConnectionState = 'BOOTING' | 'WAITING_QR' | 'CONNECTED' | 'DISCONNECTED' | 'CRASHED';

export const LINEA_PRINCIPAL = 'principal';

/** Lo que el core recibe por cada mensaje. */
export interface PayloadParaCore {
  id: string;
  /** Por qué número llegó. `principal` = el número de siempre. */
  linea: string;
  chatId: string;
  from: string;
  to: string;
  author: string | null;
  sender: { id: string; pushname: string | null; formattedName: string | null };
  chat: { id: string; contact: { isMe: boolean } };
  type: string;
  body: string;
  caption: string;
  /** Solo en ubicaciones (type 'location'): el pin que mandó la persona. */
  lat?: number;
  lng?: number;
  loc?: string | null;
  isGroupMsg: boolean;
  fromMe: boolean;
  isBroadcast: boolean;
  notifyName: string | null;
  mentionedJidList: string[];
  t: number;
}

/**
 * Baileys es ruidoso: a nivel info narra cada nodo del protocolo y eso
 * entierra los logs de Render. A nivel error solo habla cuando algo pasa.
 */
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? 'error' });

// ───────────────────────────── Identificadores ────────────────────────────

/**
 * Traducción de identificadores en la frontera.
 *
 * El core lleva los números guardados como `<numero>@c.us`, que es lo que
 * usaba open-wa, y hay permisos, contactos y auditoría escritos así en la
 * base de datos. Baileys usa `<numero>@s.whatsapp.net` para lo mismo.
 *
 * Se traduce AQUÍ, en el borde, y no en el core: cambiar de librería no
 * puede obligar a migrar los datos de nadie. `@lid` y `@g.us` pasan tal cual
 * porque significan lo mismo en los dos mundos.
 */
export function haciaBaileys(jid: string): string {
  return jid.endsWith('@c.us') ? jid.replace(/@c\.us$/, '@s.whatsapp.net') : jid;
}

export function haciaCore(jid: string): string {
  // El sufijo de dispositivo (`...:6@s.whatsapp.net`) identifica CUÁL de los
  // teléfonos o navegadores vinculados mandó el mensaje. Al core no le sirve
  // de nada y le rompe todo: OWNER_WA_ID y los permisos del directorio están
  // guardados sin él, así que un jid con `:6` no casa con ninguno.
  const sinDispositivo = jid.replace(/:\d+(?=@)/, '');

  return sinDispositivo.endsWith('@s.whatsapp.net')
    ? sinDispositivo.replace(/@s\.whatsapp\.net$/, '@c.us')
    : sinDispositivo;
}

/** Los dígitos del número, sin servidor y sin el sufijo de dispositivo. */
export function soloDigitos(jid: string): string {
  return (jid.split('@')[0] ?? '').split(':')[0] ?? '';
}

// ──────────────────────────── Traducción de mensajes ──────────────────────

/**
 * El tipo de mensaje, en el vocabulario que ya entiende el mapper del core.
 *
 * Los nombres ('chat', 'image', 'document', 'ptt') son los de open-wa a
 * propósito: el core lleva ese vocabulario desde el principio y traducirlo
 * aquí cuesta una función, mientras que cambiarlo allá tocaría el dominio.
 */
function tipoDeMensaje(m: WAMessage): string {
  const contenido = m.message ?? {};

  if (contenido.conversation || contenido.extendedTextMessage) return 'chat';
  if (contenido.imageMessage) return 'image';
  if (contenido.videoMessage) return 'video';
  if (contenido.documentMessage || contenido.documentWithCaptionMessage) {
    return 'document';
  }
  if (contenido.audioMessage) {
    return contenido.audioMessage.ptt ? 'ptt' : 'audio';
  }
  if (contenido.stickerMessage) return 'sticker';
  if (contenido.locationMessage || contenido.liveLocationMessage) return 'location';

  return 'unknown';
}

/**
 * El pin de una ubicación, con los nombres que usaba open-wa (lat, lng, loc).
 * Antes ni se mandaba al core: el cliente compartía su ubicación cuando el
 * bot se la pedía y no pasaba nada.
 */
function ubicacionDe(m: WAMessage): { lat?: number; lng?: number; loc?: string | null } {
  const c = m.message ?? {};
  const l = c.locationMessage ?? c.liveLocationMessage;
  if (!l || typeof l.degreesLatitude !== 'number' || typeof l.degreesLongitude !== 'number') return {};
  const nombre = 'name' in l && typeof l.name === 'string' ? l.name : '';
  const direccion = 'address' in l && typeof l.address === 'string' ? l.address : '';
  const loc = [nombre, direccion].filter(Boolean).join(', ') || null;
  return { lat: l.degreesLatitude, lng: l.degreesLongitude, loc };
}

/** El texto que escribió la persona, venga suelto o como pie de un archivo. */
function textoDe(m: WAMessage): { body: string; caption: string } {
  const c = m.message ?? {};

  const body = c.conversation ?? c.extendedTextMessage?.text ?? '';
  const caption =
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    c.documentMessage?.caption ??
    c.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    '';

  return { body: body ?? '', caption: caption ?? '' };
}

// ─────────────────────────────── Salud ────────────────────────────────────

/** Silencio a partir del cual se prueba el camino completo. */
const SILENCIO_MS = 10 * 60 * 1000;

/** Lo que se espera a que el latido dé la vuelta antes de darlo por muerto. */
const LATIDO_TIMEOUT_MS = 90 * 1000;

/** Tipo de archivo según la extensión, para los que WhatsApp trata aparte. */
const MIMES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

function mimeDe(filename: string, dataUri: string | undefined): string {
  // El data URI trae el tipo que dijo Drive, que es más fiable que adivinar
  // por el nombre — en Drive la gente sube archivos sin extensión a diario.
  const delUri = dataUri?.match(/^data:([^;]+);base64,/)?.[1];
  if (delUri) return delUri;

  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIMES[extension] ?? 'application/octet-stream';
}

export class Linea {
  sock: WASocket | null = null;
  state: ConnectionState = 'BOOTING';
  private lastQrPng: Buffer | null = null;
  private lastQrAt: Date | null = null;
  lastError: string | null = null;

  /** Identidad de la cuenta conectada, tal como la reporta WhatsApp. */
  yo: { id: string; lid: string | null; name: string | null } | null = null;

  /** Último momento en que la conexión se comprobó viva. */
  private aliveAt: Date | null = null;

  /**
   * Cuándo WhatsApp nos entregó CUALQUIER evento por última vez. Un socket
   * abierto no prueba nada: puede seguir abierto y no entregar ya nada.
   */
  private lastEventAt: Date | null = null;

  /** Latido en vuelo (solo la principal). null = ninguno esperando. */
  private latidoPendiente: { marca: string; enviadoAt: number } | null = null;

  /** true = se dio de baja: no reconectar aunque el socket se cierre. */
  private detenida = false;
  private vigilante: NodeJS.Timeout | null = null;

  constructor(
    readonly id: string,
    /** Carpeta de credenciales de esta línea. */
    readonly authPath: string,
    private readonly entregar: (payload: PayloadParaCore) => void,
  ) {}

  get esPrincipal(): boolean {
    return this.id === LINEA_PRINCIPAL;
  }

  status() {
    return {
      linea: this.id,
      state: this.state,
      hasQr: this.lastQrPng !== null,
      lastQrAt: this.lastQrAt,
      lastError: this.lastError,
      /**
       * Cuándo respondió por última vez la conexión de verdad. `state` por
       * sí solo miente: se queda en CONNECTED si la sesión muere sin avisar.
       */
      aliveAt: this.aliveAt,
      /** Silencio total desde el último evento entrante. */
      lastEventAt: this.lastEventAt,
      /** El número conectado, sin servidor. null hasta conectar. */
      numero: this.yo?.id ? soloDigitos(this.yo.id) : null,
      nombre: this.yo?.name ?? null,
    };
  }

  getQrPng(): Buffer | null {
    return this.lastQrPng;
  }

  /**
   * El número de teléfono detrás de un LID.
   *
   * WhatsApp ya direcciona muchos chats por LID (`<id>@lid`), que es un
   * identificador opaco. Pero el core tiene los permisos escritos por
   * número, y ese es justo el dato del que depende decidir si alguien puede
   * ver una factura. Si no se puede resolver se devuelve el LID tal cual:
   * el core lo tratará como un desconocido. Fallar hacia el lado que niega.
   */
  private async numeroDe(jid: string, alterno?: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;

    if (alterno && !alterno.endsWith('@lid')) return alterno;

    try {
      const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) return pn;
    } catch {
      // Se avisa abajo, junto al caso de "no hay equivalencia".
    }

    console.warn(`[wa:${this.id}] no se pudo resolver el número de ${jid}`);
    return jid;
  }

  /** De mensaje de Baileys al payload que el core lleva esperando desde siempre. */
  private async aPayload(m: WAMessage): Promise<PayloadParaCore | null> {
    const remoteJid = m.key.remoteJid;
    const id = m.key.id;

    // Sin id no hay idempotencia y sin chat no hay a quién responder.
    if (!remoteJid || !id) return null;

    const esGrupo = isJidGroup(remoteJid) ?? false;
    const fromMe = m.key.fromMe === true;

    // El core trabaja con números, no con LIDs: ver numeroDe().
    const chatId = haciaCore(await this.numeroDe(remoteJid, m.key.remoteJidAlt));

    const participante = m.key.participant ?? undefined;
    const autor = participante
      ? haciaCore(await this.numeroDe(participante, m.key.participantAlt))
      : null;

    const miJid = this.yo?.id ? haciaCore(this.yo.id) : '';
    const { body, caption } = textoDe(m);

    // El chat conmigo mismo: WhatsApp lo direcciona por LID, así que se
    // comparan los dígitos contra el número y el LID de la cuenta.
    const digitosDelChat = soloDigitos(remoteJid);
    const esChatPropio =
      !esGrupo &&
      digitosDelChat.length > 0 &&
      (digitosDelChat === soloDigitos(this.yo?.id ?? '') ||
        digitosDelChat === soloDigitos(this.yo?.lid ?? ''));

    const menciones = m.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];

    return {
      // El id que ve el core lleva la línea y el chat dentro: el id de
      // Baileys solo es único dentro de su conversación, y el core lo usa
      // de llave de idempotencia global.
      id: `${this.esPrincipal ? '' : `${this.id}_`}${fromMe ? 'true' : 'false'}_${chatId}_${id}`,
      linea: this.id,
      chatId,
      from: fromMe ? miJid : (autor ?? chatId),
      to: fromMe ? chatId : miJid,
      author: esGrupo ? autor : null,
      sender: {
        id: fromMe ? miJid : (autor ?? chatId),
        pushname: m.pushName ?? null,
        formattedName: m.pushName ?? null,
      },
      chat: { id: chatId, contact: { isMe: esChatPropio } },
      type: tipoDeMensaje(m),
      body,
      caption,
      ...ubicacionDe(m),
      isGroupMsg: esGrupo,
      fromMe,
      isBroadcast: remoteJid === 'status@broadcast',
      notifyName: m.pushName ?? null,
      mentionedJidList: menciones.map(haciaCore),
      // El core espera segundos, que es como los daba open-wa.
      t: Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)),
    };
  }

  /**
   * Latido de ida y vuelta, solo en la principal: se manda un mensaje al
   * propio número y se espera a que vuelva. En las líneas de empresa no,
   * porque ese mensaje aparecería en el chat propio del teléfono de la
   * empresa; ahí basta el estado del socket.
   */
  private async latir(): Promise<void> {
    if (this.latidoPendiente) {
      if (Date.now() - this.latidoPendiente.enviadoAt > LATIDO_TIMEOUT_MS) {
        this.latidoPendiente = null;
        this.lastError = 'el latido no volvió: WhatsApp ya no entrega eventos';
        console.error(`[latido] ${this.lastError}: reconectando la línea principal`);
        // Antes se salía del proceso; con varias líneas eso tumbaría a
        // todas. Se reconstruye solo el socket de esta.
        this.reiniciar();
      }
      return;
    }

    const silencio = Date.now() - (this.lastEventAt?.getTime() ?? 0);
    if (silencio < SILENCIO_MS) return;

    const destino = this.yo?.id;
    if (!destino) return;

    try {
      const marca = `hb-${Date.now().toString(36)}`;
      this.latidoPendiente = { marca, enviadoAt: Date.now() };
      // El punto invisible hace que casi no se vea mientras da la vuelta.
      await this.sendText(haciaCore(destino), `​${marca}`);
    } catch (err) {
      this.latidoPendiente = null;
      console.error(`[latido] no se pudo enviar: ${String(err)}`);
    }
  }

  private iniciarVigilante(): void {
    if (this.vigilante) return;
    this.vigilante = setInterval(() => {
      void (async () => {
        if (this.state === 'CONNECTED') {
          this.aliveAt = new Date();
          if (this.esPrincipal) await this.latir();
          return;
        }
        if (this.state !== 'WAITING_QR') {
          console.error(`[wa:${this.id}] estado ${this.state}: ${this.lastError ?? 'sin detalle'}`);
        }
      })();
    }, 60_000);
    this.vigilante.unref();
  }

  /** Cierra el socket y lo vuelve a levantar con las credenciales del disco. */
  reiniciar(): void {
    try {
      this.sock?.end(undefined);
    } catch {
      // Si ya estaba cerrado, da igual.
    }
  }

  async start(): Promise<void> {
    this.detenida = false;
    console.log(`[wa:${this.id}] arrancando Baileys...`);

    const { state: auth, saveCreds } = await useMultiFileAuthState(this.authPath);

    // La versión del protocolo la dice WhatsApp, no nosotros.
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth,
      logger,
      // Es lo que sale en "Dispositivos vinculados" del teléfono.
      browser: Browsers.ubuntu('Chrome'),
      // El bot solo atiende lo que llega a partir de ahora.
      syncFullHistory: false,
      // Aparecer siempre en línea hace que WhatsApp deje de mandar
      // notificaciones al teléfono.
      markOnlineOnConnect: false,
    });
    this.sock = sock;

    sock.ev.on('creds.update', () => {
      void saveCreds();
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // En memoria a propósito: un QR es una credencial, no va a disco.
        void qrToBuffer(qr, { width: 400 })
          .then((png) => {
            this.lastQrPng = png;
            this.lastQrAt = new Date();
            this.state = 'WAITING_QR';
            console.log(`[wa:${this.id}] QR nuevo disponible`);
          })
          .catch((err: unknown) => {
            console.error(`[wa:${this.id}] no se pudo dibujar el QR: ${String(err)}`);
          });
      }

      if (connection === 'open') {
        this.state = 'CONNECTED';
        this.aliveAt = new Date();
        this.lastEventAt = new Date();
        this.lastQrPng = null; // ya no sirve y no queremos credenciales en RAM
        this.lastError = null;
        this.yo = {
          id: sock.user?.id ?? '',
          lid: sock.user?.lid ?? null,
          name: sock.user?.name ?? null,
        };
        console.log(`[wa:${this.id}] conectado como ${this.yo.id}`);
        return;
      }

      if (connection === 'close') {
        // Otro socket ya tomó el lugar de este (reinicio): nada que hacer.
        if (this.sock !== sock) return;

        const motivo = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;

        if (this.detenida) {
          this.state = 'DISCONNECTED';
          return;
        }

        // Sesión cerrada desde el teléfono: reconectar no sirve, hace falta
        // un QR nuevo.
        if (motivo === DisconnectReason.loggedOut) {
          this.state = 'DISCONNECTED';
          this.lastError = 'Sesión desvinculada: hay que volver a escanear el QR';
          console.error(`[wa:${this.id}] ${this.lastError}`);
          return;
        }

        this.lastError = `conexión cerrada (${String(motivo)})`;
        console.warn(`[wa:${this.id}] ${this.lastError}: reconectando`);
        this.state = 'BOOTING';

        setTimeout(() => {
          if (this.detenida) return;
          void this.start().catch((err: unknown) => {
            this.state = 'CRASHED';
            this.lastError = String(err);
            console.error(`[wa:${this.id}] no se pudo reconectar: ${this.lastError}`);
          });
        }, 3000);
      }
    });

    // 'messages.upsert' con notify son los mensajes que llegan en vivo.
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      this.lastEventAt = new Date();

      void (async () => {
        for (const m of messages) {
          // En el número de una empresa, lo que manda la propia empresa
          // desde su teléfono no es para el bot: ni comandos del dueño, ni
          // conversaciones que atender.
          if (!this.esPrincipal && m.key.fromMe === true) continue;

          const payload = await this.aPayload(m);
          if (!payload) continue;

          // El latido vuelve por aquí y no se reenvía al core.
          if (this.latidoPendiente && payload.body.includes(this.latidoPendiente.marca)) {
            console.log(`[latido] ida y vuelta en ${Date.now() - this.latidoPendiente.enviadoAt} ms`);
            this.latidoPendiente = null;
            void sock.sendMessage(m.key.remoteJid as string, { delete: m.key }).catch(() => undefined);
            continue;
          }

          this.entregar(payload);
        }
      })();
    });

    this.iniciarVigilante();
  }

  /**
   * Da de baja la línea: cierra la sesión en WhatsApp (sale de "Dispositivos
   * vinculados" del teléfono) y deja de reconectar.
   */
  async cerrarSesion(): Promise<void> {
    this.detenida = true;
    if (this.vigilante) clearInterval(this.vigilante);
    this.vigilante = null;
    try {
      await this.sock?.logout();
    } catch {
      // Sin conexión no se puede avisar a WhatsApp; se borra igual.
    }
    this.sock = null;
    this.state = 'DISCONNECTED';
    this.lastQrPng = null;
  }

  requireSock(): WASocket {
    if (!this.sock || this.state !== 'CONNECTED') {
      throw new Error(`WhatsApp (${this.id}) no está conectado (estado: ${this.state})`);
    }
    return this.sock;
  }

  whoAmI() {
    this.requireSock();
    return {
      hostNumber: soloDigitos(this.yo?.id ?? ''),
      me: {
        id: haciaCore(this.yo?.id ?? ''),
        lid: this.yo?.lid ?? null,
        name: this.yo?.name ?? null,
      },
    };
  }

  // ─────────────────────────────── Envío ──────────────────────────────────

  async sendText(to: string, text: string): Promise<string> {
    const resultado = await this.requireSock().sendMessage(haciaBaileys(to), { text });

    // Un fallo que se reporta como éxito no se reintenta nunca.
    if (!resultado?.key?.id) {
      throw new Error(`WhatsApp rechazó el texto para ${to}`);
    }
    return resultado.key.id;
  }

  /**
   * Envía un archivo. El core NUNCA manda una ruta de disco: `url` para
   * archivos públicos o `base64` (data URI) para lo que ya tiene en RAM.
   * `filename` importa: WhatsApp lo usa para decidir el icono y el visor.
   */
  async sendFile(input: {
    to: string;
    url?: string;
    base64?: string;
    filename: string;
    caption?: string;
    quotedMsgId?: string;
  }): Promise<string> {
    const { url, base64, filename, caption = '' } = input;
    const destino = haciaBaileys(input.to);
    const mimetype = mimeDe(filename, base64);

    let bytes: Buffer;
    if (base64) {
      bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    } else if (url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`no se pudo descargar ${url}: HTTP ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
    } else {
      throw new Error('se requiere "url" o "base64"');
    }

    // Las imágenes van como imagen: como documento llegan sin vista previa.
    const contenido = mimetype.startsWith('image/')
      ? { image: bytes, caption, mimetype }
      : { document: bytes, fileName: filename, mimetype, caption };

    const resultado = await this.requireSock().sendMessage(destino, contenido);
    if (!resultado?.key?.id) {
      throw new Error(`no se pudo enviar ${filename} a ${input.to}`);
    }
    return resultado.key.id;
  }

  /**
   * ¿Existe este número en WhatsApp, y con qué identificador exacto? Que
   * WhatsApp no conteste no es lo mismo que el número no exista: se propaga.
   */
  async checkNumber(candidate: string): Promise<{ exists: boolean; waId: string | null }> {
    const numero = soloDigitos(candidate);
    try {
      const encontrados = await this.requireSock().onWhatsApp(numero);
      const resultado = encontrados?.[0];
      if (!resultado?.exists) return { exists: false, waId: null };
      return { exists: true, waId: haciaCore(resultado.jid) };
    } catch (err) {
      throw new Error(
        `no se pudo comprobar ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async setTyping(to: string, on: boolean): Promise<void> {
    await this.requireSock().sendPresenceUpdate(on ? 'composing' : 'paused', haciaBaileys(to));
  }
}
