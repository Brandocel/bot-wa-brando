import { create, ev, type Client, type Message } from '@open-wa/wa-automate';
import { config } from './config';
import { PendingQueue } from './pending-queue';

/**
 * Envoltorio delgado sobre open-wa.
 *
 * Este archivo y el mapper del core son los ÚNICOS dos lugares del proyecto
 * que conocen la forma de open-wa. Si mañana esto se cambia por Baileys,
 * se reescribe este archivo y nada más.
 */

type ConnectionState =
  | 'BOOTING'
  | 'WAITING_QR'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CRASHED';

let client: Client | null = null;
let state: ConnectionState = 'BOOTING';
let lastQrPng: Buffer | null = null;
let lastQrAt: Date | null = null;
let lastError: string | null = null;

/** Último resultado de la sonda contra el cliente real. */
let aliveAt: Date | null = null;
let deadChecks = 0;

export const status = () => ({
  state,
  hasQr: lastQrPng !== null,
  lastQrAt,
  lastError,
  /**
   * Cuándo respondió por última vez el cliente de verdad.
   *
   * `state` por sí solo miente: se pone en CONNECTED una vez al arrancar y
   * solo cambia si open-wa avisa. Cuando la sesión se muere sin avisar —y
   * pasa— el proceso se queda diciendo CONNECTED con WhatsApp caído, que es
   * el peor estado posible: nadie sabe que hay que reiniciar.
   */
  aliveAt,
});

export const getQrPng = () => lastQrPng;

/**
 * El QR nunca se imprime en una terminal que puedas ver cuando esto corre en
 * Render, así que lo guardamos en memoria y lo servimos por HTTP (ver server.ts).
 * En memoria a propósito: un QR es una credencial de sesión, no va a disco.
 */
ev.on('qr.**', (qrDataUrl: string) => {
  lastQrPng = Buffer.from(
    qrDataUrl.replace(/^data:image\/png;base64,/, ''),
    'base64',
  );
  lastQrAt = new Date();
  state = 'WAITING_QR';
  console.log('[wa] QR nuevo disponible en GET /qr');
});

