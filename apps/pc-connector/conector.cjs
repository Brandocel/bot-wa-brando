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

// ── Ventanas ────────────────────────────────────────────────────────────

/**
 * Como .exe no hay consola: build-exe.cjs lo arma como aplicación de
 * Windows y todo se le dice al cliente con ventanas normales, con botones
 * y sin texto técnico. Como script, en desarrollo, sigue siendo la consola.
 */
const VENTANAS = ES_EXE && process.platform === 'win32';

/** El cliente cerró o canceló: no es un error, no hay nada que avisar. */
class Cancelado extends Error {}

/**
 * Lo que necesitan todas las ventanas. ShowWindow va aparte a propósito:
 * PowerShell se lanza oculto (para que no salga una consola), y Windows
 * aplica ese "oculto" a la PRIMERA ventana que el proceso muestra, que es
 * la nuestra. Sin volver a mostrarla en su evento Shown, la ventana
 * existía, esperaba un clic y nadie la veía: el conector parecía colgado.
 */
const FORMULARIOS =
  'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;' +
  '[System.Windows.Forms.Application]::EnableVisualStyles();' +
  "Add-Type -Name U -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c);';" +
  'function Mostrar($v) { [void][W.U]::ShowWindow($v.Handle, 5); $v.Activate() }';

/**
 * Corre PowerShell y devuelve lo que escribió. Los textos entran por
 * variables de entorno y el script va codificado: ni las comillas ni los
 * acentos de un nombre de empresa o de una carpeta rompen nada. La salida
 * se pide en UTF-8: "Imágenes" tiene que volver como "Imágenes".
 */
function powershell(script, env = {}, timeout = 0) {
  const completo = '[Console]::OutputEncoding = [Text.Encoding]::UTF8;' + script;
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      Buffer.from(completo, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env }, timeout },
  ).trim();
}

/** Un aviso con un solo botón, con la misma ventana que las preguntas. */
async function mensaje(texto) {
  if (!VENTANAS) {
    console.log(`\n${texto}\n`);
    return;
  }
  await opciones(texto, ['Aceptar']);
}

/**
 * Una pregunta con botones grandes, uno debajo de otro; el primero es el
 * recomendado. Devuelve el índice del botón, o -1 si cerraron la ventana.
 */
async function opciones(texto, botones) {
  if (!VENTANAS) {
    console.log(`\n${texto}\n`);
    botones.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
    return Number(await preguntar('Opción', '1')) - 1;
  }

  const script =
    FORMULARIOS +
    '$f = New-Object System.Windows.Forms.Form;' +
    "$f.Text = 'Conector del bot'; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true;" +
    "$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false;" +
    "$f.Font = New-Object System.Drawing.Font('Segoe UI', 10);" +
    "$f.AutoSize = $true; $f.AutoSizeMode = 'GrowAndShrink';" +

    '$p = New-Object System.Windows.Forms.FlowLayoutPanel;' +
    "$p.FlowDirection = 'TopDown'; $p.AutoSize = $true; $p.WrapContents = $false;" +
    // Márgenes a mano: el Padding del formulario no mueve un control sin Dock.
    '$p.Location = New-Object System.Drawing.Point(22, 20);' +
    '$p.Padding = New-Object System.Windows.Forms.Padding(0, 0, 22, 12);' +
    '$l = New-Object System.Windows.Forms.Label;' +
    '$l.Text = $env:CB_TEXTO; $l.AutoSize = $true;' +
    '$l.MaximumSize = New-Object System.Drawing.Size(470, 0);' +
    '$l.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 16);' +
    '$p.Controls.Add($l);' +
    '$script:r = -1; $i = 0;' +
    "foreach ($t in $env:CB_BOTONES.Split('|')) {" +
    '  $b = New-Object System.Windows.Forms.Button;' +
    '  $b.Text = $t; $b.Width = 470; $b.Height = 42; $b.Tag = $i;' +
    '  $b.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 8);' +
    '  if ($i -eq 0) {' +
    "    $b.FlatStyle = 'Flat'; $b.FlatAppearance.BorderSize = 0;" +
    '    $b.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235);' +
    '    $b.ForeColor = [System.Drawing.Color]::White;' +
    "    $b.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold);" +
    '    $f.AcceptButton = $b' +
    '  }' +
    '  $b.Add_Click({ $script:r = $this.Tag; $f.Close() });' +
    '  $p.Controls.Add($b); $i++' +
    '}' +
    '$f.Controls.Add($p);' +
    '$f.Add_Shown({ Mostrar $f });' +
    '[void]$f.ShowDialog();' +
    '[Console]::Out.Write($script:r)';

  try {
    return Number(powershell(script, { CB_TEXTO: texto, CB_BOTONES: botones.join('|') }));
  } catch {
    return -1;
  }
}

