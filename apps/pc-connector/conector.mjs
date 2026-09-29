#!/usr/bin/env node
/**
 * Conector de PC del bot.
 *
 * Vigila UNA carpeta de la computadora del cliente y sube al bot lo que
 * cambia. El bot nunca se conecta a esta PC: todo sale de aquí hacia allá,
 * así que no hay puertos que abrir ni firewall que tocar, y el bot sigue
 * contestando aunque esta PC esté apagada.
 *
 * Uso:
 *   node conector.mjs              primera vez: pide código y carpeta; después, vigila
 *   node conector.mjs --instalar   además, que arranque solo al prender Windows
 *   node conector.mjs --desinstalar
 *   node conector.mjs --olvidar    borra el emparejamiento (para conectar otra empresa)
 *
 * Sin dependencias a propósito: tiene que correr con un Node pelón o
 * empaquetado como .exe.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, watch } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, relative, sep, extname, basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const DEFAULT_SERVER = process.env.CONECTOR_SERVER || '';

/** Revisión completa aunque no haya avisos del sistema de archivos. Sirve de latido. */
const RESCAN_MS = 5 * 60 * 1000;

/** Espera tras un cambio antes de subir: un "Guardar" dispara varios eventos. */
const DEBOUNCE_MS = 4000;

/** Mismo tope que el servidor. */
const MAX_BYTES = 25 * 1024 * 1024;

const MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// ── Estado en disco ─────────────────────────────────────────────────────

const HOME = process.env.APPDATA ? join(process.env.APPDATA, 'ConectorBot') : join(homedir(), '.conector-bot');
const CONFIG_PATH = join(HOME, 'config.json');
const CACHE_PATH = join(HOME, 'huellas.json');
const LOG_PATH = join(HOME, 'conector.log');

mkdirSync(HOME, { recursive: true });

function log(...partes) {
  const linea = `[${new Date().toLocaleString('es-MX')}] ${partes.join(' ')}`;
  console.log(linea);
  try { appendFileSync(LOG_PATH, linea + '\n'); } catch { /* sin log no pasa nada */ }
}

function leerJson(path, porDefecto) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return porDefecto; }
}

function guardarJson(path, valor) {
  writeFileSync(path, JSON.stringify(valor, null, 2));
}

// ── API del bot ─────────────────────────────────────────────────────────

class NoAutorizado extends Error {}

async function api(config, metodo, ruta, { json, bytes, headers = {} } = {}) {
  const res = await fetch(config.server + ruta, {
    method: metodo,
    headers: {
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(bytes ? { 'content-type': 'application/octet-stream' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : bytes,
    signal: AbortSignal.timeout(120_000),
  });

  const datos = await res.json().catch(() => ({}));
  if (res.status === 401) throw new NoAutorizado(datos.message || 'no autorizado');
  if (!res.ok) throw new Error(`${res.status} ${datos.message || res.statusText}`);
  return datos;
}

// ── Primera vez: emparejar ──────────────────────────────────────────────

/**
 * Una sola interfaz y leída como iterador: guarda las líneas que lleguen
 * antes de preguntar, así también funciona con la entrada redirigida.
 */
let lineas = null;

async function preguntar(texto, porDefecto = '') {
  lineas ??= createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  process.stdout.write(porDefecto ? `${texto} [${porDefecto}]: ` : `${texto}: `);
  const { value } = await lineas.next();
  return String(value ?? '').trim() || porDefecto;
}

/** En Windows abre el selector de carpetas de siempre; en otro sistema, se escribe. */
function elegirCarpeta() {
  if (process.platform === 'win32') {
    try {
      const script =
        'Add-Type -AssemblyName System.Windows.Forms;' +
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
        '$d.Description = "Elige la carpeta donde guardas tus documentos";' +
        '$d.ShowNewFolderButton = $false;' +
        'if ($d.ShowDialog() -eq "OK") { [Console]::Out.Write($d.SelectedPath) }';
      const elegida = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
        encoding: 'utf8',
      }).trim();
      if (elegida) return elegida;
    } catch { /* cae a escribirla */ }
  }
  return null;
}

async function emparejar() {
  console.log('\n=== Conectar esta computadora con el bot ===\n');

  const server = (await preguntar('Dirección del bot', DEFAULT_SERVER)).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) throw new Error('la dirección debe empezar con https://');

  const code = await preguntar('Código de 6 dígitos que sale en el panel');
  const par = await api({ server }, 'POST', '/connector/pair', {
    json: { code, deviceName: hostname() },
  });
  console.log(`\nListo: esta computadora quedó conectada a "${par.organization}".\n`);

  // CONECTOR_CARPETA permite instalar sin ventana (por script o por soporte remoto).
  let folder = process.env.CONECTOR_CARPETA || null;
  if (!folder) {
    console.log('Ahora elige la carpeta con los documentos...');
    folder = elegirCarpeta();
  }
  if (!folder) folder = await preguntar('Ruta de la carpeta (ej. C:\\Documentos\\Facturas)');
  folder = resolve(folder);
  if (!existsSync(folder)) throw new Error(`no existe la carpeta ${folder}`);

  const config = { server, token: par.token, organization: par.organization, folder };
  guardarJson(CONFIG_PATH, config);
  guardarJson(CACHE_PATH, {});
  console.log(`\nCarpeta: ${folder}\n`);
  return config;
}

