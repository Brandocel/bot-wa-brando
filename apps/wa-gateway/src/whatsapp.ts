import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { PendingQueue } from './pending-queue';
import {
  diagnosticarDestino,
  probarEnvio,
  type DiagnosticoDestino,
  type PasoPrueba,
} from './diagnostico';
import { LINEA_PRINCIPAL, Linea, type PayloadParaCore } from './linea';

export { haciaBaileys, haciaCore, soloDigitos } from './linea';

/**
 * Registro de líneas de WhatsApp.
 *
 * Una línea por número: la principal (el número de siempre) y una por cada
 * empresa que conecte el suyo. Este archivo y el mapper del core siguen
 * siendo los únicos que conocen la forma de la librería de WhatsApp; el
 * contrato HTTP de siempre sigue funcionando igual contra la principal, y
 * lo nuevo solo agrega un campo `linea` para elegir otra.
 *
 * Dónde viven las credenciales:
 *  - la principal, donde siempre (WA_SESSION_PATH): no hay que reescanear;
 *  - las demás, una carpeta por línea en WA_LINEAS_PATH, en el mismo disco
 *    persistente. Al arrancar se levantan todas las que haya.
 */

const lineas = new Map<string, Linea>();

/** Solo letras, números, guion y guion bajo: el id es también una carpeta. */
const ID_VALIDO = /^[a-z0-9_-]{1,64}$/i;

const pending = new PendingQueue(config.pendingPath);

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
 * Entrega al core, y si no puede, lo deja en la cola de disco. El core se
 * reinicia en cada despliegue: sin cola, esos segundos eran mensajes
 * perdidos, y "se perdió tu mensaje" es el fallo que un bot de soporte no
 * se puede permitir.
 */
function forwardToCore(payload: PayloadParaCore): void {
  void (async () => {
    if (await deliver(payload)) return;
    console.warn(`[wa] core no disponible: ${payload.id} queda en cola`);
    pending.save(payload.id, payload);
  })();
}

/**
 * Reintenta lo que quedó pendiente. Cada 30 s, en orden de llegada.
 * Reenviar de más es inofensivo: el core descarta duplicados por el id.
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
          console.error(`[cola] MENSAJE PERDIDO ${registro.id} tras ${intentos} intentos`);
          pending.remove(registro.id);
          continue;
        }
        pending.save(registro.id, registro.payload, intentos);
      }
    })();
  }, 30_000);
  timer.unref();
}

// ─────────────────────────────── Líneas ───────────────────────────────────

function nuevaLinea(id: string): Linea {
  const authPath = id === LINEA_PRINCIPAL ? config.session.path : join(config.lineasPath, id);
  const linea = new Linea(id, authPath, forwardToCore);
  lineas.set(id, linea);
  return linea;
}

function arrancar(linea: Linea): void {
  void linea.start().catch((err: unknown) => {
    linea.state = 'CRASHED';
    linea.lastError = String(err);
    console.error(`[wa:${linea.id}] no pudo arrancar: ${linea.lastError}`);
  });
}

/**
 * Arranca la principal y todas las líneas que tengan carpeta en el disco.
 * Una que falle no detiene a las demás.
 */
export async function startWhatsApp(): Promise<void> {
  mkdirSync(config.lineasPath, { recursive: true });

  const principal = nuevaLinea(LINEA_PRINCIPAL);
  await principal.start();

  for (const entrada of readdirSync(config.lineasPath, { withFileTypes: true })) {
    if (!entrada.isDirectory() || !ID_VALIDO.test(entrada.name)) continue;
    if (entrada.name === LINEA_PRINCIPAL) continue;
    arrancar(nuevaLinea(entrada.name));
  }

  startPendingDrain();
}

/** La línea pedida, o la principal si no se pidió ninguna. */
export function linea(id?: string | null): Linea {
  const clave = id && id !== '' ? id : LINEA_PRINCIPAL;
  const encontrada = lineas.get(clave);
  if (!encontrada) throw new Error(`no existe la línea "${clave}"`);
  return encontrada;
}

export function listarLineas() {
  return [...lineas.values()].map((l) => l.status());
}

/**
 * Crea una línea nueva (o devuelve la que ya existe) y la arranca: en unos
 * segundos tiene un QR listo para escanear.
 */
export function crearLinea(id: string) {
  if (!ID_VALIDO.test(id) || id === LINEA_PRINCIPAL) {
    throw new Error('id de línea inválido');
  }
  const existente = lineas.get(id);
  if (existente) {
    // Desvinculada desde el teléfono: se vuelve a arrancar para sacar QR.
    if (existente.state === 'DISCONNECTED' || existente.state === 'CRASHED') arrancar(existente);
    return existente.status();
  }
  mkdirSync(join(config.lineasPath, id), { recursive: true });
  const nueva = nuevaLinea(id);
  arrancar(nueva);
  return nueva.status();
}

/**
 * Da de baja una línea: cierra la sesión en WhatsApp y borra sus
 * credenciales. La principal no se puede borrar desde aquí.
 */
export async function borrarLinea(id: string): Promise<void> {
  if (id === LINEA_PRINCIPAL) throw new Error('la línea principal no se borra');
  const existente = lineas.get(id);
  if (existente) await existente.cerrarSesion();
  lineas.delete(id);
  const carpeta = join(config.lineasPath, id);
  if (ID_VALIDO.test(id) && existsSync(carpeta)) rmSync(carpeta, { recursive: true, force: true });
}

// ──────────────────── Contrato de siempre (principal) ─────────────────────

export const status = () => linea().status();
export const getQrPng = () => linea().getQrPng();

export async function whoAmI(id?: string | null) {
  return linea(id).whoAmI();
}

export async function sendText(to: string, text: string, id?: string | null): Promise<string> {
  return linea(id).sendText(to, text);
}

export async function sendFile(
  input: Parameters<Linea['sendFile']>[0],
  id?: string | null,
): Promise<string> {
  return linea(id).sendFile(input);
}

export async function checkNumber(candidate: string, id?: string | null) {
  return linea(id).checkNumber(candidate);
}

export async function setTyping(to: string, on: boolean, id?: string | null): Promise<void> {
  await linea(id).setTyping(to, on);
}

export async function markSeen(to: string): Promise<void> {
  // Baileys marca leído por mensaje concreto, no por chat, y aquí solo
  // tenemos el chat. Queda como no-op deliberado en vez de fingir que hace
  // algo: el core lo llama por cortesía y no depende del resultado.
  void to;
}

/** Diagnóstico y prueba de envío, sobre la principal. */
export async function diagnosticar(entrada: string): Promise<DiagnosticoDestino> {
  const principal = linea();
  return diagnosticarDestino(principal.requireSock(), entrada, principal.yo);
}

export async function probarEnvioReal(
  destino: string,
  base64: string,
  filename: string,
): Promise<PasoPrueba[]> {
  return probarEnvio(linea().requireSock(), destino, base64, filename);
}
