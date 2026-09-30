/**
 * La página del panel, como una cadena.
 *
 * Sin build de frontend, sin framework, sin assets: un HTML que se sirve
 * desde memoria y habla con /panel/api. La alternativa era montar un
 * proyecto aparte con su despliegue, su pipeline y su versión que se
 * desincroniza de la API — para pintar unas tablas y tres formularios.
 *
 * Disposición: menú lateral (plegable, y fuera de pantalla en móvil),
 * contenido al centro, y el hilo de la conversación como columna derecha
 * en pantallas anchas o a pantalla completa en el teléfono. Abrir un hilo
 * nunca tapa la lista de la que venías.
 *
 * Cuando esto crezca lo bastante como para necesitar rutas, estado
 * compartido y componentes de verdad, ese es el momento de separarlo.
 */

/**
 * Iconos en línea (trazos de Lucide, MIT). Sin CDN: el panel no depende
 * de que un tercero esté arriba para dibujar un menú.
 */
const TRAZOS: Record<string, string> = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  empresa: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  carpeta: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="m9.5 10.5 5 5"/><path d="m14.5 10.5-5 5"/>',
  escudo: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  refrescar: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  enviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  cerrar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  atras: '<path d="m15 18-6-6 6-6"/>',
  plegar: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
  basura: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  documentos: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  buscar: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  archivo: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M9 11h6"/>',
  ajustes: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
};

function icono(nombre: keyof typeof TRAZOS, clase = 'ico'): string {
  return `<svg class="${clase}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRAZOS[nombre]}</svg>`;
}

