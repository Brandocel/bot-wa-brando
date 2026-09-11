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
import { config } from './config';
import { PendingQueue } from './pending-queue';
import {
  diagnosticarDestino,
  probarEnvio,
  type DiagnosticoDestino,
  type PasoPrueba,
} from './diagnostico';

/**
 * Envoltorio delgado sobre Baileys.
 *
 * Este archivo y el mapper del core son los ÚNICOS dos lugares del proyecto
 * que conocen la forma de la librería de WhatsApp. Eso es lo que permitió
 * cambiar open-wa por Baileys sin tocar el core: el contrato HTTP del
 * gateway y la forma del payload que se manda al webhook siguen siendo
 * exactamente los mismos.
 *
 * Por qué se cambió: open-wa 4.76 no puede mandar archivos a los chats que
 * WhatsApp direcciona por LID (`...@lid`). El chat existe con un id y el
 * contacto con otro, y su comprobación de media exige un chat guardado bajo
 * el `@c.us`, que con LID no llega a existir nunca — ni mandando un texto
 * antes, porque ese texto también se entrega en el chat LID. La comprobación
 * vive en el paquete de parches que open-wa descarga al arrancar, así que
 * tampoco se podía rodear. Baileys trata `lid` como un tipo de identificador
 * más, igual que `s.whatsapp.net` o `g.us`.
 *
 * De regalo: Baileys habla el protocolo directamente, sin Chromium. Se
 * acabaron los sesenta segundos de arranque, el medio giga de RAM del
 * navegador y los cerrojos que Chromium dejaba al morir de mala manera.
 */

type ConnectionState =
  | 'BOOTING'
  | 'WAITING_QR'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CRASHED';

let sock: WASocket | null = null;
let state: ConnectionState = 'BOOTING';
let lastQrPng: Buffer | null = null;
let lastQrAt: Date | null = null;
let lastError: string | null = null;

/** Identidad de la cuenta conectada, tal como la reporta WhatsApp. */
let yo: { id: string; lid: string | null; name: string | null } | null = null;

/** Último momento en que la conexión se comprobó viva. */
let aliveAt: Date | null = null;

/**
 * Cuándo WhatsApp nos entregó CUALQUIER evento por última vez.
 *
 * Es la única señal que prueba que el flujo de entrada sigue vivo. Un socket
 * abierto no prueba nada: puede seguir abierto y no entregar ya nada.
 */
let lastEventAt: Date | null = null;

/**
 * Marca del latido en vuelo. null = no hay ninguno esperando respuesta.
 *
 * El latido es la única prueba que no miente: se manda un mensaje y se
 * comprueba que vuelve. Eso ejercita el camino completo —envío, WhatsApp,
 * recepción— que es justo lo que se rompe cuando la sesión queda zombi.
 */
let latidoPendiente: { marca: string; enviadoAt: number } | null = null;

export const status = () => ({
  state,
  hasQr: lastQrPng !== null,
  lastQrAt,
  lastError,
  /**
   * Cuándo respondió por última vez la conexión de verdad.
   *
   * `state` por sí solo miente: se pone en CONNECTED una vez al arrancar y
   * solo cambia si la librería avisa. Cuando la sesión se muere sin avisar
   * —y pasa— el proceso se queda diciendo CONNECTED con WhatsApp caído, que
   * es el peor estado posible: nadie sabe que hay que reiniciar.
   */
  aliveAt,
  /**
   * Silencio total desde el último evento entrante. Un rato largo aquí con
   * el estado en CONNECTED es la firma de la sesión zombi.
   */
  lastEventAt,
});

export const getQrPng = () => lastQrPng;

const pending = new PendingQueue(config.pendingPath);

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