/**
 * "Conectando…" con una barra en movimiento, mientras se empareja, se
 * instala y se confirma el arranque (unos segundos sin nada en pantalla
 * hacían pensar que no había pasado nada, y la gente volvía a darle doble
 * clic). No bloquea: se cierra matando su proceso.
 */
function ventanaEspera(texto) {
  if (!VENTANAS) return { cerrar() {} };
  const script =
    FORMULARIOS +
    '$f = New-Object System.Windows.Forms.Form;' +
    "$f.Text = 'Conector del bot'; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true;" +
    "$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ControlBox = $false;" +
    "$f.Font = New-Object System.Drawing.Font('Segoe UI', 10);" +
    '$f.ClientSize = New-Object System.Drawing.Size(420, 110);' +
    '$l = New-Object System.Windows.Forms.Label;' +
    '$l.Text = $env:CB_TEXTO; $l.AutoSize = $true;' +
    '$l.Location = New-Object System.Drawing.Point(22, 22);' +
    '$b = New-Object System.Windows.Forms.ProgressBar;' +
    "$b.Style = 'Marquee'; $b.MarqueeAnimationSpeed = 30;" +
    '$b.Location = New-Object System.Drawing.Point(22, 60); $b.Size = New-Object System.Drawing.Size(376, 18);' +
    '$f.Controls.Add($l); $f.Controls.Add($b);' +
    '$f.Add_Shown({ Mostrar $f });' +
    '[void]$f.ShowDialog()';
  let hijo = null;
  try {
    hijo = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, CB_TEXTO: texto } },
    );
  } catch { /* sin ventana de espera no pasa nada */ }
  return {
    cerrar() {
      try { hijo?.kill(); } catch { /* ya se cerró */ }
    },
  };
}

/** El selector de carpetas de Windows, siempre al frente. */
function elegirCarpeta() {
  try {
    // El selector necesita una ventana dueña visible (ver FORMULARIOS):
    // una transparente que se muestra, abre el selector y se cierra.
    const elegida = powershell(
      FORMULARIOS +
        '$f = New-Object System.Windows.Forms.Form;' +
        "$f.TopMost = $true; $f.Opacity = 0; $f.ShowInTaskbar = $false; $f.StartPosition = 'CenterScreen';" +
        '$f.Add_Shown({' +
        '  Mostrar $f;' +
        '  $d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
        "  $d.Description = 'Elige la carpeta con los documentos que el bot puede mandar';" +
        '  $d.ShowNewFolderButton = $true;' +
        "  if ($d.ShowDialog($f) -eq 'OK') { $script:r = $d.SelectedPath };" +
        '  $f.Close()' +
        '});' +
        '[void]$f.ShowDialog();' +
        'if ($script:r) { [Console]::Out.Write($script:r) }',
    );
    return elegida || null;
  } catch {
    return null;
  }
}

function abrirCarpeta(folder) {
  if (process.platform !== 'win32') return;
  spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
}

/** "Documentos" de verdad, aunque Windows lo tenga en OneDrive o en otro disco. */
function carpetaDocumentos() {
  if (process.platform === 'win32') {
    try {
      const ruta = powershell("[Console]::Out.Write([Environment]::GetFolderPath('MyDocuments'))", {}, 15000);
      if (ruta) return ruta;
    } catch { /* la de siempre */ }
  }
  return join(homedir(), 'Documents');
}