const pending = new PendingQueue(config.pendingPath);

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
async function forwardToCore(message: Message): Promise<void> {
  if (await deliver(message)) return;

  console.warn(`[wa] core no disponible: ${message.id} queda en cola`);
  pending.save(message.id, message);
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

/**
 * Vigilante de la conexión.
 *
 * Cada minuto le pregunta el número a WhatsApp. Es la llamada más barata
 * que atraviesa de verdad hasta el navegador: si contesta, hay sesión.
 *
 * A los tres fallos seguidos el proceso se sale con código 1 y Render lo
 * vuelve a levantar. Tres y no uno porque un fallo aislado es normal
 * —Chromium se pone lento, la red parpadea— y reiniciar por eso sería peor
 * que el problema.
 *
 * Salir del proceso es la reparación correcta aquí: la sesión vive en el
 * disco persistente, así que el arranque nuevo la recupera sin QR. Lo que
 * no se puede es dejar el proceso vivo fingiendo que todo va bien.
 */
function startWatchdog(): void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        await client?.getHostNumber();
        aliveAt = new Date();
        deadChecks = 0;
        if (state === 'CRASHED') state = 'CONNECTED';
      } catch (err) {
        deadChecks += 1;
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[wa] sonda fallida (${deadChecks}/3): ${lastError}`);

        if (deadChecks >= 3) {
          state = 'CRASHED';
          console.error('[wa] sesión muerta: saliendo para que Render reinicie');
          // Un momento para que el log llegue antes de morir.
          setTimeout(() => process.exit(1), 1000);
        }
      }
    })();
  }, 60_000);

  timer.unref();
}

/**
 * User-Agent moderno. Verificado contra web.whatsapp.com: con este UA la
 * página renderiza el QR; con el que trae open-wa por defecto (Chrome/104)
 * responde "actualiza tu navegador" y el QR nunca existe.
 */
const MODERN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * PARCHE a un bug de open-wa 4.76.0.
 *
 * En `dist/controllers/initializer.js` la opción `customUserAgent` solo se
 * lee dentro de `if (config.inDocker)`. Fuera de Docker se ignora en silencio
 * y siempre gana el UA hardcodeado de Chrome/104 — con el que WhatsApp Web
 * sirve la página de "navegador no soportado" y el arranque muere con un
 * timeout de 30s esperando un QR que nunca se dibuja.
 *
 * `browser.js` lee `puppeteer_config.useragent` en el momento de la llamada,
 * así que basta con sobreescribir esa propiedad del módulo antes de create().
 * Se hace aquí y no editando node_modules para que sobreviva a `npm install`
 * y funcione igual en Render.
 *
 * Revisar si una versión futura de open-wa mueve el `customUserAgent` fuera
 * del bloque de Docker; entonces esto se puede borrar.
 */
function patchOpenWaUserAgent(): void {
  const ua = config.userAgent ?? MODERN_UA;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteerConfig = require('@open-wa/wa-automate/dist/config/puppeteer.config') as {
      useragent: string;
    };
    puppeteerConfig.useragent = ua;
    console.log('[wa] User-Agent parchado');
  } catch (err) {
    console.error('[wa] no se pudo parchar el User-Agent:', err);
  }
}

export async function startWhatsApp(): Promise<void> {
  console.log('[wa] arrancando open-wa...');
  patchOpenWaUserAgent();

  client = await create({
    sessionId: config.session.id,
    sessionDataPath: config.session.path,
    multiDevice: true,
    headless: config.headless,

    // Ambas vienen apagadas por defecto en open-wa y son justo lo que hace
    // falta para que WhatsApp acepte vincular el dispositivo:
    //  - useStealth oculta las huellas de automatizacion (navigator.webdriver
    //    y compania) que delatan a Puppeteer.
    //  - ensureHeadfulIntegrity, en palabras de la propia libreria, 'hace que
    //    la sesion headless sea usable incluso en el primer login'; sin esto
    //    el primer vinculo suele necesitar un navegador visible.
    useStealth: true,

    // ensureHeadfulIntegrity: NO activar. Dispara la rutina 'Refreshing session'
    // de Client.js, que llama a WAPI.getUseHereString() -> lee 'localeStrings'
    // de los internos de WhatsApp Web, modulo que ya no existe, y revienta
    // JUSTO despues de que el QR fue aceptado. Sintoma: escaneas bien y el
    // proceso muere solo.
    qrTimeout: 0, // 0 = no se rinde esperando el escaneo
    authTimeout: 0,
    disableSpins: true, // los spinners ensucian los logs de Render
    logConsole: false,
    popup: false,
    blockCrashLogs: true,
    killProcessOnBrowserClose: true,
    executablePath: config.chromiumPath,
    useChrome: config.useChrome,
    customUserAgent: config.userAgent,
    chromiumArgs: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Sin esto Chromium se cae en contenedores: /dev/shm es de 64 MB.
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  state = 'CONNECTED';
  aliveAt = new Date();
  startPendingDrain();
  startWatchdog();
  lastQrPng = null; // ya no sirve y no queremos credenciales colgando en RAM
  console.log('[wa] conectado');

  // onAnyMessage, no onMessage: `onMessage` omite los mensajes propios, y el
  // asistente personal vive justo ahí — en el chat "Mensajes contigo mismo".
  // El costo es que también nos reenvía lo que el bot acaba de mandar; de eso
  // se protege el core (IdempotencyFilter + LoopGuardFilter).
  await client.onAnyMessage(async (message) => {
    await forwardToCore(message);
  });

  await client.onStateChanged((newState) => {
    console.log(`[wa] estado: ${newState}`);
    if (newState === 'CONFLICT' || newState === 'UNLAUNCHED') {
      // CONFLICT = abriste WhatsApp Web en otro lado y nos sacó.
      void client?.forceRefocus();
    }
    if (newState === 'UNPAIRED' || newState === 'UNPAIRED_IDLE') {
      state = 'DISCONNECTED';
      lastError = 'Sesión desvinculada: hay que reescanear el QR';
      console.error(`[wa] ${lastError}`);
    }
  });
}

function requireClient(): Client {
  if (!client || state !== 'CONNECTED') {
    throw new Error(`WhatsApp no está conectado (estado: ${state})`);
  }
  return client;
}

/**
 * Identidad de la cuenta anfitriona.
 *
 * WhatsApp ya direcciona chats con LID (`<id>@lid`) y no solo con el número
 * (`<numero>@c.us`), así que el core no puede asumir el formato: lo pregunta.
 */
export async function whoAmI(): Promise<{
  hostNumber: string;
  me: unknown;
}> {
  const c = requireClient();
  const [hostNumber, me] = await Promise.all([c.getHostNumber(), c.getMe()]);
  return { hostNumber, me };
}

export async function sendText(to: string, text: string): Promise<string> {
  // open-wa devuelve el messageId, o `false` si el envío falló. Ese `false`
  // silencioso es justo el tipo de cosa que el core no debe tener que conocer:
  // aquí se convierte en un error HTTP y el outbox lo reintenta.
  const result = await requireClient().sendText(to as never, text);

  if (typeof result !== 'string') {
    throw new Error(`WhatsApp rechazó el envío a ${to}`);
  }

  return result;
}

/**
 * Envía un archivo. Dos orígenes posibles y una regla: el core NUNCA manda
 * una ruta de disco, porque el disco del gateway no es el del core.
 *
 *  - `url`: el gateway lo descarga. Es el camino normal para Drive, que da
 *    URLs de descarga temporales.
 *  - `base64`: data URI completo. Para archivos que el core ya tiene en RAM.
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
}): Promise<string> {
  const c = requireClient();
  const { to, url, base64, filename, caption = '' } = input;

  const result = url
    ? await c.sendFileFromUrl(to as never, url, filename, caption)
    : await c.sendFile(to as never, base64 as string, filename, caption);

  if (typeof result !== 'string') {
    throw new Error(`WhatsApp rechazó el archivo ${filename} para ${to}`);
  }

  return result;
}

export async function setTyping(to: string, on: boolean): Promise<void> {
  await requireClient().simulateTyping(to as never, on);
}

export async function markSeen(to: string): Promise<void> {
  await requireClient().sendSeen(to as never);
}