/**
 * El número de teléfono detrás de un LID.
 *
 * WhatsApp ya direcciona muchos chats por LID (`<id>@lid`), que es un
 * identificador opaco: a propósito no contiene el teléfono. Pero el core
 * tiene los permisos, el directorio y la auditoría escritos por número, y
 * ese es justo el dato del que depende decidir si alguien puede ver una
 * factura. Entregarle un LID equivale a entregarle a un desconocido.
 *
 * Dos fuentes, en orden de confianza:
 *  1. `remoteJidAlt` / `participantAlt`, que WhatsApp manda en el propio
 *     mensaje. Es gratis y viene del servidor.
 *  2. La tabla de equivalencias que Baileys mantiene, para cuando el mensaje
 *     no trae el alterno.
 *
 * Si no se puede resolver se devuelve el LID tal cual: el core lo tratará
 * como un desconocido, que es exactamente lo que debe pasar cuando no se
 * sabe quién es. Fallar hacia el lado que niega, nunca hacia el que concede.
 */
async function numeroDe(jid: string, alterno?: string): Promise<string> {
  if (!jid.endsWith('@lid')) return jid;

  if (alterno && !alterno.endsWith('@lid')) return alterno;

  try {
    const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
    if (pn) return pn;
  } catch {
    // Se avisa abajo, junto al caso de "no hay equivalencia".
  }

  // Merece un aviso en el log: el core va a tratar a esta persona como
  // desconocida, y si resulta que sí tenía permiso, este renglón es lo único
  // que explica por qué le dijimos que no.
  console.warn(`[wa] no se pudo resolver el número de ${jid}`);

  return jid;
}

/** Los dígitos del número, sin servidor y sin el sufijo de dispositivo. */
export function soloDigitos(jid: string): string {
  return (jid.split('@')[0] ?? '').split(':')[0] ?? '';
}

// ─────────────────────────────── Entrega al core ──────────────────────────