// ── Consola (solo desarrollo) ───────────────────────────────────────────

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
      const salida = powershell(
        "[Environment]::GetFolderPath('Desktop');" +
          "[Environment]::GetFolderPath('MyDocuments');" +
          "[Environment]::GetFolderPath('MyPictures');" +
          "(New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path",
        {},
        15000,
      );
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
    if (elegida === a) return `es la carpeta «${basename(amplia) || amplia}», que mezcla de todo`;
    if (a.startsWith(elegida + sep.toLowerCase())) return `contiene la carpeta «${amplia}»`;
  }
  return null;
}

const TIPOS = [
  [/\.pdf$/i, 'PDF'],
  [/\.(xlsx?|csv)$/i, 'Excel'],
  [/\.docx?$/i, 'Word'],
  [/\.pptx$/i, 'PowerPoint'],
  [/\.(png|jpe?g|webp)$/i, 'imágenes'],
  [/\.txt$/i, 'texto'],
];

/**
 * Qué hay en la carpeta, en palabras: antes de conectar una carpeta que
 * ya existe, la persona ve lo que el bot va a recibir y puede arrepentirse.
 */
async function resumenCarpeta(folder) {
  const archivos = await recorrer(folder);
  const nombre = basename(folder);
  if (archivos.length === 0) {
    return `La carpeta «${nombre}» está vacía por ahora. Después pon ahí los documentos que el bot puede mandar.`;
  }

  const cuenta = new Map();
  for (const a of archivos) {
    const tipo = TIPOS.find(([re]) => re.test(a))?.[1] ?? 'otros';
    cuenta.set(tipo, (cuenta.get(tipo) ?? 0) + 1);
  }
  const detalle = [...cuenta.entries()].map(([tipo, n]) => `${n} ${tipo}`).join(', ');

  return (
    `En «${nombre}» hay ${archivos.length} archivo${archivos.length === 1 ? '' : 's'} que el bot puede leer: ${detalle}.` +
    (archivos.length > 300
      ? '\n\nSon muchos. ¿Seguro que esta carpeta es solo de documentos para tus clientes?'
      : '')
  );
}

/**
 * Pide la carpeta hasta tener una que sirva. Lo recomendado, a un clic, es
 * una carpeta nueva solo para el bot: no hay forma de que se cuele algo.
 * Va ANTES de canjear el código: si nadie elige nada, el instalador sigue
 * sirviendo.
 */
async function pedirCarpeta(organizacion) {
  // CONECTOR_CARPETA permite instalar sin ventanas (por script o por soporte remoto).
  if (process.env.CONECTOR_CARPETA) {
    const folder = resolve(process.env.CONECTOR_CARPETA);
    const motivo = carpetaDemasiadoAmplia(folder);
    if (motivo) throw new Error(`la carpeta ${folder} no sirve: ${motivo}`);
    return folder;
  }

  let texto =
    `Vamos a conectar esta computadora con el bot de WhatsApp${organizacion ? ` de ${organizacion}` : ''}.\n\n` +
    'El bot solo podrá mandar los documentos que pongas en UNA carpeta. Lo más fácil y seguro ' +
    'es una carpeta nueva, solo para eso.';

  for (let intento = 0; intento < 8; intento++) {
    const r = await opciones(texto, [
      'Crear carpeta nueva «Documentos para WhatsApp» (recomendado)',
      'Usar una carpeta que ya tengo',
      'Cancelar',
    ]);

    if (r === 0) {
      const nueva = join(carpetaDocumentos(), 'Documentos para WhatsApp');
      mkdirSync(nueva, { recursive: true });
      return nueva;
    }
    if (r !== 1) throw new Cancelado('no se eligió carpeta');

    let folder = VENTANAS ? elegirCarpeta() : await preguntar('Ruta de la carpeta');
    if (!folder) continue;
    folder = resolve(folder);
    if (!existsSync(folder)) {
      texto = `No encuentro la carpeta ${folder}. Elige otra, o crea una nueva solo para el bot.`;
      continue;
    }

    const motivo = carpetaDemasiadoAmplia(folder);
    if (motivo) {
      texto =
        `Esa carpeta no sirve: ${motivo}.\n\n` +
        'El bot podría mandar por WhatsApp cualquier cosa que haya adentro. Crea una carpeta ' +
        'nueva solo para los documentos de tus clientes, o elige otra.';
      continue;
    }

    const confirmar = await opciones(
      (await resumenCarpeta(folder)) +
        '\n\nAntes de mandarse, cada archivo se revisa: lo que no sea un documento de tu empresa ' +
        '(imágenes de un sitio web, archivos técnicos) o traiga contraseñas no se le entrega a nadie.' +
        '\n\n¿Conectar esta carpeta?',
      ['Conectar esta carpeta', 'Elegir otra', 'Cancelar'],
    );
    if (confirmar === 0) return folder;
    if (confirmar !== 1) throw new Cancelado('no se confirmó la carpeta');
    texto = 'Elige otra carpeta, o crea una nueva solo para los documentos del bot.';
  }

  throw new Cancelado('demasiados intentos');
}

