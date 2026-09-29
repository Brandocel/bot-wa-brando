/**
 * Conector de PC del bot.
 *
 * Vigila UNA carpeta de la computadora del cliente y sube al bot lo que
 * cambia. El bot nunca se conecta a esta PC: todo sale de aquí hacia allá,
 * así que no hay puertos que abrir ni firewall que tocar, y el bot sigue
 * contestando aunque esta PC esté apagada.
 *
 * Se entrega como ConectorBot.exe, descargado desde el panel. Ese .exe
 * trae pegados al final la dirección del bot y un código de conexión, así
 * que el cliente solo le da doble clic y elige la carpeta: no teclea nada
 * ni instala Node.
 *
 * También corre como script, para desarrollo:
 *   node conector.cjs              pide dirección y código, luego vigila
 *   node conector.cjs --olvidar    borra el emparejamiento
 *   node conector.cjs --desinstalar
 *
 * CommonJS y sin dependencias a propósito: es lo que acepta un ejecutable
 * único de Node (SEA).
 */

'use strict';

const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const {
  appendFileSync, closeSync, copyFileSync, existsSync, fstatSync, mkdirSync,
  openSync, readdirSync, readFileSync, readSync, unlinkSync, watch, writeFileSync,
} = require('node:fs');
const { readdir, readFile, stat } = require('node:fs/promises');
const { homedir, hostname } = require('node:os');
const { basename, dirname, extname, join, parse, relative, resolve, sep } = require('node:path');
const { createInterface } = require('node:readline');

/** true cuando corre como ConectorBot.exe y no como script. */
const ES_EXE = (() => {
  try { return require('node:sea').isSea(); } catch { return false; }
})();

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
const LOCK_PATH = join(HOME, 'conector.pid');

/** Donde se copia el .exe para que arranque con Windows aunque borren Descargas. */
const INSTALL_DIR = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ConectorBot') : HOME;
const INSTALLED_EXE = join(INSTALL_DIR, 'ConectorBot.exe');

const STARTUP_VBS = process.env.APPDATA
  ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ConectorBot.vbs')
  : null;

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

// ── Configuración incrustada en el .exe ─────────────────────────────────

/**
 * El panel sirve el .exe con un bloque pegado al final:
 *   \n#CONECTORBOT:<base64 de {"server","code","organization"}>#FIN\n
 * Windows ignora lo que va después del ejecutable, así que no estorba.
 */