/** Un intento de entrega. true si el core lo aceptó. */
async function deliver(payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${config.coreWebhookUrl}/webhooks/wa`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gateway-key': config.apiKey,
      },
      body: JSON.stringify({ event: 'message', payload }),
      signal: AbortSignal.timeout(5000),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Entrega al core, y si no puede, lo deja en la cola de disco.
 *
 * Antes había tres reintentos y luego se tiraba el mensaje. El problema es
 * que el core se reinicia en cada despliegue —treinta segundos sin aceptar
 * nada— así que la ventana de pérdida era exactamente la de un deploy
 * normal. Y "se perdió tu mensaje" es el fallo que un bot de soporte no se
 * puede permitir: la persona no sabe que tiene que repetirlo.
 */
async function forwardToCore(payload: PayloadParaCore): Promise<void> {
  if (await deliver(payload)) return;

  console.warn(`[wa] core no disponible: ${payload.id} queda en cola`);
  pending.save(payload.id, payload);
}

/**
 * Reintenta lo que quedó pendiente. Cada 30 s, en orden de llegada.
 *
 * Reenviar de más es inofensivo: el core descarta duplicados por el id de
 * WhatsApp, que es su llave de idempotencia.
 */
function startPendingDrain(): void {
  const timer = setInterval(() => {
    void (async () => {
      const pendientes = pending.list();
      if (pendientes.length === 0) return;

      console.log(`[cola] reintentando ${pendientes.length} mensaje(s)`);

      for (const registro of pendientes) {
        if (await deliver(registro.payload)) {
          pending.remove(registro.id);
          console.log(`[cola] entregado ${registro.id}`);
          continue;
        }

        const intentos = registro.intentos + 1;

        if (pending.agotado({ ...registro, intentos })) {
          console.error(
            `[cola] MENSAJE PERDIDO ${registro.id} tras ${intentos} intentos`,
          );
          pending.remove(registro.id);
          continue;
        }

        pending.save(registro.id, registro.payload, intentos);
      }
    })();
  }, 30_000);

  timer.unref();
}

// ──────────────────────────── Traducción de mensajes ──────────────────────

interface PayloadParaCore {
  id: string;
  chatId: string;
  from: string;
  to: string;
  author: string | null;
  sender: { id: string; pushname: string | null; formattedName: string | null };
  chat: { id: string; contact: { isMe: boolean } };
  type: string;
  body: string;
  caption: string;
  isGroupMsg: boolean;
  fromMe: boolean;
  isBroadcast: boolean;
  notifyName: string | null;
  mentionedJidList: string[];
  t: number;
}

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

  return 'unknown';
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

/**
 * De mensaje de Baileys al payload que el core lleva esperando desde
 * siempre.
 *
 * El core valida este objeto en su capa anticorrupción y no confía en él,
 * así que lo que importa es que los campos signifiquen lo mismo — no que
 * vengan de la misma librería.
 */
async function aPayload(m: WAMessage): Promise<PayloadParaCore | null> {
  const remoteJid = m.key.remoteJid;
  const id = m.key.id;

  // Sin id no hay idempotencia y sin chat no hay a quién responder.
  if (!remoteJid || !id) return null;

  const esGrupo = isJidGroup(remoteJid) ?? false;
  const fromMe = m.key.fromMe === true;

  // El core trabaja con números, no con LIDs: ver numeroDe().
  const chatId = haciaCore(await numeroDe(remoteJid, m.key.remoteJidAlt));

  const participante = m.key.participant ?? undefined;
  const autor = participante
    ? haciaCore(await numeroDe(participante, m.key.participantAlt))
    : null;

  const miJid = yo?.id ? haciaCore(yo.id) : '';

  const { body, caption } = textoDe(m);

  /**
   * El chat conmigo mismo.
   *
   * WhatsApp lo direcciona por LID, así que compararlo contra el número no
   * sirve. Lo que sí se cumple siempre es que el chat es mi propia cuenta, y
   * Baileys da los dos identificadores de la cuenta al conectar: el número y
   * su LID. Se comparan los dígitos porque el jid propio trae además el
   * número de dispositivo (`...:12@s.whatsapp.net`).
   */
  const digitosDelChat = soloDigitos(remoteJid);
  const esChatPropio =
    !esGrupo &&
    digitosDelChat.length > 0 &&
    (digitosDelChat === soloDigitos(yo?.id ?? '') ||
      digitosDelChat === soloDigitos(yo?.lid ?? ''));

  const menciones =
    m.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];

  return {
    // El id que ve el core lleva el chat dentro: el id de Baileys solo es
    // único dentro de su conversación, y el core lo usa de llave de
    // idempotencia global.
    id: `${fromMe ? 'true' : 'false'}_${chatId}_${id}`,
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
    isGroupMsg: esGrupo,
    fromMe,
    isBroadcast: remoteJid === 'status@broadcast',
    notifyName: m.pushName ?? null,
    mentionedJidList: menciones.map(haciaCore),
    // El core espera segundos, que es como los daba open-wa.
    t: Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)),
  };
}

// ─────────────────────────────── Salud ────────────────────────────────────

/** Silencio a partir del cual se prueba el camino completo. */
const SILENCIO_MS = 10 * 60 * 1000;

/** Lo que se espera a que el latido dé la vuelta antes de darlo por muerto. */
const LATIDO_TIMEOUT_MS = 90 * 1000;

/**
 * Latido de ida y vuelta.
 *
 * Se manda un mensaje al propio número y se espera a que vuelva. Si vuelve,
 * el camino completo funciona: el envío llega a WhatsApp y WhatsApp nos
 * sigue entregando eventos. Si no vuelve, algo de ese camino está roto por
 * mucho que el socket siga pareciendo abierto.
 *
 * Solo se lanza tras un rato de silencio. Con tráfico real no hace falta:
 * cada mensaje de un cliente ya prueba lo mismo y gratis.
 */
async function latir(): Promise<void> {
  // Un latido en vuelo que no volvió a tiempo: el camino está roto.
  if (latidoPendiente) {
    if (Date.now() - latidoPendiente.enviadoAt > LATIDO_TIMEOUT_MS) {
      state = 'CRASHED';
      lastError = 'el latido no volvió: WhatsApp ya no entrega eventos';
      console.error(`[latido] ${lastError}: saliendo para reiniciar`);
      setTimeout(() => process.exit(1), 1000);
    }
    return;
  }

  const silencio = Date.now() - (lastEventAt?.getTime() ?? 0);
  if (silencio < SILENCIO_MS) return;

  const destino = yo?.id;
  if (!destino) return;

  try {
    const marca = `hb-${Date.now().toString(36)}`;
    latidoPendiente = { marca, enviadoAt: Date.now() };

    // El punto invisible de delante hace que el mensaje casi no se vea en
    // la lista de chats mientras da la vuelta.
    await sendText(haciaCore(destino), `​${marca}`);
  } catch (err) {
    latidoPendiente = null;
    console.error(`[latido] no se pudo enviar: ${String(err)}`);
  }
}

/**
 * Vigilante de la conexión.
 *
 * Sin Chromium de por medio la sonda es mucho más directa: o hay un socket
 * abierto y autenticado, o no lo hay. Lo que no cambia es la regla de
 * reparación — si el camino está muerto, salir del proceso y dejar que
 * Render levante otro. La sesión vive en el disco persistente, así que el
 * arranque nuevo la recupera sin QR.
 */
function startWatchdog(): void {
  const timer = setInterval(() => {
    void (async () => {
      if (state === 'CONNECTED') {
        aliveAt = new Date();
        // El socket dice que hay sesión. El latido comprueba si además
        // siguen llegando eventos, que es otra cosa.
        await latir();
        return;
      }

      console.error(`[wa] estado ${state}: ${lastError ?? 'sin detalle'}`);
    })();
  }, 60_000);

  timer.unref();
}

// ─────────────────────────────── Arranque ─────────────────────────────────

export async function startWhatsApp(): Promise<void> {
  console.log('[wa] arrancando Baileys...');

  const { state: auth, saveCreds } = await useMultiFileAuthState(
    config.session.path,
  );

  // La versión del protocolo la dice WhatsApp, no nosotros. Fijarla a mano
  // es garantizar que un día deje de funcionar sin avisar.
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[wa] protocolo ${version.join('.')}`);

  sock = makeWASocket({
    version,
    auth,
    logger,
    // Es lo que sale en "Dispositivos vinculados" del teléfono.
    browser: Browsers.ubuntu('Chrome'),
    // El historial completo son megas de mensajes viejos que no vamos a
    // mirar: el bot solo atiende lo que llega a partir de ahora.
    syncFullHistory: false,
    // Aparecer siempre en línea delata que hay un robot y, peor, hace que
    // WhatsApp deje de mandar notificaciones al teléfono del dueño.
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', () => {
    void saveCreds();
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // El QR nunca se imprime en una terminal que puedas ver cuando esto
      // corre en Render, así que se guarda en memoria y se sirve por HTTP.
      // En memoria a propósito: un QR es una credencial, no va a disco.
      void qrToBuffer(qr, { width: 400 })
        .then((png) => {
          lastQrPng = png;
          lastQrAt = new Date();
          state = 'WAITING_QR';
          console.log('[wa] QR nuevo disponible en GET /qr');
        })
        .catch((err: unknown) => {
          console.error(`[wa] no se pudo dibujar el QR: ${String(err)}`);
        });
    }

    if (connection === 'open') {
      state = 'CONNECTED';
      aliveAt = new Date();
      lastEventAt = new Date();
      lastQrPng = null; // ya no sirve y no queremos credenciales en RAM
      lastError = null;

      yo = {
        id: sock?.user?.id ?? '',
        lid: sock?.user?.lid ?? null,
        name: sock?.user?.name ?? null,
      };

      console.log(
        `[wa] conectado como ${yo.id}${yo.lid ? ` (lid ${yo.lid})` : ''}`,
      );
      return;
    }

    if (connection === 'close') {
      const motivo = (lastDisconnect?.error as Boom | undefined)?.output
        ?.statusCode;

      // Sesión cerrada desde el teléfono: reconectar no sirve de nada, hace
      // falta un QR nuevo. Se dice claro en vez de reintentar en bucle.
      if (motivo === DisconnectReason.loggedOut) {
        state = 'DISCONNECTED';
        lastError = 'Sesión desvinculada: hay que reescanear el QR';
        console.error(`[wa] ${lastError}`);
        return;
      }

      lastError = `conexión cerrada (${String(motivo)})`;
      console.warn(`[wa] ${lastError}: reconectando`);
      state = 'BOOTING';

      // Reconectar es reconstruir el socket: las credenciales ya están en
      // disco, así que no hay QR de por medio.
      setTimeout(() => {
        void startWhatsApp().catch((err: unknown) => {
          state = 'CRASHED';
          lastError = String(err);
          console.error(`[wa] no se pudo reconectar: ${lastError}`);
        });
      }, 3000);
    }
  });

  // 'messages.upsert' con notify son los mensajes que llegan en vivo. Incluye
  // los propios, y el asistente personal vive justo ahí: en el chat "Mensajes
  // contigo mismo". El costo es que también nos devuelve lo que el bot acaba
  // de mandar; de eso se protege el core (IdempotencyFilter + LoopGuard).
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;

    lastEventAt = new Date();

    void (async () => {
    for (const m of messages) {
      const payload = await aPayload(m);
      if (!payload) continue;

      // El latido vuelve por aquí. No se reenvía al core: es tráfico
      // nuestro, y meterlo en la conversación del dueño sería ensuciar su
      // historial con ruido de infraestructura.
      if (latidoPendiente && payload.body.includes(latidoPendiente.marca)) {
        console.log(
          `[latido] ida y vuelta en ${Date.now() - latidoPendiente.enviadoAt} ms`,
        );
        latidoPendiente = null;

        // Se borra para no dejar rastro en el chat del dueño. Si no se
        // puede, da igual: es un mensaje corto.
        void sock
          ?.sendMessage(m.key.remoteJid as string, { delete: m.key })
          .catch(() => undefined);
        continue;
      }

      void forwardToCore(payload);
    }
    })();
  });

  startPendingDrain();
  startWatchdog();
}