export function loginPage(error = false): string {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis · Entrar</title>${STYLES}</head>
<body class="centered">
  <form class="card login" id="form">
    <span class="logo">${icono('bot', '')}</span>
    <h1>Jarvis</h1>
    <p class="muted small" style="margin:-10px 0 0">Panel de operación</p>
    ${error ? '<div class="alert">Correo o contraseña incorrectos.</div>' : ''}
    <label>Correo<input type="email" name="email" required autocomplete="username"></label>
    <label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label>
    <button type="submit">Entrar</button>
    <div class="alert" id="error" hidden></div>
  </form>
<script>
const form = document.getElementById('form');
const error = document.getElementById('error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;

  const res = await fetch('/panel/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.email.value, password: form.password.value }),
  });

  if (res.ok) { location.href = '/panel'; return; }

  error.textContent = 'Correo o contraseña incorrectos.';
  error.hidden = false;
});
</script>
</body></html>`;
}

export function panelPage(): string {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis · Panel</title>${STYLES}</head>
<body>
<div class="app" id="app">

  <!-- Menú lateral -->
  <aside class="nav" id="nav">
    <div class="nav-brand">
      <span class="logo">${icono('bot', '')}</span>
      <span class="nav-text marca"><strong>Jarvis</strong><small>Panel de operación</small></span>
      <button class="icon nav-text" id="nav-plegar" title="Plegar menú">${icono('panel')}</button>
    </div>
    <nav class="nav-items">
      <button data-view="bandeja" class="active" title="Conversaciones">${icono('chat')}<span class="nav-text">Conversaciones</span><span class="badge nav-text" id="badge-persona" hidden></span></button>
      <button data-view="tickets" title="Tickets">${icono('ticket')}<span class="nav-text">Tickets</span></button>
      <button data-view="directorio" title="Directorio">${icono('usuarios')}<span class="nav-text">Directorio</span></button>
      <button data-view="empresas" title="Empresas">${icono('empresa')}<span class="nav-text">Empresas</span></button>
      <button data-view="documentos" title="Documentos">${icono('documentos')}<span class="nav-text">Documentos</span></button>
      <button data-view="cuarentena" title="Cuarentena">${icono('carpeta')}<span class="nav-text">Cuarentena</span><span class="badge nav-text" id="badge-cuarentena" hidden></span></button>
      <button data-view="auditoria" title="Auditoría">${icono('escudo')}<span class="nav-text">Auditoría</span></button>
      <button data-view="ajustes" title="Ajustes">${icono('ajustes')}<span class="nav-text">Ajustes</span></button>
    </nav>
    <div class="nav-foot">
      <div class="yo">
        <span class="yo-avatar" id="yo-avatar">·</span>
        <span class="nav-text yo-datos"><strong id="yo-nombre"></strong><small id="yo-rol"></small></span>
        <button class="icon" id="logout" title="Salir">${icono('salir')}</button>
      </div>
    </div>
  </aside>
  <div id="nav-velo" hidden></div>

  <!-- Centro -->
  <div class="main">
    <header class="top">
      <button class="icon solo-movil" id="nav-abrir" title="Menú">${icono('menu')}</button>
      <div class="encabezado">
        <h1 id="titulo">Conversaciones</h1>
        <div class="resumen-linea" id="resumen"></div>
      </div>
      <span class="spacer"></span>
      <span class="muted small no-movil" id="reloj"></span>
      <button class="icon redondo" id="refrescar" title="Actualizar">${icono('refrescar')}</button>
    </header>
    <main id="contenido"><p class="muted">Cargando…</p></main>
  </div>

  <!-- Hilo -->
  <aside id="hilo" hidden>
    <div class="hilo-head">
      <button class="icon solo-movil" id="hilo-volver" title="Volver">${icono('atras')}</button>
      <div class="avatar" id="hilo-avatar"></div>
      <div class="hilo-quien">
        <strong id="hilo-nombre"></strong>
        <div class="muted mono small" id="hilo-numero"></div>
      </div>
      <button class="ghost small" id="hilo-tickets-btn" title="Tickets de esta persona">${icono('ticket')}<span id="hilo-tickets-n"></span></button>
      <button class="ghost small" id="hilo-atender"></button>
      <button class="icon peligro" id="hilo-borrar" title="Borrar esta conversación" hidden>${icono('basura')}</button>
      <button class="icon no-movil" id="hilo-cerrar" title="Cerrar">${icono('cerrar')}</button>
    </div>
    <div class="hilo-sub">
      <div id="hilo-estado" class="hilo-estado"></div>
      <div id="hilo-meta" class="hilo-meta"></div>
    </div>
    <div id="hilo-tickets" class="hilo-drawer" hidden>
      <div class="drawer-head"><strong>Tickets</strong><span class="spacer"></span><button class="icon" id="hilo-tickets-cerrar" title="Cerrar">${icono('cerrar')}</button></div>
      <div id="hilo-tickets-lista" class="drawer-lista"></div>
    </div>
    <div id="hilo-borrar-cajon" class="hilo-drawer" hidden>
      <div class="drawer-head"><strong>Borrar conversación</strong><span class="spacer"></span><button class="icon" id="hilo-borrar-cancelar" title="Cancelar">${icono('cerrar')}</button></div>
      <div class="drawer-lista">
        <p class="muted small">Esto afecta a <strong id="hilo-borrar-quien"></strong> y a todos sus hilos (número y LID). No se puede deshacer.</p>
        <div class="opcion-borrar">
          <strong>Borrar los mensajes</strong>
          <p class="muted small">Se va el historial del chat y lo que el bot recordaba de la petición en curso. Los tickets y los permisos se quedan. La próxima vez que escriba, empieza de cero.</p>
          <button class="mini" id="borrar-mensajes">Borrar los mensajes</button>
        </div>
        <div class="opcion-borrar peligro-caja">
          <strong>Eliminar todo</strong>
          <p class="muted small">Desaparece la conversación completa: mensajes <em>y</em> tickets. La persona sigue dada de alta y con sus permisos; solo se borra el rastro de la charla.</p>
          <button class="mini peligro" id="borrar-todo">Eliminar todo</button>
        </div>
      </div>
    </div>
    <div id="hilo-mensajes" class="chat"></div>
    <form id="hilo-form" class="hilo-form">
      <div class="compositor">
        <textarea id="hilo-texto" rows="1" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea>
        <button type="submit" title="Enviar">${icono('enviar')}</button>
      </div>
      <div class="compositor-ayuda no-movil">Enter envía · Shift+Enter nueva línea</div>
    </form>
  </aside>
</div>

<script>
const contenido = document.getElementById('contenido');
const app = document.getElementById('app');
let vistaActual = 'bandeja';
let filtroBandeja = 'todas';
// Lo que se escribió en el buscador de conversaciones. Filtra las filas ya
// pintadas, así no se pierde el foco ni se pide nada al servidor.
let busquedaBandeja = '';
let filtroCuarentena = 'revision';
let docsEmpresa = null;
let docsEstado = 'entregables';
// Qué grupos están abiertos: el refresco cada 20 s repinta la vista y no
// debe cerrarle a nadie el mes que estaba mirando.
const docsAbiertos = new Set();
let yo = null;
let chatAbierto = null;
let ultimoHilo = null;

const TITULOS = {
  bandeja: 'Conversaciones', tickets: 'Tickets', directorio: 'Directorio',
  empresas: 'Empresas', documentos: 'Documentos', cuarentena: 'Cuarentena', auditoria: 'Auditoría', ajustes: 'Ajustes',
};

const api = async (ruta) => {
  const res = await fetch('/panel/api/' + ruta);
  if (res.status === 401) { location.href = '/panel/login'; return null; }
  return res.json();
};

const enviar = async (ruta, cuerpo) => {
  const res = await fetch('/panel/api/' + ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.message || 'no se pudo completar');
  return datos;
};

const esc = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fecha = (iso) => iso
  ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

const hora = (iso) => iso
  ? new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  : '';

/** "hace 5 min", "ayer", "12/09": lo que un humano quiere leer en una lista. */
const hace = (iso) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return 'hace ' + d + ' días';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
};

// Los chats que llegan por el número de una empresa traen un id compuesto
// ("linea:<id>:<chat>"): aquí se separa para enseñar el número de verdad.
const separarLinea = (chatId) => {
  const m = /^linea:([^:]+):(.*)$/.exec(String(chatId ?? ''));
  return m ? { linea: m[1], chat: m[2] } : { linea: null, chat: String(chatId ?? '') };
};
const numeroBonito = (waId) => separarLinea(waId).chat.replace(/@.*$/, '');

/** Qué empresa atiende cada línea, para etiquetar los chats. */
let nombresDeLinea = {};
async function cargarLineas() {
  const empresas = await api('empresas');
  nombresDeLinea = {};
  for (const o of empresas ?? []) if (o.waLineId) nombresDeLinea[o.waLineId] = o.name;
}
const iniciales = (nombre) => String(nombre ?? '?').trim().split(/\\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
// Un color por persona, estable: el mismo nombre siempre se ve igual.
const tono = (nombre) => { let h = 0; for (const ch of String(nombre ?? '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

const CATEGORIAS = ['FACTURA', 'CONTRATO', 'COTIZACION', 'REPORTE', 'POLIZA', 'ESTADO_CUENTA', 'CONTABLE', 'OTRO'];

const NOMBRE_CATEGORIA = {
  FACTURA: 'Facturas', CONTRATO: 'Contratos', COTIZACION: 'Cotizaciones', REPORTE: 'Reportes',
  POLIZA: 'Pólizas', ESTADO_CUENTA: 'Estados de cuenta', CONTABLE: 'Contables', OTRO: 'Otros',
};

const ESTADO_DOC = {
  INDEXED: ['entregable', ''], QUARANTINE: ['por revisar', 'warn'], EXCLUDED: ['descartado', 'warn'],
};

const mesLargo = (iso) => {
  const texto = new Date(iso).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

const tamano = (bytes) => bytes >= 1048576
  ? (bytes / 1048576).toFixed(1) + ' MB'
  : Math.max(1, Math.round(bytes / 1024)) + ' KB';

function tabla(columnas, filas, vacio) {
  if (!filas || filas.length === 0) return '<p class="vacio">' + vacio + '</p>';
  return '<div class="scroll"><table><thead><tr>' +
    columnas.map((c) => '<th>' + c + '</th>').join('') +
    '</tr></thead><tbody>' + filas.join('') + '</tbody></table></div>';
}

function aviso(texto, tipo) {
  const caja = document.createElement('div');
  caja.className = 'toast ' + (tipo || '');
  caja.textContent = texto;
  document.body.appendChild(caja);
  setTimeout(() => caja.remove(), 4000);
}

// ── Menú lateral ────────────────────────────────────────────────────────

function menuPlegado(valor) {
  if (valor === undefined) return app.classList.contains('plegado');
  app.classList.toggle('plegado', valor);
  try { localStorage.setItem('panel.menu', valor ? 'plegado' : 'abierto'); } catch {}
}

function menuMovil(abierto) {
  app.classList.toggle('menu-abierto', abierto);
  document.getElementById('nav-velo').hidden = !abierto;
}

try { menuPlegado(localStorage.getItem('panel.menu') === 'plegado'); } catch {}

document.getElementById('nav-plegar').addEventListener('click', () => menuPlegado(!menuPlegado()));
document.getElementById('nav-abrir').addEventListener('click', () => {
  // En móvil el menú se abre encima; en escritorio el mismo botón lo pliega.
  if (window.innerWidth < 900) menuMovil(!app.classList.contains('menu-abierto'));
  else menuPlegado(!menuPlegado());
});
document.getElementById('nav-velo').addEventListener('click', () => menuMovil(false));

// ── Hilo de conversación ────────────────────────────────────────────────

// Qué clase de mensaje escribió el cliente, como la clasificó el bot.
const ETIQUETAS = {
  SOLICITUD: 'solicitud', QUEJA: 'queja', CONSULTA: 'consulta',
  SEGUIMIENTO: 'seguimiento', PIDE_HUMANO: 'pide persona', CORTESIA: 'cortesía',
};

function etiqueta(m) {
  if (m.direction !== 'IN' || !ETIQUETAS[m.intent]) return '';
  const texto = ETIQUETAS[m.intent] +
    (m.motivo ? ' · ' + m.motivo.replace(/_/g, ' ') : '') +
    (m.molesto ? ' · molesto' : '');
  return '<span class="pill tipo tipo-' + m.intent.toLowerCase() + (m.molesto ? ' molesto' : '') + '">' + esc(texto) + '</span>';
}

const ICONO_ARCHIVO = '${icono('archivo')}';

/**
 * El texto de un mensaje como se ve en WhatsApp: *negritas* y, si es un
 * documento que mandó el bot ("[documento] nombre.pdf"), una tarjeta de
 * archivo en vez de la etiqueta cruda.
 */
function cuerpoMensaje(body) {
  let texto = String(body ?? '').slice(0, 1200);
  let adjunto = '';
  const doc = /^\\[documento\\] (.+)(?:\\n|$)/.exec(texto);
  if (doc) {
    adjunto = '<div class="adjunto">' + ICONO_ARCHIVO + '<span>' + esc(doc[1]) + '</span></div>';
    texto = texto.slice(doc[0].length);
  }
  return adjunto + esc(texto).replace(/\\*([^*\\n]+)\\*/g, '<strong>$1</strong>');
}

/** "Hoy", "Ayer" o la fecha: el separador entre días del hilo. */
function nombreDia(iso) {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function pintarMensajes(datos) {
  const caja = document.getElementById('hilo-mensajes');
  const abajo = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 40;

  let diaAnterior = null;
  const burbujas = datos.messages.map((m) => {
    const dia = new Date(m.createdAt).toDateString();
    const separador = dia !== diaAnterior ? '<div class="dia">' + esc(nombreDia(m.createdAt)) + '</div>' : '';
    diaAnterior = dia;
    return separador +
      '<div class="burbuja ' + (m.direction === 'IN' ? 'entra' : 'sale') + '">' +
        etiqueta(m) +
        cuerpoMensaje(m.body) +
        '<span class="hora">' + hora(m.createdAt) + '</span>' +
      '</div>';
  });

  const pendientes = (datos.pendientes ?? []).map((p) =>
    '<div class="burbuja sale pendiente' + (p.status === 'FAILED' ? ' fallo' : '') + '">' +
      cuerpoMensaje(p.body) +
      '<span class="hora">' + (p.status === 'FAILED'
        ? 'no salió: ' + esc(p.error ?? 'error')
        : 'enviando…') + '</span>' +
    '</div>');

  caja.innerHTML = burbujas.concat(pendientes).join('') ||
    '<p class="muted centro">Sin mensajes todavía.</p>';

  // Solo baja al final si ya estabas abajo: si estás leyendo arriba, no
  // te arrastra.
  if (abajo || ultimoHilo === null) caja.scrollTop = caja.scrollHeight;
}

function pintarEstadoHilo(datos) {
  const boton = document.getElementById('hilo-atender');
  const estado = document.getElementById('hilo-estado');

  if (datos.enManosDePersona) {
    boton.textContent = 'Devolver al bot';
    boton.className = 'ghost small activo';
    boton.title = 'El bot vuelve a contestar este chat';
    estado.innerHTML = '<span class="pill warn">Lo atiendes tú · el bot no contesta</span>' +
      (datos.handoffUntil ? ' <span class="muted small">hasta ' + hora(datos.handoffUntil) + '</span>' : '');
  } else {
    boton.textContent = 'Atender yo';
    boton.className = 'acento';
    boton.title = 'El bot se calla y contestas tú';
    const etiqueta = {
      BOT: ['warn', 'sin responder'],
      AGENTE: ['warn', 'espera a una persona'],
      CLIENTE: ['', 'espera al cliente'],
      NADIE: ['ok', 'al día'],
    }[datos.awaiting] ?? ['', datos.awaiting];
    estado.innerHTML = '<span class="pill ' + etiqueta[0] + '">' + etiqueta[1] + '</span>' +
      '<span class="pill">el bot atiende</span>';
  }
}

async function abrirHilo(chatId, silencioso) {
  chatAbierto = chatId;
  const datos = await api('conversacion?chatId=' + encodeURIComponent(chatId));
  if (!datos) return;

  const nombreHilo = datos.contact?.displayName || numeroBonito(datos.contact?.waId) || datos.chatId;
  document.getElementById('hilo-nombre').textContent = nombreHilo;
  const avatarHilo = document.getElementById('hilo-avatar');
  avatarHilo.textContent = iniciales(nombreHilo);
  avatarHilo.style.setProperty('--h', tono(nombreHilo));
  document.getElementById('hilo-numero').textContent = numeroBonito(datos.contact?.waId || datos.chatId);

  pintarEstadoHilo(datos);

  const membresias = datos.contact?.memberships ?? [];
  document.getElementById('hilo-meta').innerHTML = membresias.length
    ? membresias.map((m) =>
        '<span class="pill">' + esc(m.organization.name) + ' · ' + m.role.toLowerCase() +
        (m.verifiedAt ? '' : ' · <span class="warn-text">sin verificar</span>') + '</span>',
      ).join('')
    : '<span class="pill warn">sin acceso a ninguna empresa</span>';

  // Los tickets van en un cajón lateral, no encima del chat: son casos de
  // soporte, y la mayoría de las conversaciones no tienen ninguno.
  const abiertos = datos.tickets.filter((t) => t.state !== 'CERRADO');
  const contador = document.getElementById('hilo-tickets-n');
  contador.textContent = abiertos.length ? String(abiertos.length) : '';
  document.getElementById('hilo-tickets-btn').classList.toggle('con-abiertos', abiertos.length > 0);

  document.getElementById('hilo-tickets-lista').innerHTML = datos.tickets.length
    ? datos.tickets.map((t) =>
        '<div class="ticket-fila' + (t.state === 'CERRADO' ? ' cerrado' : '') + '">' +
          '<div class="ticket-fila-arriba"><span class="pill ' + t.state + '">#' + t.number + ' · ' + t.state.replace('_', ' ').toLowerCase() + '</span>' +
            '<span class="muted small">' + fecha(t.createdAt) + '</span></div>' +
          '<div class="ticket-fila-asunto">' + esc(t.subject) + '</div>' +
          (t.state !== 'CERRADO'
            ? '<div><button class="mini" data-cerrar="' + t.id + '">Marcar resuelto</button></div>'
            : '<div class="muted small">' + esc(t.closeReason ?? 'cerrado') + '</div>') +
        '</div>',
      ).join('')
    : '<p class="muted centro">Esta persona no ha necesitado soporte.</p>';

  // Borrar es de ADMIN. El servidor lo comprueba igual; esconder el botón
  // es para no ofrecerle a un agente algo que le va a rebotar.
  document.getElementById('hilo-borrar').hidden = yo?.role !== 'ADMIN';
  document.getElementById('hilo-borrar-quien').textContent =
    datos.contact?.displayName || numeroBonito(datos.contact?.waId) || datos.chatId;

  pintarMensajes(datos);
  ultimoHilo = datos;

  document.getElementById('hilo').hidden = false;
  app.classList.add('con-hilo');

  if (!silencioso) {
    document.querySelectorAll('[data-chat]').forEach((el) =>
      el.classList.toggle('abierta', el.dataset.chat === chatId));
    if (window.innerWidth >= 900) document.getElementById('hilo-texto').focus();
  }
}

function cerrarHilo() {
  chatAbierto = null;
  ultimoHilo = null;
  document.getElementById('hilo-borrar-cajon').hidden = true;
  document.getElementById('hilo-tickets').hidden = true;
  document.getElementById('hilo').hidden = true;
  app.classList.remove('con-hilo');
  document.querySelectorAll('[data-chat].abierta').forEach((el) => el.classList.remove('abierta'));
}

document.getElementById('hilo-cerrar').addEventListener('click', cerrarHilo);
document.getElementById('hilo-tickets-btn').addEventListener('click', () => {
  const cajon = document.getElementById('hilo-tickets');
  cajon.hidden = !cajon.hidden;
});
document.getElementById('hilo-tickets-cerrar').addEventListener('click', () => {
  document.getElementById('hilo-tickets').hidden = true;
});
document.getElementById('hilo-volver').addEventListener('click', cerrarHilo);

// ── Borrar la conversación ──────────────────────────────────────────────

const cajonBorrar = document.getElementById('hilo-borrar-cajon');
document.getElementById('hilo-borrar').addEventListener('click', () => {
  document.getElementById('hilo-tickets').hidden = true;
  cajonBorrar.hidden = !cajonBorrar.hidden;
});
document.getElementById('hilo-borrar-cancelar').addEventListener('click', () => {
  cajonBorrar.hidden = true;
});

/**
 * Pide confirmación, borra, y si había tickets abiertos vuelve a preguntar.
 *
 * El servidor es quien sabe si hay tickets sin cerrar, así que el segundo
 * aviso sale de su respuesta y no de una cuenta que el navegador tendría
 * que mantener al día.
 */
async function borrarConversacion(modo) {
  if (!chatAbierto) return;

  const quien = document.getElementById('hilo-borrar-quien').textContent;
  const texto = modo === 'todo'
    ? 'Se elimina la conversación completa de ' + quien + ', mensajes y tickets incluidos.\\n\\nNo se puede deshacer. ¿Seguimos?'
    : 'Se borran los mensajes de ' + quien + ' y lo que el bot recordaba. Los tickets se quedan.\\n\\nNo se puede deshacer. ¿Seguimos?';
  if (!confirm(texto)) return;

  try {
    let resultado;
    try {
      resultado = await enviar('conversacion/borrar', { chatId: chatAbierto, modo });
    } catch (err) {
      if (!err.message.includes('sin cerrar')) throw err;
      if (!confirm(err.message + '\\n\\n¿Borrar de todos modos?')) return;
      resultado = await enviar('conversacion/borrar', { chatId: chatAbierto, modo, forzar: true });
    }

    cajonBorrar.hidden = true;
    aviso(resultado.modo === 'todo'
      ? 'Conversación eliminada (' + resultado.mensajes + ' mensajes, ' + resultado.tickets + ' tickets).'
      : 'Listo: ' + resultado.mensajes + ' mensajes borrados. El hilo queda limpio.');

    if (resultado.modo === 'todo') cerrarHilo();
    else await abrirHilo(chatAbierto, true);

    pintar(vistaActual, true);
    pintarResumen();
  } catch (err) { aviso(err.message, 'error'); }
}

document.getElementById('borrar-mensajes').addEventListener('click', () => borrarConversacion('mensajes'));
document.getElementById('borrar-todo').addEventListener('click', () => borrarConversacion('todo'));

document.getElementById('hilo-atender').addEventListener('click', async () => {
  if (!chatAbierto || !ultimoHilo) return;
  const activo = !ultimoHilo.enManosDePersona;
  try {
    await enviar('conversacion/atender', { chatId: chatAbierto, activo });
    aviso(activo ? 'El bot se calla en este chat; lo atiendes tú.' : 'El bot vuelve a atender este chat.');
    await abrirHilo(chatAbierto, true);
    pintar(vistaActual, true);
  } catch (err) { aviso(err.message, 'error'); }
});

const campoTexto = document.getElementById('hilo-texto');
campoTexto.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('hilo-form').requestSubmit();
  }
});
function ajustarCampo() {
  campoTexto.style.height = 'auto';
  const alto = campoTexto.scrollHeight;
  campoTexto.style.height = Math.min(alto, 160) + 'px';
  campoTexto.style.overflowY = alto > 160 ? 'auto' : 'hidden';
}
campoTexto.addEventListener('input', ajustarCampo);

document.getElementById('hilo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = campoTexto.value.trim();
  if (!texto || !chatAbierto) return;

  campoTexto.value = '';
  ajustarCampo();

  // Se pinta ya, como pendiente: el mensaje existe para ti desde que le
  // das enviar, no desde que WhatsApp lo confirma.
  if (ultimoHilo) {
    ultimoHilo.pendientes = (ultimoHilo.pendientes ?? []).concat([{ body: texto, status: 'PENDING' }]);
    pintarMensajes(ultimoHilo);
  }

  try {
    await enviar('mensaje', { chatId: chatAbierto, text: texto });
    await abrirHilo(chatAbierto, true);
    pintar(vistaActual, true);
  } catch (err) {
    aviso(err.message, 'error');
    campoTexto.value = texto;
    ajustarCampo();
  }
});

// Con un hilo abierto, se refresca solo cada 5 s: lo que conteste el
// cliente aparece sin tocar nada. Sin pisar lo que estás escribiendo.
setInterval(() => {
  if (chatAbierto) abrirHilo(chatAbierto, true);
}, 5000);

document.addEventListener('click', async (e) => {
  const cerrar = e.target.closest('[data-cerrar]');
  if (cerrar) {
    try {
      await enviar('ticket/cerrar', { id: cerrar.dataset.cerrar });
      aviso('Ticket cerrado');
      if (chatAbierto) await abrirHilo(chatAbierto, true);
      pintarResumen();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const ir = e.target.closest('[data-ir]');
  if (ir) {
    if (ir.dataset.irFiltro) filtroBandeja = ir.dataset.irFiltro;
    if (ir.dataset.ir === 'cuarentena') filtroCuarentena = 'revision';
    pintar(ir.dataset.ir);
    return;
  }

  const docsEstadoBtn = e.target.closest('[data-docs-estado]');
  if (docsEstadoBtn) {
    docsEstado = docsEstadoBtn.dataset.docsEstado;
    pintar('documentos');
    return;
  }

  const filtroCuar = e.target.closest('[data-filtro-cuarentena]');
  if (filtroCuar) {
    filtroCuarentena = filtroCuar.dataset.filtroCuarentena;
    pintar('cuarentena');
    return;
  }

  const revisar = e.target.closest('[data-revisar]');
  if (revisar) {
    const aprobar = revisar.dataset.decision === 'aprobar';
    if (aprobar && !confirm('¿Aprobar este archivo? El bot podrá mandarlo por WhatsApp a quien tenga permiso.')) return;
    try {
      await enviar('cuarentena/revisar', { id: revisar.dataset.revisar, decision: revisar.dataset.decision });
      aviso(aprobar ? 'Aprobado: ya se puede entregar' : 'Rechazado: no se entregará');
      pintar('cuarentena');
      pintarResumen();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const filtro = e.target.closest('[data-filtro]');
  if (filtro) {
    filtroBandeja = filtro.dataset.filtro;
    pintar('bandeja');
    return;
  }

  const fila = e.target.closest('[data-chat]');
  if (fila && fila.dataset.chat) abrirHilo(fila.dataset.chat);
});

// ── Buscador de conversaciones ──────────────────────────────────────────

const ICONO_BUSCAR = '${icono('buscar')}';

function normalizarBusqueda(texto) {
  return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
}

function aplicarBusqueda() {
  const q = normalizarBusqueda(busquedaBandeja).trim();
  document.querySelectorAll('.fila[data-busqueda]').forEach((fila) => {
    fila.hidden = q !== '' && !fila.dataset.busqueda.includes(q);
  });
}

document.addEventListener('input', (e) => {
  if (e.target.id !== 'buscar-chat') return;
  busquedaBandeja = e.target.value;
  aplicarBusqueda();
});

// ── Vistas ──────────────────────────────────────────────────────────────

const VISTAS = {
  async bandeja() {
    const consulta = filtroBandeja === 'todas' ? 'bandeja' : 'bandeja?esperando=' + filtroBandeja;
    const [filas] = await Promise.all([api(consulta), cargarLineas()]);

    const chips = [
      ['todas', 'Todas'], ['persona', 'Esperan a una persona'], ['BOT', 'Sin responder'], ['CLIENTE', 'Esperan al cliente'],
    ].map(([valor, texto]) =>
      '<button class="chip' + (filtroBandeja === valor ? ' activo' : '') + '" data-filtro="' + valor + '">' + texto + '</button>',
    ).join('');

    const buscador =
      '<label class="buscador">' + ICONO_BUSCAR +
        '<input id="buscar-chat" type="search" placeholder="Busca por nombre, número o mensaje" value="' + esc(busquedaBandeja) + '">' +
      '</label>';

    const lista = filas.length
      ? '<div class="lista">' + filas.map((c) => {
          const nombre = c.contact?.displayName || numeroBonito(c.contact?.waId) || c.chatId;
          const ultimo = c.ultimo
            ? (c.ultimo.direction === 'OUT' ? '↩ ' : '') + c.ultimo.body.replace(/\\*/g, '').replace(/\\s+/g, ' ').slice(0, 90)
            : 'sin mensajes';
          const estado = c.enManosDePersona
            ? '<span class="estado persona"><i></i>lo atiendes tú</span>'
            : c.awaiting === 'AGENTE' || (c.tickets[0] && c.tickets[0].state === 'EN_REVISION')
              ? '<span class="estado espera"><i></i>espera a una persona</span>'
              : c.awaiting === 'BOT'
                ? '<span class="estado nuevo"><i></i>sin responder</span>'
                : c.awaiting === 'CLIENTE'
                  ? '<span class="estado cliente"><i></i>espera al cliente</span>'
                  : '<span class="estado ok"><i></i>al día</span>';
          const indice = normalizarBusqueda(nombre + ' ' + (c.contact?.waId ?? '') + ' ' + ultimo);
          return '<div class="fila' + (c.chatId === chatAbierto ? ' abierta' : '') + '" data-chat="' + esc(c.chatId) + '" data-busqueda="' + esc(indice) + '">' +
            '<div class="avatar" style="--h:' + tono(nombre) + '">' + esc(iniciales(nombre)) + '</div>' +
            '<div class="fila-cuerpo">' +
              '<div class="fila-arriba"><strong class="recorte">' + esc(nombre) + '</strong>' +
                '<span class="muted small">' + hace(c.lastInboundAt) + '</span></div>' +
              '<div class="fila-abajo"><span class="muted recorte">' + esc(ultimo) + '</span></div>' +
              '<div class="fila-pills">' + estado +
                // Por qué número llegó, si fue por el de una empresa.
                (separarLinea(c.chatId).linea
                  ? ' <span class="pill linea" title="Llegó al WhatsApp de esta empresa">' +
                      esc(nombresDeLinea[separarLinea(c.chatId).linea] ?? 'otra línea') + '</span>'
                  : '') +
                (c.topic ? ' <span class="pill">' + esc(c.topic) + '</span>' : '') +
                (c.quejas ? ' <span class="pill tipo-queja">queja</span>' : '') +
                (c.tickets[0] ? ' <span class="folio">#' + c.tickets[0].number + '</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>'
      : '<p class="vacio">' + (filtroBandeja === 'todas'
          ? 'Nadie ha escrito en las últimas dos semanas.'
          : 'Nada aquí. Todo atendido.') + '</p>';

    setTimeout(aplicarBusqueda, 0);
    return '<div class="barra">' + buscador + '<div class="chips">' + chips + '</div></div>' + lista;
  },

  async tickets() {
    const filas = await api('tickets');
    return tabla(
      ['Folio', 'Asunto', 'Estado', 'Prioridad', 'Empresa', 'Contacto', 'Creado'],
      filas.map((t) => '<tr class="clic" data-chat="' + esc(t.contact?.waId ?? '') + '">' +
        '<td>#' + t.number + '</td>' +
        '<td class="recorte-celda">' + esc(t.subject) + '</td>' +
        '<td><span class="pill ' + t.state + '">' + t.state.replace('_', ' ') + '</span>' +
          (t.level > 0 ? ' <span class="muted small">nivel ' + t.level + '</span>' : '') + '</td>' +
        '<td><span class="pill p' + t.priority + '">' + t.priority + '</span></td>' +
        '<td>' + esc(t.organization?.name ?? '—') + '</td>' +
        '<td>' + esc(t.contact?.displayName ?? numeroBonito(t.contact?.waId)) + '</td>' +
        '<td class="muted">' + fecha(t.createdAt) + '</td>' +
      '</tr>'),
      'No hay tickets.',
    );
  },

  async directorio() {
    const [filas, empresas] = await Promise.all([api('numeros'), api('empresas')]);
    const esAdmin = yo?.role === 'ADMIN';

    const formulario = esAdmin ? \`
      <form class="card form-alta" id="form-numero">
        <h3>Dar de alta un número</h3>
        <div class="campos">
          <label>Número
            <input id="tel" placeholder="9984862017" autocomplete="off" required>
            <small id="tel-preview" class="muted">Escríbelo como lo tengas; yo lo formateo.</small>
          </label>
          <label>Nombre
            <input id="nombre" placeholder="Contadora de Flores" autocomplete="off">
          </label>
          <label>Empresa
            <select id="empresa" required>\${empresas.map((o) =>
              '<option value="' + o.id + '">' + esc(o.name) + '</option>').join('')}</select>
          </label>
          <label>Rol
            <select id="rol">
              <option value="VIEWER">VIEWER · solo lo que marques abajo</option>
              <option value="MANAGER">MANAGER · todo lo de su empresa</option>
              <option value="ADMIN">ADMIN · además autoriza a otros</option>
            </select>
          </label>
        </div>
        <div class="permisos" id="permisos">
          <span class="muted">Puede consultar:</span>
          \${CATEGORIAS.map((c) =>
            '<label class="check"><input type="checkbox" value="' + c + '"> ' + c + '</label>').join('')}
        </div>
        <button type="submit">Agregar al directorio</button>
      </form>\` : '';

    return formulario + tabla(
      ['Número', 'Nombre', 'Empresa', 'Rol', 'Verificado', 'Puede consultar', ''],
      filas.map((m) => '<tr>' +
        '<td class="mono">' + esc(numeroBonito(m.contact.waId)) + '</td>' +
        '<td>' + esc(m.contact.displayName ?? '—') + '</td>' +
        '<td>' + esc(m.organization.name) + '</td>' +
        '<td>' + m.role + '</td>' +
        '<td>' + (m.verifiedAt
          ? '<span class="pill ok">sí</span>'
          : '<span class="pill warn">no</span>') + '</td>' +
        '<td>' + (m.role === 'VIEWER'
          ? (m.grants.map((g) => esc(g.category)).join(', ') || '<span class="muted">nada</span>')
          : '<span class="muted">todo lo de su empresa</span>') + '</td>' +
        '<td class="acciones">' + (esAdmin
          ? (m.verifiedAt ? '' : '<button class="mini" data-verificar="' + m.id + '">Verificar</button> ') +
            '<button class="mini peligro" data-revocar="' + m.id + '">Revocar</button>'
          : '') + '</td>' +
      '</tr>'),
      'No hay números autorizados todavía.',
    );
  },

  async empresas() {
    const filas = await api('empresas');
    const esAdmin = yo?.role === 'ADMIN';

    const formulario = esAdmin ? \`
      <form class="card form-alta" id="form-empresa">
        <h3>Dar de alta una empresa</h3>
        <div class="campos">
          <label>Nombre<input id="emp-nombre" placeholder="Flores de Paula" required></label>
          <label>RFC <span class="muted">(opcional)</span><input id="emp-rfc" placeholder="FDP240101AB1"></label>
          <label>¿De dónde salen sus documentos?
            <select id="emp-origen">
              <option value="PC">Su computadora</option>
              <option value="DRIVE">Google Drive</option>
            </select>
          </label>
          <label id="emp-drive-campo" hidden>Carpeta de Drive
            <input id="emp-drive" placeholder="1a2B3c4D5e6F7g8H">
            <small class="muted">El id que sale en la URL de la carpeta.</small>
          </label>
        </div>
        <button type="submit">Crear empresa</button>
      </form>\` : '';

    const esFalsa = (id) => !!id && id.startsWith('drive-folder-');

    const origen = (o) => {
      if (o.sourceType === 'PC') {
        return '<span class="pill">Su computadora</span> ' +
          '<span class="muted small" data-estado-pc="' + o.id + '">revisando…</span>';
      }
      return (esAdmin
          ? '<input class="mono compacto" value="' + esc(o.driveFolderId) +
            '" data-carpeta="' + o.id + '">'
          : '<span class="mono">' + esc(o.driveFolderId) + '</span>') +
        (esFalsa(o.driveFolderId) ? ' <span class="pill warn">de prueba</span>' : '');
    };

    const acciones = (o) => {
      if (!esAdmin) return '';
      const cambiar = '<select class="compacto" data-origen="' + o.id + '">' +
        '<option value="DRIVE"' + (o.sourceType === 'DRIVE' ? ' selected' : '') + '>Drive</option>' +
        '<option value="PC"' + (o.sourceType === 'PC' ? ' selected' : '') + '>Computadora</option>' +
        '</select> ';
      return cambiar + (o.sourceType === 'PC'
        ? '<button class="mini" data-codigo-pc="' + o.id + '" data-nombre="' + esc(o.name) + '">Conectar PC</button>'
        : '<button class="mini" data-guardar="' + o.id + '">Guardar</button>');
    };

    // El estado de cada conector se pide después de pintar la tabla: son
    // consultas aparte y no deben frenar la vista.
    setTimeout(() => {
      for (const o of filas.filter((x) => x.sourceType === 'PC')) pintarEstadoPc(o.id);
      for (const o of filas.filter((x) => x.waLineId)) pintarEstadoWa(o.id, o.name);
    }, 0);

    return formulario + '<div id="codigo-pc">' + codigoPcVigente() + '</div>' +
      '<div id="qr-wa">' + qrWaVigente() + '</div>' + tabla(
      ['Empresa', 'RFC', 'Origen de documentos', 'WhatsApp', 'Números', 'Documentos', 'Tickets', ''],
      filas.map((o) => '<tr>' +
        '<td>' + esc(o.name) + (o.active ? '' : ' <span class="pill warn">inactiva</span>') + '</td>' +
        '<td>' + esc(o.taxId ?? '—') + '</td>' +
        '<td>' + origen(o) + '</td>' +
        '<td data-estado-wa="' + o.id + '">' + celdaWa(o, null) + '</td>' +
        '<td>' + o._count.memberships + '</td>' +
        '<td>' + o._count.documents + '</td>' +
        '<td>' + o._count.tickets + '</td>' +
        '<td class="acciones">' + acciones(o) + '</td>' +
      '</tr>'),
      'No hay empresas registradas.',
    );
  },

  async documentos() {
    const empresas = await api('empresas');
    if (!empresas.length) return '<p class="vacio">No hay empresas registradas.</p>';
    if (!empresas.some((o) => o.id === docsEmpresa)) docsEmpresa = empresas[0].id;

    const filas = await api('documentos?empresa=' + encodeURIComponent(docsEmpresa) + '&estado=' + docsEstado);

    const selector = '<select class="compacto" id="docs-empresa">' +
      empresas.map((o) => '<option value="' + o.id + '"' + (o.id === docsEmpresa ? ' selected' : '') + '>' +
        esc(o.name) + '</option>').join('') + '</select>';

    const chips = [
      ['entregables', 'Entregables'], ['revision', 'Por revisar'], ['descartados', 'Descartados'], ['todos', 'Todos'],
    ].map(([valor, texto]) =>
      '<button class="chip' + (docsEstado === valor ? ' activo' : '') + '" data-docs-estado="' + valor + '">' + texto + '</button>',
    ).join('');

    const cabecera = '<div class="chips">' + selector + chips +
      '<span class="muted small docs-total">' + filas.length + ' documento' + (filas.length === 1 ? '' : 's') + '</span></div>';

    if (!filas.length) return cabecera + '<p class="vacio">No hay documentos con este filtro.</p>';

    // Tipo → mes → documentos. Los tipos en el orden de siempre; los meses
    // del más reciente al más viejo, y "sin mes" al final.
    const porTipo = new Map();
    for (const d of filas) {
      const mes = d.period ? d.period.slice(0, 7) : 'sin-mes';
      if (!porTipo.has(d.category)) porTipo.set(d.category, new Map());
      const meses = porTipo.get(d.category);
      if (!meses.has(mes)) meses.set(mes, []);
      meses.get(mes).push(d);
    }

    const fila = (d) => {
      const [estado, clase] = ESTADO_DOC[d.status] ?? [d.status, ''];
      const detalle = [d.folio ? 'folio ' + esc(d.folio) : '', d.counterpart ? esc(d.counterpart) : '', tamano(d.sizeBytes)]
        .filter(Boolean).join(' · ');
      return '<tr>' +
        '<td>' + esc(d.name) + (d.summary ? '<div class="muted small">' + esc(d.summary) + '</div>' : '') + '</td>' +
        '<td class="muted small">' + detalle + '</td>' +
        '<td>' + (d.docClass === 'SENSIBLE'
          ? '<span class="pill warn">sensible</span>'
          : '<span class="pill ' + clase + '">' + estado + '</span>') + '</td>' +
      '</tr>';
    };

    const secciones = CATEGORIAS.filter((c) => porTipo.has(c)).map((categoria) => {
      const meses = [...porTipo.get(categoria).entries()].sort(([a], [b]) =>
        a === 'sin-mes' ? 1 : b === 'sin-mes' ? -1 : b.localeCompare(a));
      const total = meses.reduce((n, [, docs]) => n + docs.length, 0);

      return '<section class="card docs-tipo"><h3>' + NOMBRE_CATEGORIA[categoria] +
        ' <span class="muted small">' + total + '</span></h3>' +
        meses.map(([mes, docs]) => {
          const clave = docsEmpresa + '|' + categoria + '|' + mes;
          return '<details class="docs-mes" data-grupo="' + clave + '"' + (docsAbiertos.has(clave) ? ' open' : '') + '>' +
            '<summary>' + (mes === 'sin-mes' ? 'Sin mes' : mesLargo(mes + '-01T00:00:00Z')) +
            ' <span class="muted small">' + docs.length + '</span></summary>' +
            '<div class="scroll"><table><tbody>' + docs.map(fila).join('') + '</tbody></table></div>' +
          '</details>';
        }).join('') +
      '</section>';
    }).join('');

    return cabecera + '<div class="docs-grid">' + secciones + '</div>';
  },

  async ajustes() {
    const r = await api('ajustes/limites');
    const esAdmin = yo?.role === 'ADMIN';
    const l = r.limites;

    const barra = (valor, tope) => {
      const pct = Math.min(100, Math.round((valor / tope) * 100));
      const color = pct >= 100 ? 'rojo' : pct >= 80 ? 'ambar' : 'violeta';
      return '<div class="medidor"><div class="medidor-barra ' + color + '" style="width:' + pct + '%"></div></div>';
    };

    const uso =
      '<section class="card ajustes-uso">' +
        '<h3>Cuántos lleva</h3>' +
        '<p class="muted small">En la última hora, desde las ' + hora(r.desde) + '. Se actualiza solo.</p>' +
        '<div class="uso-cifra"><strong>' + r.global + '</strong> <span class="muted">de ' + l.globalHora + ' mensajes en total</span></div>' +
        barra(r.global, l.globalHora) +
        (r.chats.length
          ? '<div class="muted small uso-titulo">Chats con más mensajes (' +
              (l.contarDocumentos ? 'contando documentos' : 'sin contar documentos') + ')</div>' +
            r.chats.map((c) =>
              '<div class="uso-chat">' +
                '<span class="recorte">' + esc(c.nombre || numeroBonito(c.chatId)) + '</span>' +
                '<span class="muted small">' + c.cuenta + ' de ' + l.porChatHora + '</span>' +
                barra(c.cuenta, l.porChatHora) +
              '</div>').join('')
          : '<p class="muted small">Nadie ha recibido mensajes en la última hora.</p>') +
      '</section>';

    const campo = (clave, etiqueta, ayuda) =>
      '<label>' + etiqueta +
        '<input type="number" name="' + clave + '" value="' + l[clave] + '" min="' + r.rango[clave][0] +
          '" max="' + r.rango[clave][1] + '" required' + (esAdmin ? '' : ' disabled') + '>' +
        '<small class="muted">' + ayuda + ' Entre ' + r.rango[clave][0] + ' y ' + r.rango[clave][1] +
          '; recomendado ' + r.defecto[clave] + '.</small>' +
      '</label>';

    const formulario =
      '<form class="card form-alta" id="form-limites">' +
        '<h3>Topes de mensajes</h3>' +
        '<div class="aviso-riesgo">' +
          '<strong>Antes de subirlos, ten en cuenta</strong>' +
          '<p>El número del bot se conecta como WhatsApp Web, no por la API oficial de WhatsApp. ' +
          'Si manda muchos mensajes seguidos, WhatsApp puede restringirlo o bloquearlo, y con él se ' +
          'detiene la atención de <strong>todas</strong> las empresas. Súbelos poco a poco y solo si el tráfico es de clientes reales.</p>' +
          '<p>Te avisamos por WhatsApp cuando el bot llegue al 80 % y al 100 % del tope total, y cuando un chat llegue a su tope.</p>' +
        '</div>' +
        '<div class="campos">' +
          campo('porChatHora', 'Por chat, por hora', 'Respuestas a una misma persona en una hora.') +
          campo('globalHora', 'En total, por hora', 'Todas las respuestas del bot sumadas. Al llegar, deja de contestar a todos.') +
          campo('porChatMinuto', 'Por chat, por minuto', 'Seguro contra bucles.') +
        '</div>' +
        '<label class="check"><input type="checkbox" name="contarDocumentos"' + (l.contarDocumentos ? ' checked' : '') +
          (esAdmin ? '' : ' disabled') + '> Contar también los documentos enviados en los topes por chat</label>' +
        (esAdmin
          ? '<button type="submit">Guardar topes</button>'
          : '<p class="muted small">Solo un administrador puede cambiarlos.</p>') +
      '</form>';

    return '<div class="ajustes">' + uso + formulario + '</div>';
  },

  async cuarentena() {
    const filas = await api('cuarentena?vista=' + filtroCuarentena);
    const esAdmin = yo?.role === 'ADMIN';

    const chips = [
      ['revision', 'Por revisar'], ['descartados', 'Descartados'],
    ].map(([valor, texto]) =>
      '<button class="chip' + (filtroCuarentena === valor ? ' activo' : '') + '" data-filtro-cuarentena="' + valor + '">' + texto + '</button>',
    ).join('');

    const explicacion = filtroCuarentena === 'revision'
      ? 'Archivos que el clasificador no pudo decidir solo. Mientras estén aquí, no se entregan. ' +
        'Aprueba los que sí son documentos del cliente; rechaza lo interno o ajeno.'
      : 'Archivos que el clasificador dejó fuera por ser internos o ajenos a la empresa (código, logs, ' +
        'imágenes del sitio...). Si alguno sí es del cliente, apruébalo. Los que traen credenciales no se listan.';

    const motivo = (d) => esc(d.classification?.motivo ?? (d.docClass ? '' : 'el clasificador no respondió; se reintenta solo'));
    const periodo = (d) => d.period
      ? new Date(d.period).toLocaleDateString('es-MX', { month: 'short', year: 'numeric', timeZone: 'UTC' })
      : '';

    const acciones = (d) => !esAdmin ? '' :
      '<button class="mini" data-revisar="' + d.id + '" data-decision="aprobar">Aprobar</button> ' +
      (filtroCuarentena === 'revision'
        ? '<button class="mini peligro" data-revisar="' + d.id + '" data-decision="rechazar">Rechazar</button>'
        : '');

    return '<div class="chips">' + chips + '</div>' +
      '<p class="muted">' + explicacion + '</p>' +
      tabla(
        ['Archivo', 'Empresa', 'Qué parece', 'Motivo', 'Llegó', ''],
        filas.map((d) => '<tr>' +
          '<td>' + esc(d.name) + (d.summary ? '<div class="muted small">' + esc(d.summary) + '</div>' : '') + '</td>' +
          '<td>' + esc(d.organization.name) + '</td>' +
          '<td><span class="pill">' + esc(d.category) + '</span> <span class="muted small">' + periodo(d) +
            (d.counterpart ? ' · ' + esc(d.counterpart) : '') + '</span></td>' +
          '<td class="muted small">' + motivo(d) + (d.reviewedBy ? '<div>revisó ' + esc(d.reviewedBy) + '</div>' : '') + '</td>' +
          '<td class="muted">' + fecha(d.indexedAt) + '</td>' +
          '<td class="acciones">' + acciones(d) + '</td>' +
        '</tr>'),
        filtroCuarentena === 'revision' ? 'Nada por revisar.' : 'No hay archivos descartados.',
      );
  },

  async auditoria() {
    const filas = await api('auditoria');
    return '<p class="muted">Toda decisión de acceso, permitida o no. ' +
      'Al cliente siempre se le responde "no encontré"; el motivo real está aquí.</p>' +
      tabla(
        ['Cuándo', 'Número', 'Consulta', 'Decisión', 'Regla'],
        filas.map((a) => '<tr>' +
          '<td class="muted">' + fecha(a.createdAt) + '</td>' +
          '<td class="mono">' + esc(numeroBonito(a.waId)) + '</td>' +
          '<td>' + esc(a.query) + '</td>' +
          '<td><span class="pill ' + (a.decision === 'ALLOW' ? 'ok' : 'warn') + '">' +
            esc(a.decision) + '</span></td>' +
          '<td class="muted">' + esc(a.decidedBy) + '</td>' +
        '</tr>'),
        'Sin registros.',
      );
  },
};

// ── Formularios ─────────────────────────────────────────────────────────

let temporizador = null;

document.addEventListener('input', (e) => {
  if (e.target.id !== 'tel') return;

  clearTimeout(temporizador);
  const salida = document.getElementById('tel-preview');
  salida.className = 'muted';
  salida.textContent = 'Comprobando…';

  temporizador = setTimeout(async () => {
    try {
      const r = await enviar('numeros/preview', { phone: e.target.value });

      if (r.error) {
        salida.className = 'warn-text';
        salida.textContent = r.error;
        return;
      }

      salida.className = r.exists ? 'ok-text' : 'warn-text';
      salida.textContent = r.exists
        ? 'Se guardará como ' + r.display + ' · WhatsApp lo reconoce'
        : r.unverified
          ? 'Se guardará como ' + r.display + ' · no se pudo comprobar con WhatsApp'
          : 'Se guardará como ' + r.display + ' · WhatsApp NO reconoce este número';
    } catch (err) {
      salida.className = 'warn-text';
      salida.textContent = err.message;
    }
  }, 400);
});

// Recordar qué meses están abiertos. "toggle" no burbujea: se escucha en
// la fase de captura.
document.addEventListener('toggle', (e) => {
  const grupo = e.target.dataset?.grupo;
  if (!grupo) return;
  if (e.target.open) docsAbiertos.add(grupo); else docsAbiertos.delete(grupo);
}, true);

document.addEventListener('change', async (e) => {
  if (e.target.id === 'docs-empresa') {
    docsEmpresa = e.target.value;
    pintar('documentos');
    return;
  }

  if (e.target.id === 'emp-origen') {
    const drive = e.target.value === 'DRIVE';
    document.getElementById('emp-drive-campo').hidden = !drive;
    document.getElementById('emp-drive').required = drive;
    return;
  }

  if (e.target.dataset.origen) {
    const id = e.target.dataset.origen;
    const sourceType = e.target.value;
    let driveFolderId;
    if (sourceType === 'DRIVE') {
      driveFolderId = prompt('Id de la carpeta de Drive (vacío = la que tenía antes):');
      if (driveFolderId === null) { pintar('empresas'); return; }
    } else if (!confirm('¿Cambiar a "su computadora"? El bot dejará de leer su carpeta de Drive.')) {
      pintar('empresas');
      return;
    }
    try {
      await enviar('empresas/origen', { id, sourceType, driveFolderId });
      aviso(sourceType === 'PC' ? 'Listo. Pulsa "Conectar PC" para sacar el código.' : 'Listo. Se va a volver a leer la carpeta de Drive.');
    } catch (err) { aviso(err.message, 'error'); }
    pintar('empresas');
    return;
  }

  if (e.target.id !== 'rol') return;
  document.getElementById('permisos').hidden = e.target.value !== 'VIEWER';
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'form-limites') {
    e.preventDefault();
    const f = e.target;
    const datos = {
      porChatHora: Number(f.porChatHora.value),
      globalHora: Number(f.globalHora.value),
      porChatMinuto: Number(f.porChatMinuto.value),
      contarDocumentos: f.contarDocumentos.checked,
    };
    if (!confirm('¿Guardar estos topes?\\n\\nSubirlos de más puede hacer que WhatsApp restrinja el número del bot, y con él se detiene la atención de todas las empresas.')) return;
    try {
      await enviar('ajustes/limites', datos);
      aviso('Topes guardados: aplican desde el siguiente mensaje');
      pintar('ajustes');
      pintarResumen();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  if (e.target.id === 'form-numero') {
    e.preventDefault();
    const categorias = [...document.querySelectorAll('#permisos input:checked')]
      .map((c) => c.value);

    try {
      const r = await enviar('numeros', {
        organizationId: document.getElementById('empresa').value,
        phone: document.getElementById('tel').value,
        displayName: document.getElementById('nombre').value,
        role: document.getElementById('rol').value,
        categories: categorias,
      });

      aviso('Agregado como ' + r.display + (r.existsOnWhatsApp ? '' : ' (sin confirmar en WhatsApp)'));
      pintar('directorio');
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  if (e.target.id === 'form-empresa') {
    e.preventDefault();
    try {
      const sourceType = document.getElementById('emp-origen').value;
      const nombre = document.getElementById('emp-nombre').value;
      const r = await enviar('empresas', {
        name: nombre,
        taxId: document.getElementById('emp-rfc').value,
        sourceType,
        driveFolderId: document.getElementById('emp-drive').value,
      });
      if (sourceType === 'PC') {
        aviso('Empresa creada. Ahora conecta su computadora con el código.');
        await pintar('empresas');
        mostrarCodigoPc(r.id, nombre);
      } else {
        aviso('Empresa creada. Comparte la carpeta con la cuenta de servicio y corre /sync.');
        pintar('empresas');
      }
    } catch (err) { aviso(err.message, 'error'); }
  }
});

document.addEventListener('click', async (e) => {
  const verDocs = e.target.closest('[data-ver-docs]');
  if (verDocs) {
    e.preventDefault();
    docsEmpresa = verDocs.dataset.verDocs;
    docsEstado = 'entregables';
    pintar('documentos');
    return;
  }

  const irA = e.target.closest('[data-view-link]');
  if (irA) {
    e.preventDefault();
    if (irA.dataset.viewLink === 'cuarentena') filtroCuarentena = 'revision';
    pintar(irA.dataset.viewLink);
    return;
  }

  const conectarWa = e.target.closest('[data-conectar-wa]');
  if (conectarWa) {
    const nombre = conectarWa.dataset.nombre;
    if (!confirm('¿Conectar el WhatsApp de ' + nombre + '?\\n\\nVas a necesitar el teléfono de la empresa para escanear un código QR. Desde ese número, el bot solo entregará documentos de ' + nombre + '.')) return;
    try {
      await enviar('empresas/whatsapp/conectar', { id: conectarWa.dataset.conectarWa });
      mostrarQrWa(conectarWa.dataset.conectarWa, nombre);
      // La fila pasa a "falta escanear" sin esperar al refresco.
      pintar('empresas', true);
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const verQr = e.target.closest('[data-ver-qr]');
  if (verQr) {
    mostrarQrWa(verQr.dataset.verQr, verQr.dataset.nombre);
    return;
  }

  if (e.target.closest('[data-cerrar-qr-wa]')) {
    qrWa = null;
    clearInterval(qrWaTimer);
    pintarQrWa();
    pintar('empresas', true);
    return;
  }

  const desconectarWa = e.target.closest('[data-desconectar-wa]');
  if (desconectarWa) {
    if (!confirm('¿Desconectar este número?\\n\\nSale de "Dispositivos vinculados" del teléfono de la empresa y, desde ese momento, a la empresa se la atiende por el número principal.')) return;
    try {
      await enviar('empresas/whatsapp/desconectar', { id: desconectarWa.dataset.desconectarWa });
      if (qrWa?.id === desconectarWa.dataset.desconectarWa) { qrWa = null; clearInterval(qrWaTimer); }
      aviso('Número desconectado');
      pintar('empresas');
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const codigoPc = e.target.closest('[data-codigo-pc]');
  if (codigoPc) {
    mostrarCodigoPc(codigoPc.dataset.codigoPc, codigoPc.dataset.nombre);
    return;
  }

  const generar = e.target.closest('[data-generar-codigo]');
  if (generar) {
    try {
      const r = await enviar('empresas/conector/codigo', { id: generar.dataset.generarCodigo });
      const salida = generar.parentElement.querySelector('[data-codigo-salida]');
      salida.innerHTML = '<strong class="mono">' + r.code.slice(0, 3) + ' ' + r.code.slice(3) + '</strong>' +
        ' · dirección <code>' + esc(location.origin) + '</code> · vence ' + hora(r.expiresAt);
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const revocarPc = e.target.closest('[data-revocar-pc]');
  if (revocarPc) {
    if (!confirm('¿Desconectar este equipo? Deja de subir archivos; lo ya subido se queda.')) return;
    try {
      await enviar('empresas/conector/revocar', { id: revocarPc.dataset.revocarPc });
      aviso('Equipo desconectado');
      pintar('empresas');
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const guardar = e.target.closest('[data-guardar]');
  if (guardar) {
    const id = guardar.dataset.guardar;
    const campo = document.querySelector('[data-carpeta="' + id + '"]');
    try {
      await enviar('empresas/actualizar', { id, driveFolderId: campo.value });
      aviso('Carpeta actualizada. Corre /sync por WhatsApp para reindexar.');
      pintar('empresas');
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const verificar = e.target.closest('[data-verificar]');
  if (verificar) {
    try {
      await enviar('numeros/verificar', { id: verificar.dataset.verificar });
      aviso('Número verificado: ya puede recibir documentos sensibles');
      pintar('directorio');
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const revocar = e.target.closest('[data-revocar]');
  if (revocar) {
    if (!confirm('¿Revocar el acceso de este número? Deja de recibir documentos.')) return;
    try {
      await enviar('numeros/revocar', { id: revocar.dataset.revocar });
      aviso('Acceso revocado');
      pintar('directorio');
    } catch (err) { aviso(err.message, 'error'); }
  }
});

// ── Conector de PC ──────────────────────────────────────────────────────

// ── WhatsApp propio de cada empresa ─────────────────────────────────────

/**
 * La celda "WhatsApp" de una empresa. Sin número propio se atiende por el
 * principal; con él, se enseña si está conectado, esperando el QR o si lo
 * desvincularon desde el teléfono.
 */
function celdaWa(o, estado) {
  const esAdmin = yo?.role === 'ADMIN';
  const nombre = esc(o.name ?? o.nombre ?? '');
  if (!o.waLineId && !(estado && estado.conectada)) {
    return '<span class="muted small">número principal</span>' +
      (esAdmin ? ' <button class="mini" data-conectar-wa="' + o.id + '" data-nombre="' + nombre + '">Conectar WhatsApp</button>' : '');
  }

  const e = estado?.estado ?? 'CONSULTANDO';
  const numero = estado?.numero ?? o.waNumber;
  const pill = {
    CONNECTED: '<span class="pill ok">conectado</span>',
    WAITING_QR: '<span class="pill warn">falta escanear</span>',
    DISCONNECTED: '<span class="pill warn">desvinculado</span>',
    CRASHED: '<span class="pill warn">con error</span>',
  }[e] ?? '<span class="pill">conectando…</span>';

  const accion = !esAdmin ? '' :
    e === 'WAITING_QR'
      ? ' <button class="mini" data-ver-qr="' + o.id + '" data-nombre="' + nombre + '">Ver QR</button>'
      : e === 'DISCONNECTED' || e === 'CRASHED' || e === 'DESCONOCIDO'
        ? ' <button class="mini" data-conectar-wa="' + o.id + '" data-nombre="' + nombre + '">Volver a conectar</button>'
        : '';

  return pill + (numero ? ' <span class="mono">+' + esc(numero) + '</span>' : '') + accion +
    (esAdmin ? ' <button class="mini peligro" data-desconectar-wa="' + o.id + '" title="Desconectar este número">×</button>' : '');
}

async function pintarEstadoWa(id, nombre) {
  const celda = document.querySelector('[data-estado-wa="' + id + '"]');
  if (!celda) return;
  const r = await api('empresas/whatsapp?id=' + encodeURIComponent(id));
  if (!r) return;
  celda.innerHTML = celdaWa({ id, name: nombre, waLineId: r.conectada ? 'si' : null, waNumber: r.numero }, r);
}

/**
 * La tarjeta con el QR de la empresa que se está conectando. Se guarda
 * aquí porque el panel se repinta cada 20 s: sin esto, la tarjeta
 * desaparecía mientras la persona buscaba el teléfono.
 */
let qrWa = null;
let qrWaTimer = null;

function qrWaVigente() {
  if (!qrWa) return '';
  const url = '/panel/api/empresas/whatsapp/qr?id=' + encodeURIComponent(qrWa.id) + '&t=' + Date.now();
  return '<div class="card qr-wa">' +
    '<div class="qr-wa-caja">' +
      (qrWa.conectado
        ? '<div class="qr-wa-listo">✓</div>'
        : '<img id="qr-wa-img" alt="Código QR" src="' + url + '" onerror="this.style.visibility=\\'hidden\\'" onload="this.style.visibility=\\'visible\\'">') +
    '</div>' +
    '<div class="qr-wa-texto">' +
      '<h3>WhatsApp de ' + esc(qrWa.nombre) + '</h3>' +
      (qrWa.conectado
        ? '<p>Conectado' + (qrWa.numero ? ' como <strong>+' + esc(qrWa.numero) + '</strong>' : '') +
          '. Desde ahora, lo que le escriban a ese número lo atiende el bot, solo con documentos de esta empresa.</p>' +
          '<button class="mini" data-cerrar-qr-wa>Listo</button>'
        : '<ol class="muted">' +
            '<li>En el teléfono de la empresa, abre <strong>WhatsApp</strong>.</li>' +
            '<li>Ve a <em>Ajustes → Dispositivos vinculados → Vincular un dispositivo</em>.</li>' +
            '<li>Escanea este código. Se renueva solo cada 20 segundos.</li>' +
          '</ol>' +
          '<p class="muted small" id="qr-wa-estado">' + esc(qrWa.aviso ?? 'Esperando el escaneo…') + '</p>' +
          '<p class="muted small">El teléfono sigue funcionando normal. Si la empresa desvincula el dispositivo, el bot deja de contestar por ese número hasta volver a conectarlo.</p>' +
          '<button class="mini" data-cerrar-qr-wa>Cerrar</button>') +
    '</div>' +
  '</div>';
}

function pintarQrWa() {
  const caja = document.getElementById('qr-wa');
  if (caja) caja.innerHTML = qrWaVigente();
}

async function mostrarQrWa(id, nombre) {
  qrWa = { id, nombre, conectado: false };
  pintarQrWa();
  document.getElementById('qr-wa')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  clearInterval(qrWaTimer);
  qrWaTimer = setInterval(async () => {
    if (!qrWa || qrWa.id !== id) { clearInterval(qrWaTimer); return; }
    const r = await api('empresas/whatsapp?id=' + encodeURIComponent(id));
    if (!r) return;
    if (r.estado === 'CONNECTED') {
      clearInterval(qrWaTimer);
      qrWa = { id, nombre, conectado: true, numero: r.numero };
      pintarQrWa();
      aviso('WhatsApp de ' + nombre + ' conectado');
      pintarEstadoWa(id, nombre);
      return;
    }
    qrWa.aviso = r.estado === 'WAITING_QR' ? 'Esperando el escaneo…'
      : r.estado === 'DISCONNECTED' ? 'El teléfono rechazó o cerró la vinculación. Vuelve a intentarlo.'
      : 'Preparando el código…';
    const img = document.getElementById('qr-wa-img');
    if (img) img.src = '/panel/api/empresas/whatsapp/qr?id=' + encodeURIComponent(id) + '&t=' + Date.now();
    const texto = document.getElementById('qr-wa-estado');
    if (texto) texto.textContent = qrWa.aviso;
  }, 4000);
}

async function pintarEstadoPc(id) {
  const celda = document.querySelector('[data-estado-pc="' + id + '"]');
  if (!celda) return;
  const r = await api('empresas/conectores?id=' + encodeURIComponent(id));
  if (!r) return;

  if (r.devices.length === 0) {
    celda.innerHTML = '<span class="pill warn">sin conectar</span>';
    return;
  }

  // Ya se conectó con el código: la tarjeta sobra.
  if (codigoPc && codigoPc.organizationId === id) {
    codigoPc = null;
    const caja = document.getElementById('codigo-pc');
    if (caja) caja.innerHTML = '';
  }

  const visto = r.devices.map((d) => d.lastSeenAt).filter(Boolean).sort().pop();
  // El conector revisa cada pocos minutos: más de 30 sin noticias es que la PC está apagada.
  const enLinea = visto && Date.now() - new Date(visto).getTime() < 30 * 60000;

  const docs = r.documentos;
  celda.innerHTML =
    (enLinea ? '<span class="pill ok">en línea</span>' : '<span class="pill warn">apagada</span>') +
    ' <a href="#" data-ver-docs="' + id + '">' + docs.entregables + ' entregable' + (docs.entregables === 1 ? '' : 's') + '</a>' +
    (docs.revision > 0 ? ' · <a href="#" class="warn-link" data-view-link="cuarentena">' + docs.revision + ' por revisar</a>' : '') +
    (docs.descartados > 0 ? ' · <span class="muted">' + docs.descartados + ' descartado' + (docs.descartados === 1 ? '' : 's') + '</span>' : '') +
    (r.lastUploadAt ? ' · última subida ' + hace(r.lastUploadAt) : '') +
    ' · ' + r.devices.map((d) =>
      esc(d.name) + ' <button class="mini peligro" data-revocar-pc="' + d.id + '" title="Desconectar este equipo">×</button>'
    ).join(', ');
}

/**
 * El último código generado. Se guarda aquí porque el panel se repinta
 * cada 20 s: sin esto, la tarjeta desaparecía mientras la persona iba a la
 * otra computadora a teclearlo.
 */
let codigoPc = null;

function codigoPcVigente() {
  if (!codigoPc || new Date(codigoPc.expiresAt).getTime() < Date.now()) return '';
  return codigoPc.html;
}

/**
 * Tarjeta para conectar la PC de una empresa. Lo principal es el
 * instalador: trae la dirección y el código adentro, así que el cliente
 * solo le da doble clic. El código a mano queda como plan B.
 */
function mostrarCodigoPc(id, nombre) {
  const caja = document.getElementById('codigo-pc');
  const url = '/panel/api/empresas/conector/descarga?id=' + encodeURIComponent(id);
  const html =
    '<div class="card codigo-pc">' +
      '<h3>Conectar la computadora de ' + esc(nombre) + '</h3>' +
      '<p><a class="boton" href="' + url + '" download>Descargar conector para ' + esc(nombre) + '</a></p>' +
      '<ol class="muted">' +
        '<li>Mándale el archivo al cliente por correo o WhatsApp, o ábrelo tú en su computadora.</li>' +
        '<li>Doble clic. Si Windows avisa "protegió su PC": <em>Más información → Ejecutar de todas formas</em>.</li>' +
        '<li>Pulsa <strong>Crear carpeta nueva</strong> (recomendado) y pon ahí los documentos. Queda trabajando solo, sin ventanas, también al reiniciar.</li>' +
      '</ol>' +
      '<p class="muted small">Cada archivo se revisa antes de poder mandarse: lo que no sea un documento de la empresa ' +
        'o traiga contraseñas no se entrega, y lo dudoso te llega a Cuarentena.</p>' +
      '<p class="muted small">Cada descarga sirve para una computadora y vale 3 días.</p>' +
      '<details class="muted small"><summary>¿Ya tiene el conector? Usa un código</summary>' +
        '<p><button class="mini" data-generar-codigo="' + id + '">Generar código</button> ' +
        '<span data-codigo-salida></span></p>' +
      '</details>' +
    '</div>';
  // Caduca con el instalador: sin esto el refresco de 20 s la borraba.
  codigoPc = { organizationId: id, expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(), html };
  if (!caja) return;
  caja.innerHTML = html;
  caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Armazón ─────────────────────────────────────────────────────────────

async function pintarResumen() {
  const r = await api('resumen');
  if (!r) return;

  // Lo que pide atención, como una frase con pastillas que llevan a su
  // vista. Lo que está en cero no se menciona: no es trabajo pendiente.
  const pendientes = [
    [r.revision, r.revision === 1 ? 'espera a una persona' : 'esperan a una persona', 'ambar', 'bandeja', 'persona'],
    [r.abiertos, 'sin responder', 'ambar', 'bandeja', 'BOT'],
    [r.alta, r.alta === 1 ? 'ticket de prioridad alta' : 'tickets de prioridad alta', 'rojo', 'tickets', ''],
    [r.cuarentena, r.cuarentena === 1 ? 'documento por revisar' : 'documentos por revisar', 'violeta', 'cuarentena', ''],
  ].filter(([n]) => n > 0);

  document.getElementById('resumen').innerHTML =
    (pendientes.length
      ? '<span class="muted">Ahora tienes</span>' + pendientes.map(([n, texto, color, vista, filtro]) =>
          '<button class="dato ' + color + '" data-ir="' + vista + '" data-ir-filtro="' + filtro + '">' + n + ' ' + texto + '</button>',
        ).join('')
      : '<span class="muted">Todo al día: nadie espera respuesta.</span>') +
    '<span class="muted small">· ' + r.entregas24h + ' entrega' + (r.entregas24h === 1 ? '' : 's') +
      ' y ' + r.denegados24h + ' negada' + (r.denegados24h === 1 ? '' : 's') + ' en 24 h</span>' +
    // Cuántos mensajes lleva en la hora contra el tope general. Se pone en
    // ámbar al 80 % y en rojo al llegar: ahí el bot deja de contestar.
    (r.topeHora
      ? '<button class="dato ' + (r.mensajesHora >= r.topeHora ? 'rojo' : r.mensajesHora >= r.topeHora * 0.8 ? 'ambar' : 'neutro') +
          '" data-ir="ajustes" title="Tope general de mensajes por hora">' +
          r.mensajesHora + ' de ' + r.topeHora + ' mensajes esta hora</button>'
      : '');

  const bp = document.getElementById('badge-persona');
  bp.textContent = r.revision; bp.hidden = !(r.revision > 0);
  const bc = document.getElementById('badge-cuarentena');
  bc.textContent = r.cuarentena; bc.hidden = !(r.cuarentena > 0);
}

async function pintar(vista, silencioso) {
  vistaActual = vista;
  document.getElementById('titulo').textContent = vista === 'bandeja' && yo
    ? 'Hola, ' + String(yo.name ?? '').trim().split(/\\s+/)[0]
    : TITULOS[vista] ?? vista;
  document.querySelectorAll('.nav-items button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === vista));
  if (!silencioso) contenido.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    contenido.innerHTML = await VISTAS[vista]();
  } catch (err) {
    contenido.innerHTML = '<p class="alert">No se pudo cargar: ' + esc(err.message) + '</p>';
  }
  document.getElementById('reloj').textContent = 'actualizado ' + hora(new Date().toISOString());
}

document.querySelectorAll('.nav-items button').forEach((boton) => {
  boton.addEventListener('click', () => {
    menuMovil(false);
    pintar(boton.dataset.view);
  });
});

document.getElementById('refrescar').addEventListener('click', () => {
  pintarResumen();
  pintar(vistaActual, true);
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/panel/api/logout', { method: 'POST' });
  location.href = '/panel/login';
});

api('me').then((usuario) => {
  yo = usuario;
  if (usuario) {
    document.getElementById('yo-avatar').textContent = iniciales(usuario.name);
    document.getElementById('yo-nombre').textContent = usuario.name;
    document.getElementById('yo-rol').textContent = usuario.role === 'ADMIN' ? 'Administrador' : 'Agente';
  }
  pintar('bandeja');
});

pintarResumen();

// Refresco de la lista cada 20 s, sin recargar debajo de un formulario a
// medio llenar. El hilo abierto tiene su propio refresco más frecuente.
setInterval(() => {
  // Ni un formulario a medio llenar ni el buscador mientras se escribe.
  if (document.querySelector('#contenido input:focus, #contenido select:focus, #contenido textarea:focus')) return;
  pintarResumen();
  pintar(vistaActual, true);
}, 20000);
</script>
</body></html>`;
}