// ── Primera vez: emparejar ──────────────────────────────────────────────

async function emparejar(incrustada) {
  if (!VENTANAS) console.log('\n=== Conectar esta computadora con el bot ===\n');

  const server = (incrustada?.server || (await preguntar('Dirección del bot', process.env.CONECTOR_SERVER || '')))
    .replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) throw new Error('la dirección debe empezar con https://');

  const code = incrustada?.code || (await preguntar('Código de 6 dígitos que sale en el panel'));

  const folder = await pedirCarpeta(incrustada?.organization);

  let par;
  const espera = ventanaEspera('Conectando esta computadora con el bot…');
  try {
    par = await api({ server }, 'POST', '/connector/pair', { json: { code, deviceName: hostname() } });
  } catch (err) {
    espera.cerrar();
    if (err.status === 404) {
      throw new Error(
        incrustada
          ? 'Este instalador ya se usó o ya caducó. Pide uno nuevo a quien te lo mandó.'
          : 'El código no existe o ya caducó. Genera otro en el panel.',
      );
    }
    if (!err.status) {
      throw new Error('No pude comunicarme con el bot. Revisa tu conexión a internet y vuelve a abrir el conector.');
    }
    throw err;
  }
  log(`conectada a "${par.organization}", carpeta ${folder}`);

  const config = { server, token: par.token, organization: par.organization, folder, espera };
  guardarJson(CONFIG_PATH, { server, token: par.token, organization: par.organization, folder });
  guardarJson(CACHE_PATH, {});
  return config;
}

/**
 * Cambia la carpeta sin volver a emparejar: el token sigue valiendo, y el
 * primer manifiesto desde la carpeta nueva quita del bot lo de la vieja.
 */
async function cambiarCarpeta(config) {
  const folder = await pedirCarpeta(config.organization);
  const nuevo = { ...config, folder };
  guardarJson(CONFIG_PATH, nuevo);
  guardarJson(CACHE_PATH, {});
  log(`carpeta cambiada a ${folder}`);
  return nuevo;
}

/**
 * Lanza el conector en segundo plano y comprueba que de verdad arrancó.
 * Antes se daba por hecho, y un arranque que fallaba en silencio dejaba
 * al cliente creyendo que sus documentos se estaban subiendo.
 */
async function arrancarYConfirmar() {
  if (!arrancarEnSegundoPlano()) return false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (yaCorriendo()) return true;
  }
  return false;
}

async function mensajeListo(config) {
  await mensaje(
    `¡Listo! Esta computadora ya está conectada con el bot de ${config.organization}.\n\n` +
      `Pon en la carpeta «${basename(config.folder)}» los documentos que tus clientes pueden ` +
      'recibir por WhatsApp. Cada archivo se revisa antes de mandarse.\n\n' +
      'No tienes que hacer nada más: el conector trabaja solo, sin ventanas, y arranca con ' +
      'Windows. Ahora se abre la carpeta.',
  );
  abrirCarpeta(config.folder);
}

// ── Una sola copia corriendo ────────────────────────────────────────────

/**
 * ¿Ese pid es de verdad otro conector? Que el proceso exista no basta: si
 * uno anterior murió sin limpiar el candado (cerrado a la fuerza, un
 * apagón), Windows reutiliza su pid y el conector nuevo creía que ya había
 * uno trabajando. Se quedaba esperando en una consola invisible y la
 * carpeta nunca se subía.
 */