function requireSock(): WASocket {
  if (!sock || state !== 'CONNECTED') {
    throw new Error(`WhatsApp no está conectado (estado: ${state})`);
  }
  return sock;
}

/**
 * Identidad de la cuenta anfitriona.
 *
 * WhatsApp direcciona chats con LID (`<id>@lid`) y también con el número
 * (`<numero>@c.us`), así que el core no puede asumir el formato: lo pregunta.
 */
export async function whoAmI(): Promise<{
  hostNumber: string;
  me: unknown;
}> {
  requireSock();

  return {
    hostNumber: soloDigitos(yo?.id ?? ''),
    me: {
      id: haciaCore(yo?.id ?? ''),
      lid: yo?.lid ?? null,
      name: yo?.name ?? null,
    },
  };
}

// ─────────────────────────────── Envío ────────────────────────────────────

export async function sendText(to: string, text: string): Promise<string> {
  const resultado = await requireSock().sendMessage(haciaBaileys(to), { text });

  // Baileys lanza cuando falla de verdad; un undefined aquí sería un envío
  // que no llegó a existir, y darlo por bueno dejaría al outbox creyendo que
  // ya entregó. Un fallo que se reporta como éxito no se reintenta nunca.
  if (!resultado?.key?.id) {
    throw new Error(`WhatsApp rechazó el texto para ${to}`);
  }

  return resultado.key.id;
}

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