const STYLES = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<style>
  /*
   * Paleta y medidas en variables: todo lo de abajo las usa, así un
   * cambio de tono es una línea y no una búsqueda por el archivo.
   */
  :root {
    color-scheme: dark;
    --fondo: #0c0e15;
    --caja: #12151e;
    --caja2: #181c27;
    --caja3: #1f2433;
    --borde: #232838;
    --borde2: #2e3446;
    --texto: #eef0f6;
    --suave: #8b92a6;
    --tenue: #5f6679;
    --acento: #7c6cf6;
    --acento-fuerte: #6a5ae8;
    --acento-suave: rgba(124, 108, 246, .14);
    --acento-borde: rgba(124, 108, 246, .45);
    --ambar: #f5c451;
    --ambar-suave: rgba(245, 196, 81, .12);
    --ambar-borde: rgba(245, 196, 81, .3);
    --verde: #4ade80;
    --verde-suave: rgba(74, 222, 128, .12);
    --rojo: #f87171;
    --rojo-suave: rgba(248, 113, 113, .12);
    --celeste: #60a5fa;
    --celeste-suave: rgba(96, 165, 250, .12);
    --radio: 12px;
    --nav: 248px;
    --nav-plegado: 72px;
    --hilo: 440px;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--fondo); color: var(--texto);
    font: 14px/1.55 'Plus Jakarta Sans', 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body.centered { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
  a { color: var(--acento); }
  ::selection { background: var(--acento-suave); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--caja3); border-radius: 10px; border: 2px solid var(--fondo); }
  .muted { color: var(--suave); }
  .small { font-size: 12px; }
  .centro { text-align: center; }
  .warn-text { color: var(--ambar); }
  .ok-text { color: var(--verde); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: var(--caja3); padding: 1px 6px; border-radius: 6px; font-size: 12px; }
  .spacer { flex: 1; }
  .recorte { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .recorte-celda { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ico { width: 20px; height: 20px; flex-shrink: 0; }

  /* ── Armazón ─────────────────────────────────────────────────────── */
  .app {
    display: grid; height: 100vh; height: 100dvh;
    grid-template-columns: var(--nav) 1fr 0;
    transition: grid-template-columns .18s ease;
  }
  .app.plegado { grid-template-columns: var(--nav-plegado) 1fr 0; }
  .app.con-hilo { grid-template-columns: var(--nav) 1fr var(--hilo); }
  .app.plegado.con-hilo { grid-template-columns: var(--nav-plegado) 1fr var(--hilo); }

  .main { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  main { padding: 8px 28px 32px; overflow-y: auto; flex: 1; }
  main > p:first-child { margin-top: 0; }

  /* ── Menú lateral ────────────────────────────────────────────────── */
  .nav {
    background: var(--caja); border-right: 1px solid var(--borde);
    display: flex; flex-direction: column; overflow: hidden; min-width: 0;
  }
  .nav-brand { display: flex; align-items: center; gap: 12px; padding: 20px 14px 18px 18px; }
  .logo {
    width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
    display: grid; place-items: center; color: #fff;
    background: linear-gradient(140deg, #8b7bff, #5b4bdb);
    box-shadow: 0 6px 18px rgba(124, 108, 246, .35);
  }
  .logo svg { width: 20px; height: 20px; }
  .marca { flex: 1; min-width: 0; }
  .marca strong { display: block; font-size: 19px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }
  .marca small { color: var(--suave); font-size: 11px; }
  .nav-items {
    display: flex; flex-direction: column; gap: 3px; padding: 12px 12px; flex: 1;
    border-top: 1px solid var(--borde);
  }
  .nav-items button {
    display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
    background: none; border: none; color: var(--suave); cursor: pointer; font: inherit;
    padding: 10px 12px; border-radius: 10px; font-size: 14px; font-weight: 600; white-space: nowrap;
    transition: background .12s, color .12s;
  }
  .nav-items button:hover { background: var(--caja2); color: var(--texto); }
  .nav-items button.active { background: var(--caja3); color: var(--texto); }
  .nav-items button.active .ico { color: var(--acento); }
  .badge {
    margin-left: auto; background: var(--ambar-suave); color: var(--ambar);
    border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700;
  }
  .nav-foot { padding: 12px; border-top: 1px solid var(--borde); }
  .yo { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 12px; }
  .yo-avatar {
    width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
    display: grid; place-items: center; font-weight: 800; font-size: 13px;
    background: var(--caja3); color: var(--texto);
  }
  .yo-datos { flex: 1; min-width: 0; line-height: 1.25; }
  .yo-datos strong { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .yo-datos small { color: var(--suave); font-size: 12px; }
  .plegado .nav-text { display: none !important; }
  .plegado .nav-brand { padding-left: 0; padding-right: 0; justify-content: center; flex-direction: column; }
  .plegado #nav-plegar { display: grid !important; transform: rotate(180deg); }
  .plegado .nav-items { padding: 12px 10px; }
  .plegado .nav-items button { justify-content: center; padding: 11px 0; }
  .plegado .yo { flex-direction: column; }
  .plegado #logout { display: grid !important; }
  #nav-velo { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); z-index: 30; }

  /* ── Encabezado ──────────────────────────────────────────────────── */
  .top { display: flex; align-items: flex-start; gap: 14px; padding: 24px 28px 18px; }
  .encabezado { min-width: 0; }
  .encabezado h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -.025em; line-height: 1.2; }
  .resumen-linea { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 8px; font-size: 13px; }
  .dato {
    border: 1px solid transparent; border-radius: 999px; padding: 3px 11px;
    font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .dato.ambar { background: var(--ambar-suave); color: var(--ambar); border-color: var(--ambar-borde); }
  .dato.rojo { background: var(--rojo-suave); color: var(--rojo); border-color: rgba(248, 113, 113, .3); }
  .dato.violeta { background: var(--acento-suave); color: #b3a9ff; border-color: var(--acento-borde); }
  .dato:hover { filter: brightness(1.15); }
  .dato.neutro { background: var(--caja2); color: var(--suave); border-color: var(--borde2); }

  /* ── Ajustes ─────────────────────────────────────────────────────── */
  .ajustes { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 16px; align-items: start; }
  .ajustes h3 { margin: 0 0 4px; font-size: 16px; }
  .uso-cifra { margin: 14px 0 8px; }
  .uso-cifra strong { font-size: 32px; font-weight: 800; letter-spacing: -.02em; }
  .uso-titulo { margin: 18px 0 6px; }
  .uso-chat {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center;
    padding: 8px 0; border-top: 1px solid var(--borde);
  }
  .uso-chat .medidor { grid-column: 1 / -1; }
  .medidor { height: 8px; border-radius: 999px; background: var(--caja3); overflow: hidden; }
  .medidor-barra { height: 100%; border-radius: 999px; transition: width .3s ease; }
  .medidor-barra.violeta { background: var(--acento); }
  .medidor-barra.ambar { background: var(--ambar); }
  .medidor-barra.rojo { background: var(--rojo); }
  .aviso-riesgo {
    background: var(--ambar-suave); border: 1px solid var(--ambar-borde); color: #f3dfae;
    border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; font-size: 13px;
  }
  .aviso-riesgo > strong { display: block; color: var(--ambar); margin-bottom: 4px; }
  .aviso-riesgo p { margin: 6px 0 0; }
  #form-limites .campos { margin-bottom: 14px; }
  #form-limites label small { font-weight: 400; font-size: 12px; }
  #form-limites .check { margin-bottom: 16px; font-weight: 600; }
  @media (max-width: 1100px) { .ajustes { grid-template-columns: 1fr; } }
  .icon {
    background: none; border: 1px solid transparent; color: var(--suave); cursor: pointer;
    width: 36px; height: 36px; border-radius: 10px; display: inline-grid; place-items: center;
    flex-shrink: 0;
  }
  .icon:hover { color: var(--texto); background: var(--caja2); }
  .icon svg { width: 18px; height: 18px; }
  .icon.redondo { border-radius: 50%; border-color: var(--borde2); }
  .top .muted.small { align-self: center; }
  .top .icon.redondo { margin-top: 2px; }
  .card { background: var(--caja); border: 1px solid var(--borde); border-radius: var(--radio); padding: 16px 18px; }
  .codigo-pc { margin: 0 0 16px; }
  .qr-wa { display: flex; gap: 22px; align-items: flex-start; margin: 0 0 16px; flex-wrap: wrap; }
  .qr-wa-caja {
    width: 236px; height: 236px; flex-shrink: 0; border-radius: 14px; background: #fff;
    display: grid; place-items: center; padding: 10px;
  }
  .qr-wa-caja img { width: 216px; height: 216px; display: block; }
  .qr-wa-listo { font-size: 72px; color: #16a34a; font-weight: 800; }
  .qr-wa-texto { flex: 1; min-width: 240px; }
  .qr-wa-texto h3 { margin: 0 0 8px; font-size: 16px; }
  .qr-wa-texto ol { padding-left: 18px; margin: 0 0 10px; }
  .pill.linea { background: var(--acento-suave); color: #c9c1ff; }
  .codigo-pc a.boton {
    display: inline-block; background: var(--acento); color: #fff; padding: 10px 18px;
    border-radius: 10px; text-decoration: none; font-weight: 700;
  }
  .codigo-pc a.boton:hover { background: var(--acento-fuerte); }
  .codigo-pc details { margin-top: 8px; }
  .codigo-grande { font: 600 40px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 6px; margin: 8px 0 12px; }

  /* ── Barra de herramientas y filtros ─────────────────────────────── */
  .barra { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
  .buscador {
    display: flex; flex-direction: row; align-items: center; gap: 8px; font-weight: 400; min-width: 260px; flex: 0 1 340px;
    background: var(--caja); border: 1px solid var(--borde); border-radius: 10px; padding: 0 12px;
    color: var(--tenue);
  }
  .buscador:focus-within { border-color: var(--acento-borde); }
  .buscador svg { width: 16px; height: 16px; }
  .buscador input { border: none; background: none; padding: 10px 0; flex: 1; min-width: 0; }
  .buscador input:focus { outline: none; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
  .barra .chips { margin-bottom: 0; }
  .chips select { margin-right: 6px; }
  .chip {
    background: var(--caja); border: 1px solid var(--borde); color: var(--suave); font: inherit;
    padding: 6px 14px; border-radius: 999px; cursor: pointer; font-size: 13px; font-weight: 600;
  }
  .chip:hover { color: var(--texto); border-color: var(--borde2); }
  .chip.activo { background: var(--acento-suave); border-color: var(--acento-borde); color: #c9c1ff; }
  .warn-link { color: var(--ambar); }
  .docs-total { align-self: center; margin-left: auto; }
  .docs-grid { display: flex; flex-direction: column; gap: 12px; }
  .docs-tipo { padding: 14px 16px; }
  .docs-tipo h3 { margin: 0 0 6px; font-size: 15px; }
  .docs-mes { border-top: 1px solid var(--borde); }
  .docs-mes summary { cursor: pointer; padding: 9px 2px; font-weight: 600; }
  .docs-mes table { background: transparent; }
  .docs-mes td { padding: 8px 10px; }
  .docs-mes td:first-child { word-break: break-word; }

  /* ── Lista de conversaciones ─────────────────────────────────────── */
  .lista {
    background: var(--caja); border: 1px solid var(--borde); border-radius: var(--radio);
    overflow: hidden;
  }
  .fila {
    display: flex; gap: 14px; padding: 14px 18px; border-bottom: 1px solid var(--borde);
    cursor: pointer; transition: background .12s; position: relative;
  }
  .fila:last-child { border-bottom: none; }
  .fila:hover { background: var(--caja2); }
  .fila.abierta { background: var(--caja3); }
  .fila.abierta::before {
    content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px;
    border-radius: 0 3px 3px 0; background: var(--acento);
  }
  .avatar {
    --h: 250;
    width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
    display: grid; place-items: center; font-size: 14px; font-weight: 800;
    background: hsl(var(--h) 45% 22%); color: hsl(var(--h) 85% 82%);
  }
  .fila-cuerpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .fila-arriba, .fila-abajo { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .fila-arriba strong { font-size: 15px; font-weight: 700; }
  .fila-pills { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 5px; }
  .estado {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;
    padding: 2px 10px 2px 8px; border-radius: 999px; background: var(--caja3); color: var(--suave);
  }
  .estado i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .estado.espera, .estado.nuevo { background: var(--ambar-suave); color: var(--ambar); }
  .estado.persona { background: var(--acento-suave); color: #b3a9ff; }
  .estado.cliente { background: var(--celeste-suave); color: var(--celeste); }
  .estado.ok { background: var(--verde-suave); color: var(--verde); }
  .folio { color: var(--tenue); font-size: 12px; font-weight: 600; }

  /* ── Tablas ──────────────────────────────────────────────────────── */
  .vacio {
    color: var(--suave); padding: 40px 24px; text-align: center; background: var(--caja);
    border: 1px dashed var(--borde2); border-radius: var(--radio);
  }
  .scroll { overflow-x: auto; border: 1px solid var(--borde); border-radius: var(--radio); }
  table { width: 100%; border-collapse: collapse; background: var(--caja); }
  th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--borde); }
  th {
    color: var(--suave); font-weight: 700; font-size: 11px; text-transform: uppercase;
    letter-spacing: .06em; background: var(--caja2);
  }
  tr:last-child td { border-bottom: none; }
  tr.clic { cursor: pointer; }
  tr.clic:hover td { background: var(--caja2); }
  td.acciones { white-space: nowrap; }

  .pill {
    display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
    background: var(--caja3); color: #c8cdda; white-space: nowrap;
  }
  .pill.tipo-queja, .pill.molesto { background: var(--rojo-suave); color: var(--rojo); }
  .pill.tipo-seguimiento, .pill.tipo-pide_humano { background: var(--ambar-suave); color: var(--ambar); }
  .ABIERTO { background: var(--celeste-suave); color: var(--celeste); }
  .EN_REVISION { background: var(--ambar-suave); color: var(--ambar); }
  .CERRADO { background: var(--caja3); color: var(--suave); }
  .pALTA { background: var(--rojo-suave); color: var(--rojo); }
  .pMEDIA { background: var(--caja3); color: #c8cdda; }
  .pBAJA { background: var(--caja2); color: var(--suave); }
  .ok { background: var(--verde-suave); color: var(--verde); }
  .warn { background: var(--ambar-suave); color: var(--ambar); }

  /* ── Formularios ─────────────────────────────────────────────────── */
  .form-alta { margin-bottom: 20px; }
  .form-alta h3 { margin: 0 0 14px; font-size: 16px; }
  .campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--suave); font-weight: 600; }
  input, select, textarea {
    background: var(--fondo); border: 1px solid var(--borde2); border-radius: 10px;
    padding: 10px 12px; color: var(--texto); font-size: 14px; font-family: inherit;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--acento); }
  .compacto { padding: 5px 9px; font-size: 12px; width: 240px; }
  .permisos { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin: 14px 0; font-size: 13px; }
  .check { flex-direction: row; align-items: center; gap: 6px; color: var(--texto); }
  button[type=submit] {
    background: var(--acento); border: none; color: #fff; padding: 10px 18px; font-family: inherit;
    border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 700;
  }
  button[type=submit]:hover { background: var(--acento-fuerte); }
  .ghost {
    background: none; border: 1px solid var(--borde2); color: var(--suave); font: inherit; font-weight: 600;
    padding: 7px 13px; border-radius: 10px; cursor: pointer;
  }
  .ghost:hover { color: var(--texto); border-color: var(--tenue); }
  .ghost.small { padding: 6px 11px; font-size: 12px; white-space: nowrap; }
  .ghost.activo { border-color: var(--ambar-borde); color: var(--ambar); background: var(--ambar-suave); }
  .acento {
    background: var(--acento); border: 1px solid var(--acento); color: #fff; font: inherit; font-weight: 700;
    padding: 6px 13px; border-radius: 10px; cursor: pointer; font-size: 12px; white-space: nowrap;
  }
  .acento:hover { background: var(--acento-fuerte); }
  .mini {
    background: none; border: 1px solid var(--borde2); color: var(--suave); font: inherit; font-weight: 600;
    padding: 4px 10px; border-radius: 8px; cursor: pointer; font-size: 12px;
  }
  .mini:hover { color: var(--texto); border-color: var(--tenue); }
  .mini.peligro, .icon.peligro { color: var(--rojo); }
  .mini.peligro:hover { border-color: rgba(248, 113, 113, .5); }
  .icon.peligro:hover { background: var(--rojo-suave); }

  /* ── Hilo ────────────────────────────────────────────────────────── */
  #hilo {
    background: var(--caja); border-left: 1px solid var(--borde); position: relative;
    display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  }
  .hilo-head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px 16px; }
  .hilo-head .avatar { width: 40px; height: 40px; }
  .hilo-quien { flex: 1; min-width: 0; line-height: 1.3; }
  .hilo-quien strong, .hilo-quien div { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hilo-quien strong { font-size: 15px; }
  .hilo-sub {
    display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
    padding: 0 16px 12px; border-bottom: 1px solid var(--borde);
  }
  .hilo-estado, .hilo-meta { display: contents; }
  .hilo-drawer {
    position: absolute; top: 0; right: 0; bottom: 0; width: min(100%, 360px); z-index: 5;
    background: var(--caja); border-left: 1px solid var(--borde); box-shadow: -12px 0 32px rgba(0, 0, 0, .45);
    display: flex; flex-direction: column;
  }
  .drawer-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--borde); }
  .drawer-lista { overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
  .ticket-fila {
    background: var(--caja2); border: 1px solid var(--borde); border-radius: var(--radio);
    padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
  }
  .ticket-fila.cerrado { opacity: .6; }
  .ticket-fila-arriba { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .ticket-fila-asunto { font-size: 13px; }
  .opcion-borrar {
    background: var(--caja2); border: 1px solid var(--borde); border-radius: var(--radio);
    padding: 14px; display: flex; flex-direction: column; gap: 6px;
  }
  .opcion-borrar p { margin: 0; }
  .opcion-borrar.peligro-caja { border-color: rgba(248, 113, 113, .4); }
  #hilo-tickets-btn { display: inline-flex; align-items: center; gap: 6px; }
  #hilo-tickets-btn svg { width: 16px; height: 16px; }
  #hilo-tickets-btn.con-abiertos { border-color: var(--ambar-borde); color: var(--ambar); }

  .chat {
    flex: 1; overflow-y: auto; padding: 16px 16px 8px; display: flex; flex-direction: column; gap: 6px;
    background: var(--fondo);
  }
  .dia {
    align-self: center; margin: 10px 0 6px; padding: 3px 12px; border-radius: 999px;
    background: var(--caja2); color: var(--suave); font-size: 11px; font-weight: 700;
  }
  .burbuja {
    max-width: 84%; padding: 9px 13px 7px; border-radius: 16px; font-size: 13.5px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word; position: relative;
  }
  .burbuja strong { font-weight: 700; }
  .burbuja.entra { background: var(--caja3); align-self: flex-start; border-bottom-left-radius: 5px; }
  .burbuja.sale {
    background: linear-gradient(160deg, #3a3280, #2d2766); align-self: flex-end;
    border-bottom-right-radius: 5px; color: #f1efff;
  }
  .burbuja.pendiente { opacity: .6; }
  .burbuja.fallo { opacity: 1; background: var(--rojo-suave); border: 1px solid rgba(248, 113, 113, .35); }
  .burbuja .pill.tipo { display: table; margin-bottom: 6px; background: rgba(255, 255, 255, .07); color: var(--suave); }
  .burbuja .pill.tipo-queja, .burbuja .pill.molesto { background: var(--rojo-suave); color: var(--rojo); }
  .adjunto {
    display: flex; align-items: center; gap: 10px; white-space: normal;
    background: rgba(0, 0, 0, .22); border-radius: 10px; padding: 9px 11px; margin: 2px 0 6px;
  }
  .adjunto .ico { width: 22px; height: 22px; color: #c9c1ff; }
  .adjunto span { font-weight: 700; font-size: 13px; word-break: break-all; }
  .hora { display: block; font-size: 10.5px; color: var(--suave); margin-top: 3px; text-align: right; }
  .burbuja.sale .hora { color: rgba(241, 239, 255, .6); }
  .hilo-form {
    padding: 12px 14px max(14px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--borde); background: var(--caja);
  }
  .compositor {
    display: flex; align-items: flex-end; gap: 8px; background: var(--fondo);
    border: 1px solid var(--borde2); border-radius: 16px; padding: 6px 6px 6px 14px;
  }
  .compositor:focus-within { border-color: var(--acento-borde); }
  .compositor textarea {
    flex: 1; resize: none; max-height: 160px; line-height: 1.45; border: none; background: none;
    padding: 8px 0; min-height: 38px; overflow-y: hidden; font-size: 14px;
  }
  .compositor textarea::placeholder { color: var(--tenue); }
  .compositor-ayuda { font-size: 11px; color: var(--tenue); margin: 6px 4px 0; }
  .compositor textarea:focus { border: none; }
  .compositor button[type=submit] {
    width: 38px; height: 38px; padding: 0; border-radius: 12px; display: grid; place-items: center; flex-shrink: 0;
  }
  .compositor button svg { width: 18px; height: 18px; }
  .solo-movil { display: none !important; }

  /* ── Avisos ──────────────────────────────────────────────────────── */
  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--caja3); border: 1px solid var(--borde2); color: var(--texto);
    padding: 12px 18px; border-radius: 12px; z-index: 50; font-size: 13px; font-weight: 600;
    box-shadow: 0 12px 32px rgba(0, 0, 0, .45); max-width: 90vw;
  }
  .toast.error { background: #2a1417; border-color: rgba(248, 113, 113, .4); color: var(--rojo); }
  .login { display: flex; flex-direction: column; gap: 16px; width: min(360px, 92vw); padding: 28px; }
  .login h1 { font-size: 22px; font-weight: 800; letter-spacing: -.02em; margin: 0; }
  .login .logo { margin-bottom: 4px; }
  .alert { background: var(--rojo-suave); color: var(--rojo); padding: 10px 12px; border-radius: 10px; font-size: 13px; }

  /* ── Pantallas medianas: el hilo se superpone en vez de partir ───── */
  @media (max-width: 1180px) {
    .app.con-hilo, .app.plegado.con-hilo { grid-template-columns: var(--nav) 1fr 0; }
    .app.plegado.con-hilo { grid-template-columns: var(--nav-plegado) 1fr 0; }
    #hilo {
      position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 100vw); z-index: 20;
      box-shadow: -12px 0 32px rgba(0, 0, 0, .45);
    }
  }

  /* ── Móvil: menú fuera de pantalla, hilo a pantalla completa ─────── */
  @media (max-width: 899px) {
    .app, .app.plegado, .app.con-hilo, .app.plegado.con-hilo { grid-template-columns: 1fr; }
    .nav {
      position: fixed; top: 0; bottom: 0; left: 0; width: min(280px, 85vw); z-index: 31;
      transform: translateX(-100%); transition: transform .18s ease;
    }
    .app.menu-abierto .nav { transform: none; }
    .plegado .nav-text { display: initial !important; }
    .plegado .nav-items button { justify-content: flex-start; padding: 10px 12px; }
    .plegado .yo { flex-direction: row; }
    #nav-plegar { display: none !important; }
    #hilo { width: 100vw; }
    .hilo-head { padding: 10px 10px 10px 8px; gap: 8px; }
    .hilo-sub { padding: 0 12px 10px; }
    .chat { padding: 12px 10px 6px; }
    .burbuja { max-width: 90%; }
    .hilo-form { padding: 8px 10px max(10px, env(safe-area-inset-bottom)); }
    /* 16 px: con menos, el iPhone hace zoom al tocar el campo. */
    .compositor textarea { font-size: 16px; }
    .solo-movil { display: inline-grid !important; }
    .no-movil { display: none !important; }
    .top { padding: 16px 16px 12px; gap: 10px; }
    .encabezado h1 { font-size: 21px; }
    main { padding: 4px 16px 24px; }
    .buscador { min-width: 0; flex: 1 1 100%; }
    .fila { padding: 12px 14px; }
    .fila-abajo .recorte { max-width: 100%; }
    th, td { padding: 10px 12px; }
  }
</style>`;