function configIncrustada() {
  if (!ES_EXE) return null;
  try {
    const fd = openSync(process.execPath, 'r');
    const tam = fstatSync(fd).size;
    const n = Math.min(8192, tam);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, tam - n);
    closeSync(fd);
    const m = /#CONECTORBOT:([A-Za-z0-9+/=]+)#FIN/.exec(buf.toString('latin1'));
    return m ? JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) : null;
  } catch {
    return null;
  }
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
  if (!res.ok) {
    const err = new Error(`${res.status} ${datos.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return datos;
}

// ── Consola ─────────────────────────────────────────────────────────────

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

/** Con doble clic la ventana se cierra al terminar: sin esto no se alcanza a leer nada. */
async function pausa(texto = 'Presiona Enter para cerrar esta ventana') {
  if (!ES_EXE || !process.stdin.isTTY) return;
  await Promise.race([preguntar(`\n${texto}`), new Promise((r) => setTimeout(r, 5 * 60 * 1000))]);
}

/** En Windows abre el selector de carpetas de siempre. */
function elegirCarpeta() {
  if (process.platform !== 'win32') return null;
  try {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms;' +
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
      '$d.Description = "Elige una carpeta SOLO con los documentos que el bot puede mandar";' +
      '$d.ShowNewFolderButton = $false;' +
      'if ($d.ShowDialog() -eq "OK") { [Console]::Out.Write($d.SelectedPath) }';
    const elegida = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return elegida || null;
  } catch {
    return null;
  }
}

// ── Carpetas que no se aceptan ──────────────────────────────────────────

/**
 * Un cliente eligió una vez el Escritorio entero y se subieron sus
 * credenciales, código y logs. La carpeta tiene que ser SOLO de documentos
 * para el bot: el Escritorio, Documentos, Descargas, la carpeta del
 * usuario, la raíz de OneDrive o del disco (o cualquier carpeta que las
 * contenga) mezclan de todo.
 */
function carpetasAmplias() {
  const home = homedir();
  const nombres = ['Desktop', 'Escritorio', 'Documents', 'Documentos', 'Mis documentos',
    'Downloads', 'Descargas', 'Pictures', 'Imágenes', 'Imagenes', 'Videos', 'Music', 'Música'];
  const bases = [home, process.env.USERPROFILE, process.env.OneDrive,
    process.env.OneDriveCommercial, process.env.OneDriveConsumer].filter(Boolean);

  // "OneDrive - Empresa" y compañía, dentro de la carpeta del usuario.
  try {
    for (const e of readdirSync(home, { withFileTypes: true })) {
      if (e.isDirectory() && /^OneDrive( - .+)?$/i.test(e.name)) bases.push(join(home, e.name));
    }
  } catch { /* sin listado, quedan las de siempre */ }

  const lista = [...bases];
  for (const b of bases) for (const n of nombres) lista.push(join(b, n));

  // Y donde Windows las tenga de verdad: a veces están redirigidas.
  if (process.platform === 'win32') {
    try {
      const script =
        "[Environment]::GetFolderPath('Desktop');" +
        "[Environment]::GetFolderPath('MyDocuments');" +
        "[Environment]::GetFolderPath('MyPictures');" +
        "(New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path";
      const salida = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
      });
      lista.push(...salida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    } catch { /* con las de arriba basta */ }
  }

  return lista.map((p) => resolve(p));
}

/** Por qué no sirve la carpeta, o null si sirve. */
function carpetaDemasiadoAmplia(folder) {
  const norma = (p) => {
    const r = resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const elegida = norma(folder);

  if (elegida === norma(parse(resolve(folder)).root)) return 'es la raíz del disco';

  for (const amplia of carpetasAmplias()) {
    const a = norma(amplia);
    if (elegida === a) return `es ${basename(amplia) || amplia}, que mezcla de todo`;
    if (a.startsWith(elegida + sep.toLowerCase())) return `contiene ${amplia}`;
  }
  return null;
}

/**
 * Pide la carpeta hasta que elijan una que sirva. Antes de canjear el
 * código: si nadie elige nada, el instalador sigue sirviendo.
 */
async function pedirCarpeta() {
  // CONECTOR_CARPETA permite instalar sin ventana (por script o por soporte remoto).
  if (process.env.CONECTOR_CARPETA) {
    const folder = resolve(process.env.CONECTOR_CARPETA);
    const motivo = carpetaDemasiadoAmplia(folder);
    if (motivo) throw new Error(`la carpeta ${folder} no sirve: ${motivo}`);
    return folder;
  }

  for (let intento = 0; intento < 4; intento++) {
    console.log('Elige en la ventana la carpeta con los documentos que el bot puede mandar...');
    let folder = elegirCarpeta();
    if (!folder && !ES_EXE) folder = await preguntar('Ruta de la carpeta (ej. C:\\Documentos\\Facturas)');
    if (!folder) {
      console.log('No elegiste ninguna carpeta. Vamos otra vez.');
      continue;
    }

    folder = resolve(folder);
    if (!existsSync(folder)) {
      console.log(`No existe la carpeta ${folder}. Vamos otra vez.`);
      continue;
    }

    const motivo = carpetaDemasiadoAmplia(folder);
    if (!motivo) return folder;

    console.log(`\nEsa carpeta no sirve: ${motivo}.`);
    console.log('El bot mandaría por WhatsApp todo lo que haya adentro. Crea una carpeta nueva');
    console.log('(por ejemplo "Documentos para el bot"), pon ahí solo lo que tus clientes pueden');
    console.log('recibir, y elígela.\n');
  }

  throw new Error('no se eligió una carpeta válida. Vuelve a abrir el conector cuando la tengas lista.');
}

// ── Primera vez: emparejar ──────────────────────────────────────────────

async function emparejar(incrustada) {
  console.log('\n=== Conectar esta computadora con el bot ===\n');

  const server = (incrustada?.server || (await preguntar('Dirección del bot', process.env.CONECTOR_SERVER || '')))
    .replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) throw new Error('la dirección debe empezar con https://');

  const code = incrustada?.code || (await preguntar('Código de 6 dígitos que sale en el panel'));

  const folder = await pedirCarpeta();

  let par;
  try {
    par = await api({ server }, 'POST', '/connector/pair', { json: { code, deviceName: hostname() } });
  } catch (err) {
    if (err.status === 404) {
      throw new Error(
        incrustada
          ? 'este instalador ya se usó o ya caducó. Descarga uno nuevo desde el panel ("Descargar conector").'
          : 'el código no existe o ya caducó. Genera otro en el panel.',
      );
    }
    throw err;
  }
  console.log(`Conectada a "${par.organization}".\n`);

  const config = { server, token: par.token, organization: par.organization, folder };
  guardarJson(CONFIG_PATH, config);
  guardarJson(CACHE_PATH, {});
  console.log(`Carpeta: ${folder}\n`);
  return config;
}

// ── Una sola copia corriendo ────────────────────────────────────────────

function yaCorriendo() {
  const pid = Number(leerJson(LOCK_PATH, {}).pid);
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function tomarCandado() {
  guardarJson(LOCK_PATH, { pid: process.pid });
  process.on('exit', () => {
    try { if (leerJson(LOCK_PATH, {}).pid === process.pid) unlinkSync(LOCK_PATH); } catch { /* ya no está */ }
  });
}

// ── Arranque automático en Windows ──────────────────────────────────────

/** El comando que arranca el conector sin ventana. */
function lanzadorVbs() {
  const cmd = ES_EXE
    ? `"""${INSTALLED_EXE}"""`
    : `"""${process.execPath}"" ""${__filename}"""`;
  // .vbs y no .cmd: así corre sin ventana negra al prender la PC.
  return 'Set sh = CreateObject("WScript.Shell")\r\n' + `sh.Run ${cmd}, 0, False\r\n`;
}

function instalar() {
  if (!STARTUP_VBS) return;
  if (ES_EXE && resolve(process.execPath).toLowerCase() !== INSTALLED_EXE.toLowerCase()) {
    mkdirSync(INSTALL_DIR, { recursive: true });
    copyFileSync(process.execPath, INSTALLED_EXE);
  }
  mkdirSync(dirname(STARTUP_VBS), { recursive: true });
  writeFileSync(STARTUP_VBS, lanzadorVbs());
}

function arrancarEnSegundoPlano() {
  if (!STARTUP_VBS) return false;
  spawn('wscript.exe', [STARTUP_VBS], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

function desinstalar() {
  if (STARTUP_VBS && existsSync(STARTUP_VBS)) unlinkSync(STARTUP_VBS);
  log('ya no arranca solo con Windows');
}

// ── Recorrido y subida ──────────────────────────────────────────────────

/**
 * Credenciales por nombre: no se suben aunque estén en la carpeta. El
 * servidor aplica la misma regla (document-safety.ts); esto solo evita
 * mandarlas por la red.
 */
const SEP = '[\\/_\\-. ]';
const SENSIBLE = new RegExp(
  `(^|${SEP})(credencial(es)?|contrase(n|ñ)as?|passwords?|passwd|secrets?|tokens?|` +
    `api${SEP}?keys?|private${SEP}?keys?|id_(rsa|dsa|ecdsa|ed25519)|csr|ssl)(?=${SEP}|$)`,
  'i',
);

function ignorado(nombre) {
  return (
    nombre.startsWith('.') ||
    nombre.startsWith('~$') || // archivo de bloqueo de Office abierto
    /\.(tmp|part|crdownload)$/i.test(nombre) ||
    /^(desktop\.ini|thumbs\.db|node_modules|__pycache__|vendor)$/i.test(nombre) ||
    SENSIBLE.test(nombre)
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

/** Vigila la carpeta hasta que se apague la PC. */
async function vigilar(config) {
  tomarCandado();
  log(`vigilando ${config.folder} → ${config.organization}`);

  const tick = () =>
    sincronizar(config).catch((err) => {
      if (err instanceof NoAutorizado) {
        log('este equipo fue desconectado desde el panel. Descarga un conector nuevo para volver a conectarlo.');
        // Sin esto, el próximo arranque trataría de usar el token revocado.
        try { unlinkSync(CONFIG_PATH); } catch { /* ya no está */ }
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

// ── Principal ───────────────────────────────────────────────────────────

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--desinstalar')) return desinstalar();
  if (args.has('--olvidar')) {
    for (const p of [CONFIG_PATH, CACHE_PATH]) if (existsSync(p)) unlinkSync(p);
    return log('emparejamiento borrado');
  }

  let config = leerJson(CONFIG_PATH, null);

  // Doble clic con el conector ya funcionando: solo avisar.
  if (config?.token && yaCorriendo()) {
    console.log(`El conector ya está funcionando en segundo plano.`);
    console.log(`Empresa: ${config.organization}\nCarpeta: ${config.folder}`);
    return pausa();
  }

  if (!config?.token) {
    config = await emparejar(configIncrustada());

    // Como .exe: se copia a su lugar, se registra para arrancar con
    // Windows y se lanza sin ventana. Esta ventana ya puede cerrarse.
    if (ES_EXE && process.platform === 'win32') {
      instalar();
      if (arrancarEnSegundoPlano()) {
        console.log('Listo. El conector ya está trabajando en segundo plano y arrancará solo');
        console.log('cada vez que prendas esta computadora. Tus documentos se están subiendo.');
        return pausa('Presiona Enter para cerrar esta ventana (el conector sigue trabajando)');
      }
    }
  }

  // Un emparejamiento viejo con una carpeta que hoy no se aceptaría: no se
  // sube nada hasta que lo vuelvan a conectar con una carpeta dedicada.
  const motivo = carpetaDemasiadoAmplia(config.folder);
  if (motivo) {
    throw new Error(
      `la carpeta ${config.folder} no sirve (${motivo}). Ejecuta el conector con --olvidar ` +
        'y vuelve a conectarlo eligiendo una carpeta solo con documentos para el bot.',
    );
  }

  if (args.has('--instalar')) instalar();
  await vigilar(config);
}

main().catch(async (err) => {
  log(`error: ${err.message}`);
  process.exitCode = 1;
  await pausa();
});