/**
 * Envía un archivo. Dos orígenes posibles y una regla: el core NUNCA manda
 * una ruta de disco, porque el disco del gateway no es el del core.
 *
 *  - `url`: el gateway lo descarga. Para archivos de acceso público.
 *  - `base64`: data URI completo. Para archivos que el core ya tiene en RAM,
 *    que es lo que pasa con Drive: los baja el core con sus credenciales.
 *
 * `filename` importa más de lo que parece: WhatsApp lo usa para decidir el
 * icono y el visor. Un PDF sin extensión .pdf llega como archivo genérico.
 */
export async function sendFile(input: {
  to: string;
  url?: string;
  base64?: string;
  filename: string;
  caption?: string;
  /** Id de un mensaje del propio chat, para citar. Opcional. */
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
    if (!res.ok) {
      throw new Error(`no se pudo descargar ${url}: HTTP ${res.status}`);
    }
    bytes = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error('se requiere "url" o "base64"');
  }

  // Las imágenes van como imagen y no como documento: mandarlas como
  // documento las entrega dentro de una tarjeta de archivo, sin vista
  // previa, y quien las recibe tiene que abrirlas para ver qué son.
  const contenido = mimetype.startsWith('image/')
    ? { image: bytes, caption, mimetype }
    : { document: bytes, fileName: filename, mimetype, caption };

  const resultado = await requireSock().sendMessage(destino, contenido);

  if (!resultado?.key?.id) {
    throw new Error(`no se pudo enviar ${filename} a ${input.to}`);
  }

  return resultado.key.id;
}