function esConector(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform !== 'win32') return true;
  try {
    const salida = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return salida.toLowerCase().includes(`"${basename(process.execPath).toLowerCase()}"`);
  } catch {
    return true;
  }
}

function yaCorriendo() {
  return esConector(Number(leerJson(LOCK_PATH, {}).pid));
}

/**
 * Tras un emparejamiento nuevo, el conector que siguiera corriendo trae en
 * memoria el token y la carpeta de antes: se detiene para que arranque el
 * nuevo (y para poder reemplazar el .exe instalado, que está en uso).
 */
function detenerAnterior() {
  const pid = Number(leerJson(LOCK_PATH, {}).pid);
  if (esConector(pid)) {
    try {
      process.kill(pid);
      log(`se detuvo el conector anterior (pid ${pid})`);
    } catch { /* ya terminó */ }
  }
  try { unlinkSync(LOCK_PATH); } catch { /* no había candado */ }
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
    sincronizar(config).catch(async (err) => {
      if (err instanceof NoAutorizado) {
        log('este equipo fue desconectado desde el panel. Descarga un conector nuevo para volver a conectarlo.');
        // Sin esto, el próximo arranque trataría de usar el token revocado.
        try { unlinkSync(CONFIG_PATH); } catch { /* ya no está */ }
        await mensaje(
          `Esta computadora se desconectó del bot de ${config.organization} y ya no sube documentos.\n\n` +
            'Si no fue a propósito, pide un conector nuevo a quien te lo mandó.',
        );
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

  // Doble clic con el conector ya funcionando: abrir la carpeta o cambiarla.
  if (config?.token && yaCorriendo()) {
    // También al log: si esto pasa en segundo plano, nadie ve la ventana.
    log(`ya hay un conector trabajando (pid ${leerJson(LOCK_PATH, {}).pid})`);
    const r = await opciones(
      `El conector ya está funcionando.\n\nEmpresa: ${config.organization}\nCarpeta: ${config.folder}`,
      ['Abrir la carpeta', 'Cambiar de carpeta', 'Cerrar'],
    );
    if (r === 0) abrirCarpeta(config.folder);
    if (r === 1) {
      config = await cambiarCarpeta(config);
      detenerAnterior();
      const arranco = await arrancarYConfirmar();
      await mensajeListo(config);
      if (arranco) return;
      return vigilar(config);
    }
    return;
  }

  if (!config?.token) {
    const { espera, ...emparejada } = await emparejar(configIncrustada());
    config = emparejada;
    detenerAnterior();

    // Como .exe: se copia a su lugar, se registra para arrancar con
    // Windows y se lanza en segundo plano. Si ese arranque no responde,
    // este mismo proceso se queda trabajando: no tiene ventana que cerrar.
    if (VENTANAS) {
      instalar();
      const arranco = await arrancarYConfirmar();
      espera.cerrar();
      await mensajeListo(config);
      if (arranco) return;
      log('el arranque en segundo plano no respondió; este proceso se queda trabajando');
    }
  }

  // Un emparejamiento viejo con una carpeta que hoy no se aceptaría: no se
  // sube nada de ahí. Con ventanas se ofrece elegir otra en el momento.
  const motivo = carpetaDemasiadoAmplia(config.folder);
  if (motivo) {
    log(`la carpeta ${config.folder} no sirve (${motivo})`);
    if (!VENTANAS) {
      throw new Error(
        `la carpeta ${config.folder} no sirve (${motivo}). Ejecuta el conector con --olvidar ` +
          'y vuelve a conectarlo eligiendo una carpeta solo con documentos para el bot.',
      );
    }
    await mensaje(
      `La carpeta que usa el conector ya no se acepta: ${motivo}.\n\n` +
        'Elige una carpeta solo con los documentos que el bot puede mandar.',
    );
    config = await cambiarCarpeta(config);
  }

  if (args.has('--instalar')) instalar();
  await vigilar(config);
}

main().catch(async (err) => {
  if (err instanceof Cancelado) {
    log(`cancelado: ${err.message}`);
    process.exit(0);
  }
  log(`error: ${err.message}`);
  process.exitCode = 1;
  if (VENTANAS) await mensaje(`No se pudo conectar esta computadora.\n\n${err.message}`);
});