// ── Recorrido y subida ──────────────────────────────────────────────────

function ignorado(nombre) {
  return (
    nombre.startsWith('.') ||
    nombre.startsWith('~$') || // archivo de bloqueo de Office abierto
    /\.(tmp|part|crdownload)$/i.test(nombre) ||
    /^(desktop\.ini|thumbs\.db)$/i.test(nombre)
  );
}

async function recorrer(raiz) {
  const encontrados = [];
  const pendientes = [raiz];

  while (pendientes.length > 0) {
    const dir = pendientes.pop();
    let entradas;
    try { entradas = await readdir(dir, { withFileTypes: true }); } catch { continue; }

    for (const e of entradas) {
      if (ignorado(e.name)) continue;
      const completo = join(dir, e.name);
      if (e.isDirectory()) pendientes.push(completo);
      else if (e.isFile() && MIME[extname(e.name).toLowerCase()]) encontrados.push(completo);
    }
  }

  return encontrados;
}

/**
 * Huella sha256 de cada archivo. Solo se recalcula si cambió el tamaño o
 * la fecha: leer y hashear toda la carpeta cada 5 minutos sería tirar disco.
 */
async function huellas(config) {
  // Carpeta ausente (disco externo desconectado, unidad de red caída): un
  // manifiesto vacío le diría al bot que se borró todo. Mejor no mandar nada.
  if (!existsSync(config.folder)) throw new Error(`no encuentro la carpeta ${config.folder}`);

  const cache = leerJson(CACHE_PATH, {});
  const nueva = {};
  const lista = [];

  for (const completo of await recorrer(config.folder)) {
    const rel = relative(config.folder, completo).split(sep).join('/');
    let info;
    try { info = await stat(completo); } catch { continue; }
    if (info.size > MAX_BYTES) continue;

    const previa = cache[rel];
    let sha256 = previa && previa.size === info.size && previa.mtimeMs === info.mtimeMs ? previa.sha256 : null;

    if (!sha256) {
      try { sha256 = createHash('sha256').update(await readFile(completo)).digest('hex'); }
      catch {
        // Abierto en exclusiva por otro programa. Si ya se conocía, se
        // manda la huella vieja: omitirlo del manifiesto sería borrarlo del bot.
        if (!previa) continue;
        sha256 = previa.sha256;
      }
    }

    nueva[rel] = { size: info.size, mtimeMs: info.mtimeMs, sha256 };
    lista.push({ path: rel, sha256, size: info.size });
  }

  guardarJson(CACHE_PATH, nueva);
  return lista;
}