/**
 * ¿Existe este número en WhatsApp, y con qué identificador exacto?
 *
 * Es la única fuente de verdad sobre el formato. La heurística del core
 * (el "1" mexicano y compañía) acierta casi siempre, pero "casi siempre" en
 * un sistema de permisos significa que de vez en cuando alguien con acceso
 * recibe un "no encontré" que nadie sabe explicar.
 *
 * Devuelve el id canónico o null si el número no está en WhatsApp.
 */
export async function checkNumber(
  candidate: string,
): Promise<{ exists: boolean; waId: string | null }> {
  const numero = soloDigitos(candidate);

  try {
    // onWhatsApp devuelve undefined si WhatsApp no contesta nada, que no es
    // lo mismo que "no existe": por eso se separa de la lista vacía.
    const encontrados = await requireSock().onWhatsApp(numero);
    const resultado = encontrados?.[0];

    if (!resultado?.exists) return { exists: false, waId: null };

    return { exists: true, waId: haciaCore(resultado.jid) };
  } catch (err) {
    // Que WhatsApp no conteste no es lo mismo que el número no exista, y
    // confundirlos daría de baja a gente válida. Se propaga.
    throw new Error(
      `no se pudo comprobar ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function setTyping(to: string, on: boolean): Promise<void> {
  await requireSock().sendPresenceUpdate(
    on ? 'composing' : 'paused',
    haciaBaileys(to),
  );
}

export async function markSeen(to: string): Promise<void> {
  // Baileys marca leído por mensaje concreto, no por chat, y aquí solo
  // tenemos el chat. Queda como no-op deliberado en vez de fingir que hace
  // algo: el core lo llama por cortesía y no depende del resultado.
  void to;
}

/**
 * Diagnóstico y prueba de envío. Viven aquí porque el socket no sale de este
 * módulo: quien lo tenga puede hacer cualquier cosa con la cuenta, así que
 * se queda donde está.
 */
export async function diagnosticar(entrada: string): Promise<DiagnosticoDestino> {
  return diagnosticarDestino(requireSock(), entrada, yo);
}

export async function probarEnvioReal(
  destino: string,
  base64: string,
  filename: string,
): Promise<PasoPrueba[]> {
  return probarEnvio(requireSock(), destino, base64, filename);
}