let corriendo = false;
let otraVez = false;

async function sincronizar(config) {
  if (corriendo) { otraVez = true; return; }
  corriendo = true;

  try {
    do {
      otraVez = false;
      const lista = await huellas(config);
      const r = await api(config, 'POST', '/connector/manifest', { json: { files: lista } });

      if (r.deleted > 0) log(`${r.deleted} archivo(s) ya no están en la carpeta: se quitaron del bot`);

      let subidos = 0;
      for (const rel of r.upload) {
        const entrada = lista.find((f) => f.path === rel);
        try {
          const bytes = await readFile(join(config.folder, ...rel.split('/')));
          await api(config, 'PUT', '/connector/files?path=' + encodeURIComponent(rel), {
            bytes,
            headers: {
              'x-mime-type': MIME[extname(rel).toLowerCase()],
              ...(entrada ? { 'x-sha256': entrada.sha256 } : {}),
            },
          });
          subidos += 1;
          log(`subido: ${rel}`);
        } catch (err) {
          if (err instanceof NoAutorizado) throw err;
          log(`no se pudo subir ${rel}: ${err.message}`);
        }
      }

      if (subidos > 0 || r.upload.length > 0) {
        log(`listo: ${subidos}/${r.upload.length} subido(s), ${lista.length} en la carpeta`);
      }
    } while (otraVez);
  } finally {
    corriendo = false;
  }
}

// ── Arranque automático en Windows ──────────────────────────────────────

const STARTUP_VBS = process.env.APPDATA
  ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ConectorBot.vbs')
  : null;

function instalar() {
  if (!STARTUP_VBS) throw new Error('el arranque automático solo está hecho para Windows');
  const script = fileURLToPath(import.meta.url);
  // .vbs y no .cmd: así corre sin ventana negra al prender la PC.
  const vbs =
    'Set sh = CreateObject("WScript.Shell")\r\n' +
    `sh.Run """${process.execPath}"" ""${script}""", 0, False\r\n`;
  writeFileSync(STARTUP_VBS, vbs);
  log(`arrancará solo al iniciar Windows (${basename(STARTUP_VBS)})`);
}

function desinstalar() {
  if (STARTUP_VBS && existsSync(STARTUP_VBS)) unlinkSync(STARTUP_VBS);
  log('ya no arranca solo con Windows');
}

// ── Principal ───────────────────────────────────────────────────────────

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--desinstalar')) return desinstalar();
  if (args.has('--olvidar')) {
    for (const p of [CONFIG_PATH, CACHE_PATH]) if (existsSync(p)) unlinkSync(p);
    return log('emparejamiento borrado');
  }

  let config = leerJson(CONFIG_PATH, null);
  if (!config?.token) config = await emparejar();
  if (args.has('--instalar')) instalar();

  log(`vigilando ${config.folder} → ${config.organization}`);

  const tick = () =>
    sincronizar(config).catch((err) => {
      if (err instanceof NoAutorizado) {
        log('este equipo fue desconectado desde el panel. Corre "--olvidar" y vuelve a conectarlo.');
        process.exit(2);
      }
      // Sin internet, bot reiniciándose...: se reintenta en la siguiente vuelta.
      log(`sin conexión con el bot (${err.message}); reintento en unos minutos`);
    });

  await tick();
  setInterval(tick, RESCAN_MS);

  let espera = null;
  try {
    watch(config.folder, { recursive: true }, (_evento, nombre) => {
      if (nombre && ignorado(basename(String(nombre)))) return;
      clearTimeout(espera);
      espera = setTimeout(tick, DEBOUNCE_MS);
    });
  } catch (err) {
    // Algunos discos de red no avisan cambios: queda la revisión periódica.
    log(`no se pueden vigilar cambios al momento (${err.message}); reviso cada 5 min`);
  }
}

main().catch((err) => {
  log(`error: ${err.message}`);
  process.exitCode = 1;
});
