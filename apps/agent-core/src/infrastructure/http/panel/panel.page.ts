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
  carrito: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
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
      <button data-view="ventas" title="Ventas">${icono('carrito')}<span class="nav-text">Ventas</span></button>
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
  empresas: 'Empresas', ventas: 'Ventas', documentos: 'Documentos', cuarentena: 'Cuarentena', auditoria: 'Auditoría', ajustes: 'Ajustes',
};

const api = async (ruta) => {
  const res = await fetch('/panel/api/' + ruta);
  if (res.status === 401) { location.href = '/panel/login'; return null; }
  // Un error del servidor llega como objeto ({ statusCode, message }); sin
  // esto, la vista lo trataba como lista y tronaba con "x.map is not a function".
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new Error((datos && datos.message) || 'el servidor respondió ' + res.status);
  return datos;
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

/** Para valores dentro de un atributo: además, las comillas. */
const escAttr = (valor) => esc(valor).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Las ubicaciones que manda el cliente (pin de WhatsApp) se abren en Maps con un clic. Recibe texto ya escapado. */
const MAPS = new RegExp('https://maps[.]google[.]com/[?]q=[-0-9.,]+', 'g');
const ligasMaps = (html) => html.replace(MAPS, (u) => '<a href="' + u + '" target="_blank" rel="noopener">Ver en Maps 📍</a>');

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

/**
 * Solo se marca lo que pide atención (queja, pide persona, molesto). Una
 * etiqueta en cada mensaje ("consulta", "cortesía") era ruido que tapaba lo
 * importante.
 */
function etiqueta(m) {
  if (m.direction !== 'IN' || !ETIQUETAS[m.intent]) return '';
  if (!m.molesto && m.intent !== 'QUEJA' && m.intent !== 'PIDE_HUMANO') return '';
  const texto = ETIQUETAS[m.intent] +
    (m.motivo ? ' · ' + m.motivo.replace(/_/g, ' ') : '') +
    (m.molesto ? ' · molesto' : '');
  return '<span class="pill tipo tipo-' + m.intent.toLowerCase() + (m.molesto ? ' molesto' : '') + '">' + esc(texto) + '</span>';
}

const ICONO_ARCHIVO = '${icono('archivo')}';
const ICONO_TICKET = '${icono('ticket')}';

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
  return adjunto + ligasMaps(esc(texto).replace(/\\*([^*\\n]+)\\*/g, '<strong>$1</strong>'));
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

/**
 * Quién escribió un saliente. Una persona del equipo y el bot se ven
 * distintos: color y firma. Lo viejo (sin registro) no se firma: no se sabe.
 */
function autorSaliente(m) {
  if (!m.sentBy) return { clase: '', firma: '' };
  if (m.sentBy.startsWith('persona:')) {
    const quien = m.sentBy.slice('persona:'.length);
    return { clase: ' persona', firma: '<span class="firma">Soporte · ' + esc(quien.split('@')[0]) + '</span>' };
  }
  return { clase: ' bot', firma: '<span class="firma">Jarvis · bot</span>' };
}

/** Un ticket dentro del hilo, en el punto de la plática donde se abrió. */
function anclaTicket(t) {
  const cerrado = t.state === 'CERRADO';
  const estado = cerrado ? 'resuelto' : t.state === 'EN_REVISION' ? 'espera a una persona' : t.state.replace('_', ' ').toLowerCase();
  return '<div class="ticket-ancla' + (cerrado ? ' cerrado' : '') + '" id="ticket-' + t.id + '">' +
    '<span class="ticket-ancla-ico">' + ICONO_TICKET + '</span>' +
    '<div class="ticket-ancla-texto">' +
      '<div><strong>Ticket #' + t.number + '</strong> <span class="muted small">· ' + esc(estado) + ' · ' + hora(t.createdAt) + '</span></div>' +
      '<div class="ticket-ancla-asunto">' + ligasMaps(esc(t.subject)) + '</div>' +
      (cerrado && t.closeReason ? '<div class="muted small">' + esc(t.closeReason) + '</div>' : '') +
    '</div>' +
    (cerrado ? '' : '<button class="mini" data-cerrar="' + t.id + '">Resolver</button>') +
  '</div>';
}

function pintarMensajes(datos, alFinal) {
  const caja = document.getElementById('hilo-mensajes');
  const abajo = alFinal || caja.scrollHeight - caja.scrollTop - caja.clientHeight < 40;

  // Mensajes y tickets en una sola línea de tiempo: el ticket aparece
  // justo donde se abrió, pegado al mensaje que lo provocó.
  const eventos = datos.messages.map((m) => ({ fecha: m.createdAt, m }))
    .concat((datos.tickets ?? []).map((t) => ({ fecha: t.createdAt, t })))
    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

  let diaAnterior = null;
  let firmaAnterior = null;
  const burbujas = eventos.map((ev) => {
    const dia = new Date(ev.fecha).toDateString();
    const separador = dia !== diaAnterior ? '<div class="dia">' + esc(nombreDia(ev.fecha)) + '</div>' : '';
    if (dia !== diaAnterior) firmaAnterior = null;
    diaAnterior = dia;
    if (ev.t) { firmaAnterior = null; return separador + anclaTicket(ev.t); }

    const m = ev.m;
    const autor = m.direction === 'IN' ? { clase: '', firma: '' } : autorSaliente(m);
    // La firma ("Jarvis · bot") solo cuando cambia quién escribe: repetida
    // en cada burbuja era ruido.
    const firma = m.direction === 'IN' || autor.firma === firmaAnterior ? '' : autor.firma;
    firmaAnterior = m.direction === 'IN' ? null : autor.firma;
    return separador +
      '<div class="burbuja ' + (m.direction === 'IN' ? 'entra' : 'sale') + autor.clase + '">' +
        firma +
        etiqueta(m) +
        cuerpoMensaje(m.body) +
        '<span class="hora">' + hora(m.createdAt) + '</span>' +
      '</div>';
  });

  const pendientes = (datos.pendientes ?? []).map((p) =>
    '<div class="burbuja sale pendiente' + autorSaliente(p).clase + (p.status === 'FAILED' ? ' fallo' : '') + '">' +
      autorSaliente(p).firma +
      cuerpoMensaje(p.body) +
      '<span class="hora">' + (p.status === 'FAILED'
        ? 'no salió: ' + esc(p.error ?? 'error')
        : 'enviando…') + '</span>' +
    '</div>');

  caja.innerHTML = burbujas.concat(pendientes).join('') ||
    '<p class="muted centro">Sin mensajes todavía.</p>';

  // Solo baja al final si ya estabas abajo: si estás leyendo arriba, no
  // te arrastra. Un hilo recién abierto siempre empieza en lo último.
  if (abajo) caja.scrollTop = caja.scrollHeight;
}

function pintarEstadoHilo(datos) {
  const boton = document.getElementById('hilo-atender');
  const estado = document.getElementById('hilo-estado');

  if (datos.enManosDePersona) {
    boton.textContent = 'Devolver al bot';
    boton.className = 'ghost small activo';
    boton.title = 'El bot vuelve a contestar este chat';
    estado.innerHTML = '<span class="estado persona"><i></i>lo atiendes tú' +
      (datos.handoffUntil ? ' · hasta ' + hora(datos.handoffUntil) : '') + '</span>';
  } else {
    boton.textContent = 'Atender yo';
    boton.className = 'acento';
    boton.title = 'El bot se calla y contestas tú';
    // "El bot atiende" ya lo dice el botón "Atender yo": aquí solo el turno.
    const etiqueta = {
      BOT: ['nuevo', 'sin responder'],
      AGENTE: ['espera', 'espera a una persona'],
      CLIENTE: ['cliente', 'espera al cliente'],
      NADIE: ['ok', 'al día'],
    }[datos.awaiting] ?? ['', datos.awaiting];
    estado.innerHTML = '<span class="estado ' + etiqueta[0] + '"><i></i>' + etiqueta[1] + '</span>';
  }
}

/** Burbujas de mentira mientras llega el hilo: se ve la forma, no un "Cargando…". */
function skeletonHilo() {
  return [['entra', 52], ['sale', 70], ['sale', 46], ['entra', 38], ['sale', 64], ['entra', 58]].map(([lado, ancho]) =>
    '<div class="sk sk-burbuja ' + lado + '" style="width:' + ancho + '%"></div>').join('');
}

/**
 * Cada apertura lleva un turno. El refresco de cada 5 s y un clic en
 * "cerrar" pueden cruzarse: la respuesta que llega tarde de un refresco ya
 * no manda, si mientras tanto cerraste el hilo o abriste otro. Antes esa
 * respuesta tardía lo volvía a abrir y había que cerrar dos veces.
 */
let turnoHilo = 0;
/** El chat que está pintado en el hilo (el que se pidió, no el que devuelve la API). */
let hiloPintado = null;

async function abrirHilo(chatId, silencioso) {
  // Un refresco de un hilo que ya no está abierto no hace nada.
  if (silencioso && chatAbierto !== chatId) return;
  const nuevo = hiloPintado !== chatId;
  chatAbierto = chatId;
  const turno = ++turnoHilo;

  // Hilo nuevo: se abre ya, con el nombre que se ve en la lista y burbujas
  // de carga, en vez de esperar con la pantalla quieta.
  if (nuevo && !silencioso) {
    const fila = [...document.querySelectorAll('[data-chat]')].find((el) => el.dataset.chat === chatId);
    const nombreFila = fila?.querySelector('strong')?.textContent ?? '';
    document.getElementById('hilo-nombre').textContent = nombreFila;
    document.getElementById('hilo-numero').textContent = numeroBonito(chatId);
    document.getElementById('hilo-avatar').textContent = iniciales(nombreFila || '?');
    document.getElementById('hilo-estado').innerHTML = '<span class="sk sk-linea" style="width:120px"></span>';
    document.getElementById('hilo-meta').innerHTML = '';
    document.getElementById('hilo-mensajes').innerHTML = skeletonHilo();
    document.getElementById('hilo').hidden = false;
    app.classList.add('con-hilo');
    document.querySelectorAll('[data-chat]').forEach((el) => el.classList.toggle('abierta', el.dataset.chat === chatId));
  }
  const datos = await api('conversacion?chatId=' + encodeURIComponent(chatId));
  if (!datos || turno !== turnoHilo || chatAbierto !== chatId) return;

  const nombreHilo = datos.contact?.displayName || numeroBonito(datos.contact?.waId) || datos.chatId;
  document.getElementById('hilo-nombre').textContent = nombreHilo;
  const avatarHilo = document.getElementById('hilo-avatar');
  avatarHilo.textContent = iniciales(nombreHilo);
  avatarHilo.style.setProperty('--h', tono(nombreHilo));
  document.getElementById('hilo-numero').textContent = numeroBonito(datos.contact?.waId || datos.chatId);

  pintarEstadoHilo(datos);

  // Por qué número escribió. La misma persona por el número principal y
  // por el de una empresa son dos chats distintos (como en WhatsApp), y sin
  // esta etiqueta se veían como un chat duplicado.
  const lineaHilo = separarLinea(chatId).linea;
  if (lineaHilo && !nombresDeLinea[lineaHilo]) await cargarLineas().catch(() => {});
  const empresaLinea = lineaHilo ? (nombresDeLinea[lineaHilo] ?? 'otra empresa') : null;
  // Contexto en una sola línea de texto: por qué número escribió y de qué
  // empresas es cliente. Antes eran cuatro pastillas que se leían como
  // alertas sin serlo.
  const membresias = datos.contact?.memberships ?? [];
  const contexto = [empresaLinea ? 'vía ' + esc(empresaLinea) : 'número principal']
    .concat(membresias.map((m) => esc(m.organization.name) + ' (' + m.role.toLowerCase() +
      (m.verifiedAt ? '' : ', <span class="warn-text">sin verificar</span>') + ')'));
  document.getElementById('hilo-meta').innerHTML = '<span class="meta-texto">' + contexto.join(' · ') + '</span>';

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

  // Primero se muestra y luego se pinta: un elemento oculto no tiene alto,
  // y el scroll al último mensaje se quedaba en el primero.
  document.getElementById('hilo').hidden = false;
  app.classList.add('con-hilo');

  pintarMensajes(datos, nuevo);
  ultimoHilo = datos;
  hiloPintado = chatId;
  if (nuevo) guardarEstado();

  if (!silencioso) {
    document.querySelectorAll('[data-chat]').forEach((el) =>
      el.classList.toggle('abierta', el.dataset.chat === chatId));
    if (window.innerWidth >= 900) document.getElementById('hilo-texto').focus();
  }
}

function cerrarHilo() {
  turnoHilo++;
  setTimeout(guardarEstado, 0);
  hiloPintado = null;
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
  const tickets = ultimoHilo?.tickets ?? [];
  if (!tickets.length) { aviso('Esta persona no tiene tickets.'); return; }
  // El abierto más reciente; si no hay abiertos, el último.
  const abierto = tickets.filter((t) => t.state !== 'CERRADO');
  const destino = (abierto.length ? abierto : tickets)
    .slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const el = document.getElementById('ticket-' + destino.id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('resalta');
  void el.offsetWidth;
  el.classList.add('resalta');
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

// ── Directorio: la lista de clientes y la ficha de cada uno ─────────────
//
// Lo mismo para el equipo de Jarvis (elige la empresa) y para la gente de
// una empresa (solo la suya; eso lo impone el servidor, aquí solo se
// pinta). Lo sensible —verificar el número, confirmar el nombre a mano,
// dar documentos fiscales— pide el doble paso: confirmar que se habló con
// la persona y anotar cómo. Queda en la auditoría con quién lo hizo.

let dirEmpresa = null;
// Empresas: de cuál se ven los accesos al panel, y la contraseña recién
// creada (se enseña una sola vez y se olvida al cerrar).
let accesosEmpresa = null;
let claveNueva = null;
let dirFiltro = 'todos';
let dirBusqueda = '';
// id de la membresía abierta en la ficha, 'nuevo' para el alta, o null.
let dirSeleccion = null;
// Lo que espera el doble paso: { tipo: 'verificar'|'confirmar'|'permiso'|'nombre', id, category }.
let dirAccion = null;

const ROL_NOMBRE = { VIEWER: 'Cliente', MANAGER: 'Gerente', ADMIN: 'Administrador' };
const SENSIBLES = ['FACTURA', 'CONTRATO', 'POLIZA', 'ESTADO_CUENTA', 'CONTABLE'];

function puedeGestionar() {
  return yo?.role === 'ADMIN' || yo?.role === 'EMPRESA';
}

function nombreVisible(m) {
  return m.fullName || m.contact.displayName || numeroBonito(m.contact.waId);
}

/** Lo que le falta para poder recibir documentos, en una frase. */
function estadoDe(m) {
  if (!m.fullName) return { listo: false, texto: 'Falta su nombre completo' };
  if (!m.nameConfirmedAt) return { listo: false, texto: 'Falta que confirme su nombre' };
  const pideSensible = m.role !== 'VIEWER' || m.grants.some((g) => SENSIBLES.includes(g.category));
  if (!m.verifiedAt && pideSensible) return { listo: false, texto: 'Falta verificar el número' };
  return { listo: true, texto: 'Listo' };
}

function pasosDe(m) {
  return [
    {
      clave: 'nombre', listo: !!m.fullName, titulo: 'Nombre completo registrado',
      detalle: m.fullName ? esc(m.fullName) : 'Sin esto no recibe ningún documento.',
    },
    {
      clave: 'confirmar', listo: !!m.nameConfirmedAt, titulo: 'Confirmó su nombre',
      detalle: m.nameConfirmedAt
        ? 'El ' + fecha(m.nameConfirmedAt)
        : 'El bot se lo pide por WhatsApp la próxima vez que pida un documento.',
    },
    {
      clave: 'verificar', listo: !!m.verifiedAt, titulo: 'Número verificado',
      detalle: m.verifiedAt
        ? 'El ' + fecha(m.verifiedAt)
        : 'Hace falta para facturas, contratos, pólizas, estados de cuenta y contabilidad.',
    },
  ];
}

function formAtestacion(titulo, explicacion) {
  return '<form class="atestacion" id="dir-atestacion">' +
    '<strong>' + titulo + '</strong>' +
    '<p class="muted small">' + explicacion + '</p>' +
    '<label class="check"><input type="checkbox" id="dir-confirmo"> Hablé con esta persona y comprobé que el número es suyo.</label>' +
    '<label class="campo">¿Cómo lo comprobaste?' +
      '<textarea id="dir-nota" rows="2" placeholder="Ej.: le llamé al número registrado y confirmó sus datos"></textarea></label>' +
    '<div class="fila-botones"><button type="submit">Confirmar</button>' +
      '<button type="button" class="ghost" data-dir-cancelar>Cancelar</button></div>' +
  '</form>';
}

function accionDePaso(m, paso) {
  if (!puedeGestionar()) return '';
  const abierta = dirAccion && dirAccion.id === m.id && dirAccion.tipo === paso.clave;

  if (paso.clave === 'nombre') {
    if (abierta) {
      return '<form class="atestacion" id="dir-nombre-form">' +
        '<label class="campo">Nombre completo, con apellidos' +
          '<input id="dir-nombre" value="' + escAttr(m.fullName ?? '') + '" autocomplete="off" required></label>' +
        (m.nameConfirmedAt ? '<p class="muted small">Si lo cambias, tendrá que confirmarlo otra vez.</p>' : '') +
        '<div class="fila-botones"><button type="submit">Guardar</button>' +
          '<button type="button" class="ghost" data-dir-cancelar>Cancelar</button></div>' +
      '</form>';
    }
    return '<button class="mini" data-dir-accion="nombre">' + (m.fullName ? 'Cambiar' : 'Registrar') + '</button>';
  }

  if (paso.listo) return '';

  if (paso.clave === 'confirmar') {
    if (!m.fullName) return '';
    return abierta
      ? formAtestacion('Confirmar el nombre a mano',
          'Desde ahora el bot no le preguntará su nombre: le entregará directamente lo que tenga permitido.')
      : '<button class="mini" data-dir-accion="confirmar">Confirmar a mano</button>';
  }

  return abierta
    ? formAtestacion('Verificar el número',
        'Un número de WhatsApp se reasigna, se clona o se pierde con el teléfono. Verifícalo solo si comprobaste que es de esta persona.')
    : '<button class="mini" data-dir-accion="verificar">Verificar número</button>';
}

function fichaCliente(m) {
  const nombre = nombreVisible(m);
  const tiene = new Set(m.grants.map((g) => g.category));
  const pideAtestacionPermiso = dirAccion && dirAccion.id === m.id && dirAccion.tipo === 'permiso';

  const permisos = m.role === 'VIEWER'
    ? '<div class="permisos-lista">' + CATEGORIAS.map((c) =>
        '<label class="permiso' + (tiene.has(c) ? ' activo' : '') + '">' +
          '<input type="checkbox" data-dir-permiso="' + c + '"' + (tiene.has(c) ? ' checked' : '') +
            (puedeGestionar() ? '' : ' disabled') + '> ' + esc(NOMBRE_CATEGORIA[c] ?? c) +
          (SENSIBLES.includes(c) ? ' <span class="pill warn">sensible</span>' : '') +
        '</label>').join('') + '</div>' +
      '<p class="muted small">Solo recibe documentos que estén a su nombre.</p>' +
      (pideAtestacionPermiso
        ? formAtestacion('Dar acceso a ' + esc(NOMBRE_CATEGORIA[dirAccion.category] ?? dirAccion.category),
            'Es un documento sensible: solo dáselo a quien ya comprobaste quién es.')
        : '')
    : '<p class="muted">Como ' + ROL_NOMBRE[m.role].toLowerCase() + ', ve todos los documentos de su empresa.</p>';

  return '<div class="ficha-head">' +
      '<span class="dir-avatar grande">' + esc(iniciales(nombre)) + '</span>' +
      '<div class="ficha-quien"><h3>' + esc(nombre) + '</h3>' +
        '<div class="muted small"><span class="mono">' + esc(numeroBonito(m.contact.waId)) + '</span> · ' +
          ROL_NOMBRE[m.role] + (m.contact.displayName && m.fullName ? ' · ' + esc(m.contact.displayName) : '') + '</div></div>' +
      '<button class="icon" data-dir-cerrar title="Cerrar">✕</button>' +
    '</div>' +
    '<h4>Identidad</h4>' +
    '<ol class="pasos">' + pasosDe(m).map((p, i) =>
      '<li class="' + (p.listo ? 'hecho' : '') + '">' +
        '<span class="paso-n">' + (p.listo ? '✓' : String(i + 1)) + '</span>' +
        '<div class="paso-cuerpo"><strong>' + p.titulo + '</strong>' +
          '<small class="muted">' + p.detalle + '</small>' + accionDePaso(m, p) + '</div>' +
      '</li>').join('') + '</ol>' +
    '<h4>Qué puede pedir</h4>' + permisos +
    // Emitir facturas es otra cosa que ver documentos: permiso aparte.
    '<h4>Facturación</h4>' +
    '<label class="permiso' + (m.canInvoice ? ' activo' : '') + '"><input type="checkbox" data-dir-facturar' +
      (m.canInvoice ? ' checked' : '') + (puedeGestionar() && (m.verifiedAt || m.canInvoice) ? '' : ' disabled') + '> ' +
      'Puede emitir facturas de ' + esc(m.organization?.name ?? 'la empresa') + ' por WhatsApp</label>' +
    '<p class="muted small">' + (m.verifiedAt
      ? 'Le escribe al bot "factura para…" con los datos de su cliente y se timbra con su "sí".'
      : 'Primero verifica el número: va a facturar a nombre de la empresa.') + '</p>' +
    (puedeGestionar()
      ? '<div class="ficha-pie"><span class="muted small">Alta: ' + fecha(m.createdAt) + '</span>' +
          '<button class="mini peligro" data-dir-revocar="' + m.id + '">Quitar acceso</button></div>'
      : '');
}

function fichaNuevo(empresas) {
  const deEmpresa = yo?.role === 'EMPRESA';
  return '<div class="ficha-head"><div class="ficha-quien"><h3>Nuevo cliente</h3>' +
      '<div class="muted small">Recibirá documentos por WhatsApp cuando confirme su nombre.</div></div>' +
      '<button class="icon" data-dir-cerrar title="Cerrar">✕</button></div>' +
    '<form id="dir-alta" class="alta">' +
      (deEmpresa ? '' : '<label class="campo">Empresa<select id="dir-alta-empresa">' + empresas.map((o) =>
        '<option value="' + o.id + '"' + (o.id === dirEmpresa ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') +
        '</select></label>') +
      '<label class="campo">Número de WhatsApp<input id="tel" placeholder="998 486 2017" autocomplete="off" required>' +
        '<small id="tel-preview" class="muted">Escríbelo como lo tengas; yo lo formateo.</small></label>' +
      '<label class="campo">Nombre completo, con apellidos<input id="dir-alta-nombre" placeholder="Ana Ruiz Soto" autocomplete="off" required>' +
        '<small class="muted">El bot se lo pide por WhatsApp antes del primer documento y debe coincidir.</small></label>' +
      '<label class="campo">Cómo lo identificas <span class="muted">(opcional)</span>' +
        '<input id="dir-alta-alias" placeholder="Contadora de Flores" autocomplete="off"></label>' +
      '<fieldset class="tipo"><legend>Tipo de acceso</legend>' +
        '<label class="opcion"><input type="radio" name="dir-rol" value="VIEWER" checked>' +
          '<span><strong>Cliente</strong><small class="muted">Solo lo que marques abajo, y solo documentos a su nombre.</small></span></label>' +
        '<label class="opcion"><input type="radio" name="dir-rol" value="MANAGER">' +
          '<span><strong>Gerente</strong><small class="muted">Todos los documentos de la empresa.</small></span></label>' +
        (deEmpresa ? '' : '<label class="opcion"><input type="radio" name="dir-rol" value="ADMIN">' +
          '<span><strong>Administrador</strong><small class="muted">Todo, y además autoriza a otros por WhatsApp.</small></span></label>') +
      '</fieldset>' +
      '<div id="dir-alta-permisos"><span class="muted small">Qué puede pedir</span><div class="permisos-lista">' +
        CATEGORIAS.map((c) => '<label class="permiso"><input type="checkbox" name="dir-cat" value="' + c + '"> ' +
          esc(NOMBRE_CATEGORIA[c] ?? c) + (SENSIBLES.includes(c) ? ' <span class="pill warn">sensible</span>' : '') +
        '</label>').join('') +
      '</div></div>' +
      '<div id="dir-alta-atestacion" class="atestacion" hidden>' +
        '<strong>Marcaste documentos sensibles</strong>' +
        '<label class="check"><input type="checkbox" id="dir-alta-confirmo"> Hablé con esta persona y comprobé que el número es suyo.</label>' +
        '<label class="campo">¿Cómo lo comprobaste?<textarea id="dir-alta-nota" rows="2"></textarea></label>' +
      '</div>' +
      '<div class="fila-botones"><button type="submit">Dar de alta</button>' +
        '<button type="button" class="ghost" data-dir-cerrar>Cancelar</button></div>' +
    '</form>';
}

async function vistaDirectorio() {
  const [filas, empresas] = await Promise.all([api('numeros'), api('empresas')]);
  const deEmpresa = yo?.role === 'EMPRESA';
  if (deEmpresa) dirEmpresa = yo.organizationId;
  else if (!empresas.some((o) => o.id === dirEmpresa)) dirEmpresa = empresas[0]?.id ?? null;
  if (!dirEmpresa) return '<p class="vacio">No hay empresas registradas.</p>';

  const propios = filas.filter((m) => m.organization.id === dirEmpresa);
  const pendientes = propios.filter((m) => !estadoDe(m).listo).length;
  if (dirSeleccion && dirSeleccion !== 'nuevo' && !propios.some((m) => m.id === dirSeleccion)) {
    dirSeleccion = null;
    dirAccion = null;
  }

  const visibles = propios
    .filter((m) => dirFiltro === 'todos' || (dirFiltro === 'pendientes') === !estadoDe(m).listo)
    .sort((a, b) => (Number(estadoDe(a).listo) - Number(estadoDe(b).listo)) ||
      nombreVisible(a).localeCompare(nombreVisible(b), 'es'));

  const selector = deEmpresa ? '' : '<select class="compacto" id="dir-empresa">' + empresas.map((o) =>
    '<option value="' + o.id + '"' + (o.id === dirEmpresa ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') +
    '</select>';

  const chips = [
    ['todos', 'Todos', propios.length],
    ['pendientes', 'Pendientes', pendientes],
    ['listos', 'Listos', propios.length - pendientes],
  ].map(([valor, texto, n]) =>
    '<button class="chip' + (dirFiltro === valor ? ' activo' : '') + '" data-dir-filtro="' + valor + '">' +
      texto + ' <span class="muted">' + n + '</span></button>').join('');

  const barra = '<div class="dir-barra">' + selector +
    '<input class="dir-buscar" id="dir-buscar" placeholder="Buscar por nombre o número" autocomplete="off" value="' + escAttr(dirBusqueda) + '">' +
    chips + '<span class="spacer"></span>' +
    (puedeGestionar() ? '<button class="primario" data-dir-nuevo>+ Nuevo cliente</button>' : '') +
  '</div>';

  const filasHtml = visibles.map((m) => {
    const e = estadoDe(m);
    const nombre = nombreVisible(m);
    const busca = (nombre + ' ' + (m.contact.displayName ?? '') + ' ' + m.contact.waId).toLowerCase();
    return '<button class="dir-fila' + (m.id === dirSeleccion ? ' activa' : '') + '" data-dir-ver="' + m.id + '"' +
        ' data-busca="' + escAttr(busca) + '">' +
      '<span class="dir-avatar">' + esc(iniciales(nombre)) + '</span>' +
      '<span class="dir-quien"><strong>' + esc(nombre) + '</strong>' +
        '<small class="mono">' + esc(numeroBonito(m.contact.waId)) + '</small></span>' +
      '<span class="dir-rol">' + ROL_NOMBRE[m.role] + '</span>' +
      '<span class="dir-estado ' + (e.listo ? 'ok' : 'warn') + '">' + (e.listo ? '✓ ' : '') + esc(e.texto) + '</span>' +
    '</button>';
  }).join('');

  const lista = '<div class="card dir-lista">' + (filasHtml || '<p class="vacio">' +
    (propios.length ? 'Nadie con este filtro.' : 'Todavía no hay clientes. Da de alta el primero.') + '</p>') + '</div>';

  const seleccionado = propios.find((m) => m.id === dirSeleccion);
  const ficha = dirSeleccion === 'nuevo'
    ? fichaNuevo(empresas)
    : seleccionado ? fichaCliente(seleccionado) : '';

  // La búsqueda filtra lo ya pintado: escribir no repinta ni pierde el foco.
  setTimeout(filtrarDirectorio, 0);

  return barra + '<div class="dir-layout' + (ficha ? ' con-ficha' : '') + '">' + lista +
    (ficha ? '<aside class="card dir-ficha">' + ficha + '</aside>' : '') + '</div>';
}

function filtrarDirectorio() {
  const q = dirBusqueda.trim().toLowerCase();
  document.querySelectorAll('.dir-fila').forEach((fila) => {
    fila.hidden = q !== '' && !fila.dataset.busca.includes(q);
  });
}

/** Con algo a medio llenar en el directorio, el refresco automático espera. */
function directorioOcupado() {
  return vistaActual === 'directorio' && (dirSeleccion === 'nuevo' || dirAccion !== null);
}

const repintarDirectorio = () => pintar('directorio', true);

document.addEventListener('input', (e) => {
  if (e.target.id === 'dir-buscar') {
    dirBusqueda = e.target.value;
    filtrarDirectorio();
  }
});

document.addEventListener('click', async (e) => {
  const ver = e.target.closest('[data-dir-ver]');
  if (ver) { dirSeleccion = ver.dataset.dirVer; dirAccion = null; return repintarDirectorio(); }

  if (e.target.closest('[data-dir-nuevo]')) { dirSeleccion = 'nuevo'; dirAccion = null; return repintarDirectorio(); }
  if (e.target.closest('[data-dir-cerrar]')) { dirSeleccion = null; dirAccion = null; return repintarDirectorio(); }
  if (e.target.closest('[data-dir-cancelar]')) { dirAccion = null; return repintarDirectorio(); }

  const filtro = e.target.closest('[data-dir-filtro]');
  if (filtro) { dirFiltro = filtro.dataset.dirFiltro; return repintarDirectorio(); }

  const accion = e.target.closest('[data-dir-accion]');
  if (accion) { dirAccion = { tipo: accion.dataset.dirAccion, id: dirSeleccion }; return repintarDirectorio(); }

  const revocar = e.target.closest('[data-dir-revocar]');
  if (revocar) {
    if (!confirm('¿Quitarle el acceso? Deja de recibir documentos por WhatsApp desde este momento.')) return;
    try {
      await enviar('numeros/revocar', { id: revocar.dataset.dirRevocar });
      aviso('Acceso retirado');
      dirSeleccion = null;
      dirAccion = null;
      repintarDirectorio();
    } catch (err) { aviso(err.message, 'error'); }
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'dir-empresa') {
    dirEmpresa = e.target.value;
    dirSeleccion = null;
    dirAccion = null;
    return repintarDirectorio();
  }

  // Alta: los permisos solo aplican a un cliente; lo sensible pide el doble paso.
  if (e.target.name === 'dir-rol' || e.target.name === 'dir-cat') {
    const rol = document.querySelector('input[name="dir-rol"]:checked')?.value;
    document.getElementById('dir-alta-permisos').hidden = rol !== 'VIEWER';
    const sensible = rol === 'VIEWER' &&
      [...document.querySelectorAll('input[name="dir-cat"]:checked')].some((c) => SENSIBLES.includes(c.value));
    document.getElementById('dir-alta-atestacion').hidden = !sensible;
    return;
  }

  const facturar = e.target.closest('[data-dir-facturar]');
  if (facturar) {
    if (facturar.checked && !confirm('Este número podrá timbrar facturas a nombre de la empresa desde WhatsApp. ¿Seguimos?')) {
      facturar.checked = false;
      return;
    }
    try {
      await enviar('numeros/facturar', { id: dirSeleccion, enabled: facturar.checked });
      aviso(facturar.checked ? 'Ya puede emitir facturas por WhatsApp' : 'Ya no puede emitir facturas');
      repintarDirectorio();
    } catch (err) {
      facturar.checked = !facturar.checked;
      aviso(err.message, 'error');
    }
    return;
  }

  const permiso = e.target.closest('[data-dir-permiso]');
  if (permiso) {
    const category = permiso.dataset.dirPermiso;
    if (permiso.checked && SENSIBLES.includes(category)) {
      permiso.checked = false;
      dirAccion = { tipo: 'permiso', id: dirSeleccion, category };
      return repintarDirectorio();
    }
    try {
      await enviar('numeros/permiso', { membershipId: dirSeleccion, category, enabled: permiso.checked });
      aviso(permiso.checked ? 'Ahora puede pedir ' + (NOMBRE_CATEGORIA[category] ?? category) : 'Permiso retirado');
      repintarDirectorio();
    } catch (err) {
      permiso.checked = !permiso.checked;
      aviso(err.message, 'error');
    }
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'dir-atestacion') {
    e.preventDefault();
    const firma = {
      confirmo: document.getElementById('dir-confirmo').checked,
      nota: document.getElementById('dir-nota').value,
    };
    const a = dirAccion;
    try {
      if (a.tipo === 'verificar') {
        await enviar('numeros/verificar', { id: a.id, ...firma });
        aviso('Número verificado');
      } else if (a.tipo === 'confirmar') {
        await enviar('numeros/confirmar-nombre', { id: a.id, ...firma });
        aviso('Nombre confirmado');
      } else if (a.tipo === 'permiso') {
        await enviar('numeros/permiso', { membershipId: a.id, category: a.category, enabled: true, ...firma });
        aviso('Ahora puede pedir ' + (NOMBRE_CATEGORIA[a.category] ?? a.category));
      }
      dirAccion = null;
      repintarDirectorio();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  if (e.target.id === 'dir-nombre-form') {
    e.preventDefault();
    try {
      await enviar('numeros/nombre', { id: dirAccion.id, fullName: document.getElementById('dir-nombre').value });
      aviso('Nombre guardado');
      dirAccion = null;
      repintarDirectorio();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  if (e.target.id === 'dir-alta') {
    e.preventDefault();
    const rol = document.querySelector('input[name="dir-rol"]:checked').value;
    try {
      const r = await enviar('numeros', {
        organizationId: document.getElementById('dir-alta-empresa')?.value ?? dirEmpresa,
        phone: document.getElementById('tel').value,
        fullName: document.getElementById('dir-alta-nombre').value,
        displayName: document.getElementById('dir-alta-alias').value,
        role: rol,
        categories: rol === 'VIEWER'
          ? [...document.querySelectorAll('input[name="dir-cat"]:checked')].map((c) => c.value)
          : [],
        confirmo: document.getElementById('dir-alta-confirmo').checked,
        nota: document.getElementById('dir-alta-nota').value,
      });
      aviso('Alta lista: ' + r.display + (r.existsOnWhatsApp ? '' : ' (WhatsApp no lo reconoció)'));
      const empresaAlta = document.getElementById('dir-alta-empresa')?.value;
      if (empresaAlta) dirEmpresa = empresaAlta;
      dirSeleccion = null;
      repintarDirectorio();
    } catch (err) { aviso(err.message, 'error'); }
  }
});

/**
 * Quién de una empresa entra a su propio panel: ve y gestiona sus clientes
 * y sus documentos, nada más. La contraseña la genera el servidor y se
 * enseña una sola vez.
 */
async function tarjetaAccesos(empresa) {
  if (!empresa) { accesosEmpresa = null; return ''; }
  const usuarios = await api('empresas/usuarios?empresa=' + encodeURIComponent(empresa.id));

  return '<section class="card accesos">' +
    '<div class="ficha-head"><div class="ficha-quien"><h3>Accesos al panel · ' + esc(empresa.name) + '</h3>' +
      '<div class="muted small">Ven y gestionan sus clientes y sus documentos. No ven conversaciones, tickets ni otras empresas.</div></div>' +
      '<button class="icon" data-accesos-cerrar title="Cerrar">✕</button></div>' +
    (claveNueva
      ? '<div class="atestacion"><strong>Contraseña de ' + esc(claveNueva.email) + '</strong>' +
          '<span class="mono clave">' + esc(claveNueva.password) + '</span>' +
          '<span class="muted small">Cópiala ahora y compártela por un canal seguro: no se vuelve a mostrar.</span></div>'
      : '') +
    (usuarios.length
      ? '<ul class="accesos-lista">' + usuarios.map((u) =>
          '<li><span class="dir-quien"><strong>' + esc(u.name) + '</strong><small>' + esc(u.email) +
            (u.lastLoginAt ? ' · entró ' + fecha(u.lastLoginAt) : ' · aún no entra') + '</small></span>' +
          '<button class="mini peligro" data-acceso-baja="' + u.id + '">Quitar</button></li>').join('') + '</ul>'
      : '<p class="muted small">Nadie de esta empresa tiene acceso todavía.</p>') +
    '<form id="form-acceso" class="fila-alta">' +
      '<label class="campo">Nombre<input id="acceso-nombre" placeholder="Paula Flores" required></label>' +
      '<label class="campo">Correo<input id="acceso-correo" type="email" placeholder="paula@empresa.com" required></label>' +
      '<button type="submit">Dar acceso</button>' +
    '</form>' +
  '</section>';
}

document.addEventListener('click', async (e) => {
  const abrir = e.target.closest('[data-accesos]');
  if (abrir) { accesosEmpresa = abrir.dataset.accesos; claveNueva = null; return pintar('empresas', true); }

  if (e.target.closest('[data-accesos-cerrar]')) { accesosEmpresa = null; claveNueva = null; return pintar('empresas', true); }

  const baja = e.target.closest('[data-acceso-baja]');
  if (baja) {
    if (!confirm('¿Quitarle el acceso al panel? Su sesión se cierra en ese momento.')) return;
    try {
      await enviar('empresas/usuarios/baja', { id: baja.dataset.accesoBaja });
      aviso('Acceso al panel retirado');
      pintar('empresas', true);
    } catch (err) { aviso(err.message, 'error'); }
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'form-acceso') return;
  e.preventDefault();
  try {
    claveNueva = await enviar('empresas/usuarios', {
      organizationId: accesosEmpresa,
      name: document.getElementById('acceso-nombre').value,
      email: document.getElementById('acceso-correo').value,
    });
    aviso('Acceso creado');
    pintar('empresas', true);
  } catch (err) { aviso(err.message, 'error'); }
});

// ── Ventas: pedidos, catálogo y configuración de una empresa ───────────

let vtEmpresa = null;
let vtTab = 'pedidos';
let vtEstado = 'activos';
let vtProducto = null; // id del producto en edición, 'nuevo' o null
const SALTO = String.fromCharCode(10);

const DIAS_VT = [['lun', 'Lunes'], ['mar', 'Martes'], ['mie', 'Miércoles'], ['jue', 'Jueves'], ['vie', 'Viernes'], ['sab', 'Sábado'], ['dom', 'Domingo']];
const ENTREGAS_VT = {
  RECOGER: ['Pasar a recoger', 'El cliente pasa por su pedido.'],
  DOMICILIO: ['A domicilio', 'Lo llevan ustedes, con costo por zona.'],
  PAQUETERIA: ['Paquetería', 'Envío a cualquier parte (equipo, productos físicos).'],
  DIGITAL: ['Digital', 'No hay nada que mover: servicios, páginas web, licencias.'],
};
const ESTADO_PEDIDO = {
  ARMANDO: ['armándose', ''], POR_ACEPTAR: ['por aceptar', 'warn'], ACEPTADO: ['aceptado', 'ok'],
  RECHAZADO: ['rechazado', ''], ENTREGADO: ['entregado', 'ok'], CANCELADO: ['cancelado', ''],
};

const dinero = (cents) => '$' + (cents / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 });

function pillScore(score) {
  if (score === null || score === undefined) return '';
  const color = score >= 70 ? 'ok' : score >= 40 ? 'warn' : '';
  return '<span class="pill ' + color + '" title="Probabilidad de que termine en compra">' + score + '% compra</span>';
}

/**
 * La empresa que se ve en Ventas.
 *
 * Antes abría en la primera por orden alfabético, y el catálogo de una
 * pollería acabó capturado en una constructora. Ahora recuerda la última
 * que elegiste y, si no hay, abre en una que de verdad vende: con WhatsApp
 * propio y ventas activas.
 */
function empresaVentas(empresas) {
  if (yo?.role === 'EMPRESA') return yo.organizationId;
  if (!empresas.some((o) => o.id === vtEmpresa)) {
    let guardada = null;
    try { guardada = localStorage.getItem('vt-empresa'); } catch {}
    vtEmpresa = (empresas.find((o) => o.id === guardada)
      ?? empresas.find((o) => o.waLineId && o.sales?.enabled)
      ?? empresas.find((o) => o.waLineId)
      ?? empresas[0])?.id ?? null;
  }
  return vtEmpresa;
}

/** Qué empresa estás viendo y si de verdad puede vender, antes de capturar nada. */
function vtFicha(o) {
  const vende = o.sales?.enabled;
  const productos = o._count?.products ?? 0;
  const pills =
    (o.waLineId
      ? '<span class="pill ok">WhatsApp ' + esc(o.waNumber ? '+' + o.waNumber : 'conectado') + '</span>'
      : '<span class="pill warn">sin WhatsApp propio</span>') +
    (vende ? '<span class="pill ok">ventas activas</span>' : '<span class="pill">ventas apagadas</span>') +
    '<span class="pill">' + productos + (productos === 1 ? ' producto' : ' productos') + '</span>';
  const alerta = !o.waLineId
    ? '<p class="alert">' + esc(o.name) + ' no tiene WhatsApp propio. Las ventas solo entran por el número de la empresa: ' +
        'conéctalo en Empresas. Mientras tanto, el bot no ofrece nada de lo que captures aquí.</p>'
    : '';
  return '<div class="fila-pills vt-estado">' + pills + '</div>' + alerta;
}

const conEmpresa = (ruta) => ruta + (yo?.role === 'EMPRESA' ? '' : (ruta.includes('?') ? '&' : '?') + 'empresa=' + encodeURIComponent(vtEmpresa));

async function vistaVentas() {
  const empresas = await api('empresas');
  if (!empresaVentas(empresas)) return '<p class="vacio">No hay empresas registradas.</p>';

  // Las que venden primero: son las que el equipo viene a revisar.
  const orden = [...empresas].sort((a, b) =>
    Number(!!b.sales?.enabled) - Number(!!a.sales?.enabled) ||
    Number(!!b.waLineId) - Number(!!a.waLineId) ||
    a.name.localeCompare(b.name, 'es'));
  const selector = yo?.role === 'EMPRESA' ? '' :
    '<label class="campo en-linea vt-selector">Empresa<select id="vt-empresa">' + orden.map((o) =>
      '<option value="' + o.id + '"' + (o.id === vtEmpresa ? ' selected' : '') + '>' + esc(o.name) +
        (o.sales?.enabled ? ' · vende' : o.waLineId ? ' · WhatsApp propio' : '') + '</option>').join('') + '</select></label>';
  const tabs = [['pedidos', 'Pedidos'], ['catalogo', 'Catálogo'], ['config', 'Configuración'], ['facturas', 'Facturas'], ['facturacion', 'Facturación']].map(([v, t]) =>
    '<button class="chip' + (vtTab === v ? ' activo' : '') + '" data-vt-tab="' + v + '">' + t + '</button>').join('');

  const actual = empresas.find((o) => o.id === vtEmpresa);
  const cuerpo = vtTab === 'catalogo' ? await vtCatalogo() : vtTab === 'config' ? await vtConfig()
    : vtTab === 'facturas' ? await vtFacturas() : vtTab === 'facturacion' ? await vtFacturacion() : await vtPedidos();
  return '<div class="dir-barra">' + selector + tabs + '</div>' + (actual ? vtFicha(actual) : '') + cuerpo;
}

async function vtPedidos() {
  const [pedidos, config] = await Promise.all([api(conEmpresa('ventas/pedidos?estado=' + vtEstado)), api(conEmpresa('ventas/config'))]);
  const filtros = [['activos', 'Por atender'], ['armando', 'En conversación'], ['cerrados', 'Cerrados']].map(([v, t]) =>
    '<button class="chip' + (vtEstado === v ? ' activo' : '') + '" data-vt-estado="' + v + '">' + t + '</button>').join('');
  const aviso = config.enabled ? '' :
    '<p class="alert">Las ventas están apagadas: el bot no está tomando pedidos. Actívalas en Configuración.</p>';

  if (!pedidos.length) {
    return aviso + '<div class="chips">' + filtros + '</div><p class="vacio">' +
      (vtEstado === 'activos' ? 'No hay pedidos por atender.' : 'Nada por aquí.') + '</p>';
  }

  const tarjeta = (o) => {
    const [estado, clase] = ESTADO_PEDIDO[o.status] ?? [o.status, ''];
    const cliente = o.customerName || o.contact?.displayName || numeroBonito(o.contact?.waId ?? '');
    const items = (o.items ?? []).map((i) =>
      '<li>' + i.cantidad + ' × ' + esc(i.nombre) + (i.nota ? ' <span class="muted">(' + esc(i.nota) + ')</span>' : '') +
      '<span class="spacer"></span>' + dinero(i.precioCents * i.cantidad) + '</li>').join('');
    const entrega = o.deliveryMode
      ? (ENTREGAS_VT[o.deliveryMode]?.[0] ?? o.deliveryMode) + (o.address ? ': ' + ligasMaps(esc(o.address)) : '') + (o.zone ? ' (' + esc(o.zone) + ')' : '')
      : 'Entrega sin elegir';
    const cuando = o.etaAt ? 'Listo para ' + fecha(o.etaAt) : o.scheduledFor ? 'Programado para ' + fecha(o.scheduledFor) : 'Lo antes posible';

    let acciones = '';
    if (o.status === 'POR_ACEPTAR') {
      acciones = '<div class="vt-acciones">' +
        (o.scheduledFor ? '' : '<label class="campo en-linea">Listo en <input type="number" min="0" max="600" value="' +
          (config.prepMinutes ?? 30) + '" data-vt-minutos="' + o.id + '"> min</label>') +
        '<button class="primario" data-vt-aceptar="' + o.id + '">Aceptar</button>' +
        '<input class="vt-motivo" placeholder="Motivo si lo rechazas" data-vt-motivo="' + o.id + '">' +
        '<button class="mini peligro" data-vt-rechazar="' + o.id + '">Rechazar</button></div>';
    } else if (o.status === 'ACEPTADO') {
      acciones = '<div class="vt-acciones"><button class="mini" data-vt-entregado="' + o.id + '">Marcar entregado</button></div>';
    }

    return '<article class="card vt-pedido">' +
      '<div class="vt-cabeza"><strong>P-' + o.number + '</strong>' +
        '<span class="pill ' + clase + '">' + estado + '</span>' + pillScore(o.buyingScore) +
        '<span class="spacer"></span><span class="muted small">' + fecha(o.submittedAt ?? o.updatedAt) + '</span></div>' +
      '<div class="vt-cliente">' + esc(cliente) + ' <span class="muted mono small">' + esc(numeroBonito(o.contact?.waId ?? '')) + '</span></div>' +
      (items ? '<ul class="vt-items">' + items + '</ul>' : '<p class="muted small">Aún sin productos.</p>') +
      (o.deliveryCents ? '<div class="muted small">Envío ' + dinero(o.deliveryCents) + '</div>' : '') +
      '<div class="vt-total">Total <strong>' + dinero(o.totalCents) + '</strong></div>' +
      '<div class="muted small">' + entrega + ' · ' + cuando + (o.notes ? ' · Nota: ' + esc(o.notes) : '') + '</div>' +
      (o.rejectReason ? '<div class="muted small">Rechazado: ' + esc(o.rejectReason) + '</div>' : '') +
      acciones +
    '</article>';
  };

  return aviso + '<div class="chips">' + filtros + '</div><div class="vt-grid">' + pedidos.map(tarjeta).join('') + '</div>';
}

async function vtCatalogo() {
  const productos = await api(conEmpresa('ventas/productos'));
  const editando = vtProducto && vtProducto !== 'nuevo' ? productos.find((p) => p.id === vtProducto) : null;
  const p = editando ?? { name: '', section: '', description: '', priceCents: 0, active: true };

  const form = vtProducto
    ? '<form id="vt-form-producto" class="card alta vt-form">' +
        '<h3>' + (editando ? 'Editar producto' : 'Nuevo producto') + '</h3>' +
        '<div class="fila-alta">' +
          '<label class="campo">Nombre<input id="vt-p-nombre" required value="' + escAttr(p.name) + '" placeholder="Ej. Plan Pro mensual, Pollo entero"></label>' +
          '<label class="campo">Sección<input id="vt-p-seccion" value="' + escAttr(p.section) + '" placeholder="Ej. Planes, Extras"></label>' +
          '<label class="campo">Precio (pesos)<input id="vt-p-precio" type="number" min="0" step="0.5" required value="' + (p.priceCents / 100) + '"></label>' +
        '</div>' +
        '<label class="campo">Descripción <span class="muted">(el bot la usa para recomendar: qué incluye, para quién es)</span>' +
          '<input id="vt-p-desc" value="' + escAttr(p.description) + '" placeholder="Qué incluye y para quién es"></label>' +
        '<fieldset class="tipo"><legend>Qué días se vende <span class="muted">(sin marcar = todos)</span></legend><div class="permisos-lista">' +
          DIAS_VT.map(([d, n]) => '<label class="permiso"><input type="checkbox" name="vt-p-dia" value="' + d + '"' +
            ((p.availableDays ?? []).includes(d) ? ' checked' : '') + '> ' + n + '</label>').join('') + '</div></fieldset>' +
        '<label class="check"><input type="checkbox" id="vt-p-activo"' + (p.active ? ' checked' : '') + '> Disponible para vender</label>' +
        '<div class="fila-botones"><button type="submit">Guardar</button><button type="button" class="ghost" data-vt-producto-cerrar>Cancelar</button></div>' +
      '</form>'
    : '';

  const filas = productos.map((x) => '<tr' + (x.active ? '' : ' class="apagado"') + '>' +
    '<td><strong>' + esc(x.name) + '</strong>' + ((x.availableDays ?? []).length ? ' <span class="pill warn">solo ' +
      x.availableDays.map((d) => (DIAS_VT.find(([k]) => k === d) ?? [d, d])[1].toLowerCase()).join(', ') + '</span>' : '') +
      (x.description ? '<div class="muted small">' + esc(x.description) + '</div>' : '') + '</td>' +
    '<td>' + esc(x.section || '—') + '</td>' +
    '<td>' + dinero(x.priceCents) + '</td>' +
    '<td>' + (x.active ? '<span class="pill ok">disponible</span>' : '<span class="pill">no disponible</span>') + '</td>' +
    '<td class="acciones">' + (puedeGestionar() ? '<button class="mini" data-vt-producto="' + x.id + '">Editar</button>' : '') + '</td>' +
  '</tr>');

  return (puedeGestionar() && !vtProducto ? '<div class="dir-barra"><span class="spacer"></span><button class="primario" data-vt-producto="nuevo">+ Producto</button></div>' : '') +
    form + tabla(['Producto', 'Sección', 'Precio', 'Estado', ''], filas, 'Todavía no hay productos. El bot solo vende lo que esté aquí.');
}

const ZONAS_VT = [
  ['America/Mexico_City', 'Centro (CDMX, Guadalajara, Monterrey)'],
  ['America/Cancun', 'Quintana Roo (Cancún)'],
  ['America/Chihuahua', 'Chihuahua'],
  ['America/Hermosillo', 'Sonora'],
  ['America/Mazatlan', 'Pacífico (Sinaloa, Nayarit, BCS)'],
  ['America/Tijuana', 'Baja California'],
];
const DIA_CORTO = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' };

/**
 * El mismo horario todos los días abiertos se captura una vez: siete
 * renglones iguales era lo que más estorbaba. Solo si de verdad cambia por
 * día se abren los renglones.
 */
function horarioSimple(horas) {
  const abiertos = DIAS_VT.map(([d]) => d).filter((d) => (horas[d] ?? []).length > 0);
  if (abiertos.some((d) => horas[d].length !== 1)) return null;
  const rangos = new Set(abiertos.map((d) => horas[d][0][0] + '-' + horas[d][0][1]));
  if (rangos.size > 1) return null;
  const [de, a] = abiertos.length ? horas[abiertos[0]][0] : ['09:00', '19:00'];
  return { dias: abiertos, de, a };
}

async function vtConfig() {
  const c = await api(conEmpresa('ventas/config'));
  const horas = c.hours ?? {};
  const d = puedeGestionar() ? '' : ' disabled';
  const simple = horarioSimple(horas);
  const modos = c.deliveryModes ?? [];

  const fila = ([dia, nombre]) => {
    const tramo = (horas[dia] ?? [])[0];
    return '<div class="vt-dia"><span>' + nombre + '</span>' +
      '<label class="check"><input type="checkbox" data-vt-abre-dia="' + dia + '"' + (tramo ? ' checked' : '') + d + '> Abre</label>' +
      '<input type="time" data-vt-de="' + dia + '" value="' + (tramo?.[0] ?? '09:00') + '"' + d + '>' +
      '<span class="muted">a</span><input type="time" data-vt-a="' + dia + '" value="' + (tramo?.[1] ?? '19:00') + '"' + d + '></div>';
  };
  const zonas = (c.zones ?? []).map((z) => z.nombre + ', ' + z.costo).join(SALTO);

  const negocio = '<section class="card vt-sec vt-sec-ancha">' +
    '<h3>El negocio</h3>' +
    '<label class="campo">Qué vende, en una frase' +
      '<input id="vt-c-giro" value="' + escAttr(c.businessType) + '" placeholder="Ej. comida para llevar, equipo de cómputo, servicios digitales"' + d + '></label>' +
    '<label class="campo">Lo que el bot debe saber para recomendar' +
      '<textarea id="vt-c-pitch" rows="7" placeholder="Qué es lo más pedido, para quién es cada cosa, promociones vigentes y qué recomendar a quien no sabe qué elegir."' + d + '>' + esc(c.pitch) + '</textarea>' +
      '<small class="muted">El bot no inventa promociones ni precios: solo usa lo que escribas aquí y lo que esté en el Catálogo.</small></label>' +
  '</section>';

  const horario = '<section class="card vt-sec">' +
    '<h3>Horario</h3>' +
    '<label class="campo">Zona horaria<select id="vt-c-tz"' + d + '>' +
      ZONAS_VT.map(([z, t]) => '<option value="' + z + '"' + (z === c.timezone ? ' selected' : '') + '>' + t + '</option>').join('') +
      (ZONAS_VT.some(([z]) => z === c.timezone) ? '' : '<option value="' + escAttr(c.timezone) + '" selected>' + esc(c.timezone) + '</option>') +
    '</select></label>' +
    '<div id="vt-horario-simple"' + (simple ? '' : ' hidden') + '>' +
      '<div class="vt-dias-chips">' + DIAS_VT.map(([dia]) =>
        '<label class="dia-chip"><input type="checkbox" data-vt-dia-simple="' + dia + '"' +
          ((simple?.dias ?? []).includes(dia) ? ' checked' : '') + d + '><span>' + DIA_CORTO[dia] + '</span></label>').join('') + '</div>' +
      '<div class="vt-rango">De <input type="time" id="vt-h-de" value="' + (simple?.de ?? '09:00') + '"' + d + '> a ' +
        '<input type="time" id="vt-h-a" value="' + (simple?.a ?? '19:00') + '"' + d + '></div>' +
    '</div>' +
    '<div id="vt-horario-dias"' + (simple ? ' hidden' : '') + '>' + DIAS_VT.map(fila).join('') + '</div>' +
    (puedeGestionar() ? '<button type="button" class="enlace" data-vt-horario-modo>' +
      (simple ? 'Horario distinto por día' : 'Mismo horario todos los días') + '</button>' : '') +
  '</section>';

  const entrega = '<section class="card vt-sec">' +
    '<h3>Entrega</h3>' +
    '<div class="vt-modos">' + Object.entries(ENTREGAS_VT).map(([m, [t, desc]]) =>
      '<label class="vt-modo"><input type="checkbox" name="vt-entrega" value="' + m + '"' + (modos.includes(m) ? ' checked' : '') + d + '>' +
        '<span><strong>' + t + '</strong><small class="muted">' + desc + '</small></span></label>').join('') + '</div>' +
    '<label class="campo" data-vt-si="DOMICILIO">Zonas a domicilio <span class="muted">(una por renglón: nombre, costo)</span>' +
      '<textarea id="vt-c-zonas" rows="3" placeholder="Centro, 30' + SALTO + 'Región 100, 45"' + d + '>' + esc(zonas) + '</textarea></label>' +
    '<div class="fila-alta">' +
      '<label class="campo" data-vt-si="FISICO">Minutos para tener listo un pedido<input id="vt-c-prep" type="number" min="5" max="1440" value="' + c.prepMinutes + '"' + d + '></label>' +
      '<label class="campo">Pedido mínimo <span class="muted">(pesos, 0 = sin mínimo)</span><input id="vt-c-min" type="number" min="0" value="' + c.minOrder + '"' + d + '></label>' +
    '</div>' +
  '</section>';

  setTimeout(vtAjustarEntrega, 0);
  return '<form id="vt-form-config" class="vt-config">' +
    '<label class="card vt-activar-card"><input type="checkbox" id="vt-c-activo"' + (c.enabled ? ' checked' : '') + d + '>' +
      '<span><strong>Vender por WhatsApp</strong><small class="muted">Quien escriba al WhatsApp de la empresa y no sea cliente registrado podrá cotizar y hacer pedidos.</small></span></label>' +
    '<div class="vt-cols">' + negocio + horario + entrega + '</div>' +
    (puedeGestionar() ? '<div class="fila-botones"><button type="submit">Guardar configuración</button></div>' : '') +
  '</form>';
}

/** Zonas solo con domicilio; tiempo de preparación solo si hay algo físico que preparar. */
function vtAjustarEntrega() {
  const marcados = [...document.querySelectorAll('input[name="vt-entrega"]:checked')].map((c) => c.value);
  document.querySelectorAll('[data-vt-si]').forEach((el) => {
    const si = el.dataset.vtSi;
    el.hidden = si === 'FISICO' ? !marcados.some((m) => m !== 'DIGITAL') : !marcados.includes(si);
  });
}

document.addEventListener('change', (e) => {
  if (e.target.name === 'vt-entrega') vtAjustarEntrega();
});

document.addEventListener('click', (e) => {
  const modo = e.target.closest('[data-vt-horario-modo]');
  if (!modo) return;
  const simple = document.getElementById('vt-horario-simple');
  const dias = document.getElementById('vt-horario-dias');
  const aDias = !simple.hidden;
  if (aDias) {
    // Lo capturado en el modo simple se copia a los renglones.
    const de = document.getElementById('vt-h-de').value;
    const a = document.getElementById('vt-h-a').value;
    for (const [dia] of DIAS_VT) {
      document.querySelector('[data-vt-abre-dia="' + dia + '"]').checked = document.querySelector('[data-vt-dia-simple="' + dia + '"]').checked;
      document.querySelector('[data-vt-de="' + dia + '"]').value = de;
      document.querySelector('[data-vt-a="' + dia + '"]').value = a;
    }
  }
  simple.hidden = aDias;
  dias.hidden = !aDias;
  modo.textContent = aDias ? 'Mismo horario todos los días' : 'Horario distinto por día';
});

const repintarVentas = () => pintar('ventas', true);

/** Con un formulario de ventas abierto, el refresco automático espera. */
function ventasOcupado() {
  return vistaActual === 'ventas' && (vtTab === 'config' || vtTab === 'facturacion' || vtProducto !== null);
}

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-vt-tab]');
  if (tab) { vtTab = tab.dataset.vtTab; vtProducto = null; return repintarVentas(); }
  const est = e.target.closest('[data-vt-estado]');
  if (est) { vtEstado = est.dataset.vtEstado; return repintarVentas(); }
  const prod = e.target.closest('[data-vt-producto]');
  if (prod) { vtProducto = prod.dataset.vtProducto; return repintarVentas(); }
  if (e.target.closest('[data-vt-producto-cerrar]')) { vtProducto = null; return repintarVentas(); }

  const empresaBody = yo?.role === 'EMPRESA' ? {} : { organizationId: vtEmpresa };

  const aceptar = e.target.closest('[data-vt-aceptar]');
  if (aceptar) {
    const id = aceptar.dataset.vtAceptar;
    const minutos = document.querySelector('[data-vt-minutos="' + id + '"]')?.value ?? 0;
    try {
      await enviar('ventas/pedidos/aceptar', { ...empresaBody, id, minutos: Number(minutos) });
      aviso('Pedido aceptado: ya le avisé al cliente');
      repintarVentas();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const rechazar = e.target.closest('[data-vt-rechazar]');
  if (rechazar) {
    const id = rechazar.dataset.vtRechazar;
    const motivo = document.querySelector('[data-vt-motivo="' + id + '"]')?.value ?? '';
    if (!confirm('¿Rechazar este pedido? Se le avisa al cliente con el motivo que escribiste.')) return;
    try {
      await enviar('ventas/pedidos/rechazar', { ...empresaBody, id, motivo });
      aviso('Pedido rechazado; el cliente ya lo sabe');
      repintarVentas();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const entregado = e.target.closest('[data-vt-entregado]');
  if (entregado) {
    try {
      await enviar('ventas/pedidos/entregado', { ...empresaBody, id: entregado.dataset.vtEntregado });
      aviso('Marcado como entregado');
      repintarVentas();
    } catch (err) { aviso(err.message, 'error'); }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'vt-empresa') {
    vtEmpresa = e.target.value;
    vtProducto = null;
    ftSeries = null;
    try { localStorage.setItem('vt-empresa', vtEmpresa); } catch {}
    repintarVentas();
  }
});

document.addEventListener('submit', async (e) => {
  const empresaBody = yo?.role === 'EMPRESA' ? {} : { organizationId: vtEmpresa };

  if (e.target.id === 'vt-form-producto') {
    e.preventDefault();
    try {
      await enviar('ventas/productos', {
        ...empresaBody,
        id: vtProducto === 'nuevo' ? undefined : vtProducto,
        name: document.getElementById('vt-p-nombre').value,
        section: document.getElementById('vt-p-seccion').value,
        price: Number(document.getElementById('vt-p-precio').value),
        description: document.getElementById('vt-p-desc').value,
        active: document.getElementById('vt-p-activo').checked,
        availableDays: [...document.querySelectorAll('input[name="vt-p-dia"]:checked')].map((c) => c.value),
      });
      aviso('Producto guardado');
      vtProducto = null;
      repintarVentas();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  if (e.target.id === 'vt-form-config') {
    e.preventDefault();
    const hours = {};
    const porDia = !document.getElementById('vt-horario-dias').hidden;
    for (const [dia] of DIAS_VT) {
      if (porDia) {
        const abre = document.querySelector('[data-vt-abre-dia="' + dia + '"]').checked;
        hours[dia] = abre
          ? [[document.querySelector('[data-vt-de="' + dia + '"]').value, document.querySelector('[data-vt-a="' + dia + '"]').value]]
          : [];
      } else {
        hours[dia] = document.querySelector('[data-vt-dia-simple="' + dia + '"]').checked
          ? [[document.getElementById('vt-h-de').value, document.getElementById('vt-h-a').value]]
          : [];
      }
    }
    const zones = document.getElementById('vt-c-zonas').value.split(SALTO).map((l) => l.split(','))
      .filter((p) => p[0] && p[0].trim()).map((p) => ({ nombre: p[0].trim(), costo: Number((p[1] ?? '0').trim()) || 0 }));
    try {
      await enviar('ventas/config', {
        ...empresaBody,
        enabled: document.getElementById('vt-c-activo').checked,
        businessType: document.getElementById('vt-c-giro').value,
        pitch: document.getElementById('vt-c-pitch').value,
        timezone: document.getElementById('vt-c-tz').value,
        hours,
        deliveryModes: [...document.querySelectorAll('input[name="vt-entrega"]:checked')].map((c) => c.value),
        zones,
        prepMinutes: Number(document.getElementById('vt-c-prep').value),
        minOrder: Number(document.getElementById('vt-c-min').value),
      });
      aviso('Configuración guardada');
      repintarVentas();
    } catch (err) { aviso(err.message, 'error'); }
  }
});

// ── Facturación: facturas por aprobar y configuración de Factura.com ───

let ftEstado = 'pendientes';
let ftSeries = null; // series que regresó "Probar conexión"
const ESTADO_FACTURA = {
  POR_APROBAR: ['por aprobar', 'warn'], TIMBRANDO: ['timbrando', 'warn'], TIMBRADA: ['timbrada', 'ok'],
  ERROR: ['con error', ''], RECHAZADA: ['rechazada', ''], CANCELADA: ['cancelada', ''],
};
const FORMAS_PAGO_FT = {
  '01': 'Efectivo', '02': 'Cheque', '03': 'Transferencia', '04': 'Tarjeta de crédito', '05': 'Monedero electrónico',
  '06': 'Dinero electrónico', '08': 'Vales de despensa', '28': 'Tarjeta de débito', '29': 'Tarjeta de servicios', '99': 'Por definir',
};
const MOTIVOS_FT = [
  ['02', '02 · Con errores, sin relación'], ['01', '01 · Con errores, la sustituye otra'],
  ['03', '03 · No se llevó a cabo la operación'], ['04', '04 · Va en una factura global'],
];

async function vtFacturas() {
  const [facturas, config] = await Promise.all([api(conEmpresa('facturas?estado=' + ftEstado)), api(conEmpresa('facturas/config'))]);
  const filtros = [['pendientes', 'Por aprobar'], ['timbradas', 'Timbradas'], ['cerradas', 'Rechazadas y canceladas']].map(([v, t]) =>
    '<button class="chip' + (ftEstado === v ? ' activo' : '') + '" data-ft-estado="' + v + '">' + t + '</button>').join('');
  const aviso = !config.enabled
    ? '<p class="alert">La facturación está apagada: el bot no arma facturas. Actívala en la pestaña Facturación.</p>'
    : config.sandbox ? '<p class="alert">Modo prueba (sandbox): lo que se timbra aquí NO tiene validez fiscal.</p>' : '';

  if (!facturas.length) {
    return aviso + '<div class="chips">' + filtros + '</div><p class="vacio">' +
      (ftEstado === 'pendientes' ? 'No hay facturas por aprobar.' : 'Nada por aquí.') + '</p>';
  }

  const tarjeta = (f) => {
    const [estado, clase] = ESTADO_FACTURA[f.status] ?? [f.status, ''];
    const r = f.receptor ?? {};
    const cliente = f.contact?.displayName || numeroBonito(f.contact?.waId ?? '');
    const conceptos = (f.concepts ?? []).map((c) =>
      '<li>' + c.Cantidad + ' × ' + esc(c.Descripcion) + ' <span class="muted small">' + esc(c.ClaveProdServ) + '</span>' +
      '<span class="spacer"></span>' + dinero(Math.round(c.ValorUnitario * c.Cantidad * 100)) + '</li>').join('');

    let acciones = '';
    if (puedeGestionar() && (f.status === 'POR_APROBAR' || f.status === 'ERROR')) {
      acciones = '<div class="vt-acciones">' +
        '<button class="primario" data-ft-aprobar="' + f.id + '">' + (f.status === 'ERROR' ? 'Reintentar timbrado' : 'Aprobar y timbrar') + '</button>' +
        '<input class="vt-motivo" placeholder="Motivo si la rechazas" data-ft-motivo="' + f.id + '">' +
        '<button class="mini peligro" data-ft-rechazar="' + f.id + '">Rechazar</button></div>';
    } else if (puedeGestionar() && f.status === 'TIMBRANDO' && f.error) {
      acciones = '<div class="vt-acciones"><span class="muted small">Factura.com no contestó. Búscala en su panel antes de hacer nada.</span>' +
        '<button class="mini" data-ft-liberar="' + f.id + '">Ya revisé: no se timbró</button></div>';
    } else if (puedeGestionar() && f.status === 'TIMBRADA') {
      acciones = '<div class="vt-acciones">' +
        '<button class="mini" data-ft-reenviar="' + f.id + '">Reenviar al cliente</button>' +
        '<select data-ft-motivo-cancel="' + f.id + '">' + MOTIVOS_FT.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('') + '</select>' +
        '<input class="vt-motivo" placeholder="UUID que la sustituye (solo motivo 01)" data-ft-sustituto="' + f.id + '">' +
        '<button class="mini peligro" data-ft-cancelar="' + f.id + '">Cancelar en el SAT</button></div>';
    }

    return '<article class="card vt-pedido">' +
      '<div class="vt-cabeza"><strong>' + (f.serie || f.folio ? esc((f.serie ?? '') + (f.folio ?? '')) : 'Factura') + '</strong>' +
        '<span class="pill ' + clase + '">' + estado + '</span>' +
        (f.sandbox ? '<span class="pill">prueba</span>' : '') +
        (f.order ? '<span class="pill">P-' + f.order.number + '</span>' : '') +
        '<span class="spacer"></span><span class="muted small">' + fecha(f.stampedAt ?? f.createdAt) + '</span></div>' +
      '<div class="vt-cliente"><strong>' + esc(r.nombre) + '</strong> <span class="mono small">' + esc(r.rfc) + '</span></div>' +
      '<div class="muted small">CP ' + esc(r.codigoPostal) + ' · Régimen ' + esc(r.regimen) + ' · Uso ' + esc(r.usoCfdi) +
        ' · ' + esc(FORMAS_PAGO_FT[f.formaPago] ?? f.formaPago) + (r.email ? ' · ' + esc(r.email) : '') + '</div>' +
      '<div class="muted small">Pidió: ' + esc(cliente) + '</div>' +
      (conceptos ? '<ul class="vt-items">' + conceptos + '</ul>' : '') +
      '<div class="muted small">Subtotal ' + dinero(f.subtotalCents) + ' · IVA ' + dinero(f.ivaCents) + '</div>' +
      '<div class="vt-total">Total <strong>' + dinero(f.totalCents) + '</strong></div>' +
      (f.uuid ? '<div class="muted small mono">UUID ' + esc(f.uuid) + '</div>' : '') +
      (f.error ? '<p class="alert">' + esc(f.error) + '</p>' : '') +
      (f.rejectReason ? '<div class="muted small">Rechazada: ' + esc(f.rejectReason) + '</div>' : '') +
      acciones +
    '</article>';
  };

  return aviso + '<div class="chips">' + filtros + '</div><div class="vt-grid">' + facturas.map(tarjeta).join('') + '</div>';
}

async function vtFacturacion() {
  const c = await api(conEmpresa('facturas/config'));
  const d = puedeGestionar() ? '' : ' disabled';
  const serie = ftSeries
    ? '<label class="campo">Serie<select id="ft-c-serie"' + d + '>' + ftSeries.map((s) =>
        '<option value="' + s.id + '"' + (s.id === c.serieId ? ' selected' : '') + '>' + esc(s.nombre) + (s.activa ? '' : ' (inactiva)') + '</option>').join('') + '</select></label>'
    : '<label class="campo">Serie <span class="muted">(usa "Probar conexión" para elegirla)</span><input id="ft-c-serie" type="number" value="' + (c.serieId ?? '') + '" placeholder="SerieID"' + d + '></label>';

  return '<form id="ft-form-config" class="card alta vt-form">' +
    (c.cifradoDisponible ? '' : '<p class="alert">Falta FACTURACION_SECRET en el servidor, o no tiene 64 caracteres hexadecimales (revísala en Render): sin ella no se pueden guardar las llaves.</p>') +
    '<label class="check vt-activar"><input type="checkbox" id="ft-c-activo"' + (c.enabled ? ' checked' : '') + d + '>' +
      ' <span><strong>Facturar por WhatsApp</strong><small class="muted"> El cliente pide su factura, el bot junta sus datos y aquí la apruebas antes de timbrar.</small></span></label>' +
    '<label class="check"><input type="checkbox" id="ft-c-sandbox"' + (c.sandbox ? ' checked' : '') + d + '> Modo prueba (sandbox de Factura.com, sin validez fiscal)</label>' +
    '<fieldset class="tipo"><legend>Llaves de Factura.com de esta empresa</legend>' +
      '<p class="muted small">Factura.com → Desarrolladores → Datos de acceso, con la empresa seleccionada. ' +
        (c.llavesCapturadas ? 'Ya hay llaves guardadas: déjalas vacías para conservarlas.' : 'Todavía no hay llaves.') + '</p>' +
      '<div class="fila-alta">' +
        '<label class="campo">API Key<input id="ft-c-api" type="password" autocomplete="off" placeholder="' + (c.llavesCapturadas ? '•••••• guardada' : '') + '"' + d + '></label>' +
        '<label class="campo">Secret Key<input id="ft-c-secret" type="password" autocomplete="off" placeholder="' + (c.llavesCapturadas ? '•••••• guardada' : '') + '"' + d + '></label>' +
      '</div>' +
      (puedeGestionar() && c.llavesCapturadas ? '<div class="fila-botones"><button type="button" class="ghost" data-ft-probar>Probar conexión</button></div>' : '') +
    '</fieldset>' +
    '<div class="fila-alta">' + serie +
      '<label class="campo">Correo de la empresa <span class="muted">(Factura.com lo pide si el cliente no da el suyo)</span><input id="ft-c-email" type="email" value="' + escAttr(c.fallbackEmail) + '"' + d + '></label>' +
      '<label class="campo">CP de expedición <span class="muted">(vacío = el de Factura.com)</span><input id="ft-c-cp" maxlength="5" value="' + escAttr(c.lugarExpedicion) + '"' + d + '></label>' +
    '</div>' +
    '<fieldset class="tipo"><legend>Impuestos y claves del SAT</legend>' +
      '<label class="check"><input type="checkbox" id="ft-c-coniva"' + (c.pricesIncludeTax ? ' checked' : '') + d + '> Los precios del catálogo ya incluyen IVA</label>' +
      '<div class="fila-alta">' +
        '<label class="campo">IVA<select id="ft-c-iva"' + d + '>' + [[1600, '16% general'], [800, '8% frontera'], [0, '0% tasa cero']].map(([v, t]) =>
          '<option value="' + v + '"' + (v === c.ivaBasisPoints ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        '<label class="campo">Clave de producto por omisión<input id="ft-c-prod" maxlength="8" value="' + escAttr(c.defaultProdCode) + '"' + d + '></label>' +
        '<label class="campo">Clave de unidad<input id="ft-c-unidad" maxlength="3" value="' + escAttr(c.defaultUnitCode) + '"' + d + '></label>' +
      '</div><div class="fila-alta">' +
        '<label class="campo">Clave del envío<input id="ft-c-envio" maxlength="8" value="' + escAttr(c.deliveryProdCode) + '"' + d + '></label>' +
        '<label class="campo">Días para pedir factura<input id="ft-c-dias" type="number" min="1" max="365" value="' + c.maxDaysAfterSale + '"' + d + '></label>' +
      '</div>' +
      '<small class="muted">01010101 = "No existe en el catálogo" (válida). Pregúntale a tu contador la clave exacta de lo que vendes; H87 = pieza, E48 = servicio.</small>' +
    '</fieldset>' +
    (puedeGestionar() ? '<div class="fila-botones"><button type="submit">Guardar facturación</button></div>' : '') +
  '</form>';
}

const repintarFacturas = () => pintar('ventas', true);

document.addEventListener('click', (e) => {
  const ir = e.target.closest('[data-emp-ir]');
  if (!ir) return;
  if (ir.dataset.empIr === 'ventas') {
    vtEmpresa = ir.dataset.empId;
    try { localStorage.setItem('vt-empresa', vtEmpresa); } catch {}
    vtTab = ir.dataset.empTab || 'pedidos';
    vtProducto = null;
    ftSeries = null;
  }
  pintar(ir.dataset.empIr);
});

document.addEventListener('click', async (e) => {
  const est = e.target.closest('[data-ft-estado]');
  if (est) { ftEstado = est.dataset.ftEstado; return repintarFacturas(); }

  const empresaBody = yo?.role === 'EMPRESA' ? {} : { organizationId: vtEmpresa };
  const accion = async (boton, ruta, cuerpo, ok) => {
    boton.disabled = true;
    try {
      const r = await enviar(ruta, { ...empresaBody, ...cuerpo });
      aviso(typeof ok === 'function' ? ok(r) : ok);
      repintarFacturas();
    } catch (err) { aviso(err.message, 'error'); boton.disabled = false; }
  };

  const probar = e.target.closest('[data-ft-probar]');
  if (probar) {
    probar.disabled = true;
    try {
      ftSeries = await enviar('facturas/probar', empresaBody);
      aviso(ftSeries.length ? 'Conexión correcta: elige la serie' : 'Conexión correcta, pero no hay series de factura: créala en Factura.com');
      repintarFacturas();
    } catch (err) { aviso(err.message, 'error'); probar.disabled = false; }
    return;
  }

  const aprobar = e.target.closest('[data-ft-aprobar]');
  if (aprobar) {
    if (!confirm('¿Timbrar esta factura? Ya timbrada, solo se puede cancelar ante el SAT.')) return;
    return accion(aprobar, 'facturas/aprobar', { id: aprobar.dataset.ftAprobar }, (f) =>
      f.status === 'TIMBRADA' ? 'Factura timbrada y enviada al cliente' : 'No se timbró: ' + (f.error ?? 'revisa el detalle'));
  }

  const rechazar = e.target.closest('[data-ft-rechazar]');
  if (rechazar) {
    const id = rechazar.dataset.ftRechazar;
    const motivo = document.querySelector('[data-ft-motivo="' + id + '"]')?.value ?? '';
    if (!confirm('¿Rechazar esta factura? Se le avisa al cliente con el motivo que escribiste.')) return;
    return accion(rechazar, 'facturas/rechazar', { id, motivo }, 'Factura rechazada; el cliente ya lo sabe');
  }

  const liberar = e.target.closest('[data-ft-liberar]');
  if (liberar) {
    if (!confirm('¿Confirmas que en Factura.com NO aparece timbrada? Si sí aparece, reintentar la duplicaría.')) return;
    return accion(liberar, 'facturas/liberar', { id: liberar.dataset.ftLiberar }, 'Lista para reintentar');
  }

  const reenviar = e.target.closest('[data-ft-reenviar]');
  if (reenviar) return accion(reenviar, 'facturas/reenviar', { id: reenviar.dataset.ftReenviar }, 'Reenviada al cliente');

  const cancelar = e.target.closest('[data-ft-cancelar]');
  if (cancelar) {
    const id = cancelar.dataset.ftCancelar;
    const motivo = document.querySelector('[data-ft-motivo-cancel="' + id + '"]')?.value ?? '02';
    const sustituto = document.querySelector('[data-ft-sustituto="' + id + '"]')?.value ?? '';
    if (!confirm('¿Cancelar esta factura ante el SAT? No se puede deshacer.')) return;
    return accion(cancelar, 'facturas/cancelar', { id, motivo, sustituto }, (r) =>
      r.estado === 'cancelada' ? 'Factura cancelada' : 'Cancelación en proceso: el receptor tiene que aceptarla');
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'ft-form-config') return;
  e.preventDefault();
  const empresaBody = yo?.role === 'EMPRESA' ? {} : { organizationId: vtEmpresa };
  const serie = document.getElementById('ft-c-serie').value;
  try {
    await enviar('facturas/config', {
      ...empresaBody,
      enabled: document.getElementById('ft-c-activo').checked,
      sandbox: document.getElementById('ft-c-sandbox').checked,
      apiKey: document.getElementById('ft-c-api').value,
      secretKey: document.getElementById('ft-c-secret').value,
      serieId: serie ? Number(serie) : null,
      fallbackEmail: document.getElementById('ft-c-email').value,
      lugarExpedicion: document.getElementById('ft-c-cp').value,
      pricesIncludeTax: document.getElementById('ft-c-coniva').checked,
      ivaBasisPoints: Number(document.getElementById('ft-c-iva').value),
      defaultProdCode: document.getElementById('ft-c-prod').value,
      defaultUnitCode: document.getElementById('ft-c-unidad').value,
      deliveryProdCode: document.getElementById('ft-c-envio').value,
      maxDaysAfterSale: Number(document.getElementById('ft-c-dias').value),
    });
    aviso('Facturación guardada');
    repintarFacturas();
  } catch (err) { aviso(err.message, 'error'); }
});

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
                  // Con empresas en su propio número, también se marca el
                  // principal: si no, la misma persona en los dos parecía
                  // un chat duplicado.
                  : Object.keys(nombresDeLinea).length
                    ? ' <span class="pill" title="Llegó al número principal">número principal</span>'
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
    return vistaDirectorio();
  },

  async ventas() {
    return vistaVentas();
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

    const accionesDocs = (o) => {
      if (!esAdmin) return '';
      const cambiar = '<select class="compacto" data-origen="' + o.id + '">' +
        '<option value="DRIVE"' + (o.sourceType === 'DRIVE' ? ' selected' : '') + '>Drive</option>' +
        '<option value="PC"' + (o.sourceType === 'PC' ? ' selected' : '') + '>Computadora</option>' +
        '</select> ';
      return cambiar + (o.sourceType === 'PC'
        ? '<button class="mini" data-codigo-pc="' + o.id + '" data-nombre="' + esc(o.name) + '">Conectar PC</button>'
        : '<button class="mini" data-guardar="' + o.id + '">Guardar</button>');
    };

    /**
     * Un paso de la configuración de la empresa: qué es, cómo está y qué
     * hacer. Así se ve de un vistazo qué le falta a cada una para vender,
     * facturar y atender por WhatsApp.
     */
    const paso = (listo, titulo, estado, detalle, accion) =>
      '<div class="emp-paso' + (listo ? ' listo' : '') + '">' +
        '<div class="emp-paso-cabeza"><span class="emp-paso-marca">' + (listo ? '✓' : '') + '</span><strong>' + titulo + '</strong></div>' +
        '<div class="emp-paso-estado">' + estado + '</div>' +
        (detalle ? '<small class="muted">' + detalle + '</small>' : '') +
        (accion ? '<div class="emp-paso-accion">' + accion + '</div>' : '') +
      '</div>';

    const irA = (o, vista, tab, texto) =>
      '<button class="mini" data-emp-ir="' + vista + '" data-emp-tab="' + (tab ?? '') + '" data-emp-id="' + o.id + '">' + texto + '</button>';

    const tarjeta = (o) => {
      const vende = !!o.sales?.enabled;
      const fact = o.invoicing;
      const facturan = (o.memberships ?? []).length;
      const productos = o._count?.products ?? 0;
      return '<article class="card emp-card">' +
        '<div class="emp-cabeza">' +
          '<div class="emp-nombre"><h3>' + esc(o.name) + (o.active ? '' : ' <span class="pill warn">inactiva</span>') + '</h3>' +
            '<span class="muted small">' + (o.taxId ? esc(o.taxId) + ' · ' : '') + o._count.memberships + ' números · ' +
              o._count.documents + ' documentos · ' + o._count.tickets + ' tickets</span></div>' +
          '<span class="spacer"></span>' +
          (esAdmin ? '<button class="mini" data-accesos="' + o.id + '">Accesos al panel</button>' +
            '<button class="mini peligro" data-borrar-empresa="' + o.id + '" data-nombre="' + esc(o.name) + '" title="Eliminar empresa">Eliminar</button>' : '') +
        '</div>' +
        '<div class="emp-pasos">' +
          paso(!!o.waLineId, 'WhatsApp propio',
            '<span data-estado-wa="' + o.id + '">' + celdaWa(o, null) + '</span>',
            'Su número para vender y facturar. Sin él atiende el número principal.') +
          paso(o.sourceType === 'PC' || !!o.driveFolderId, 'Documentos', origen(o), '', accionesDocs(o)) +
          paso(vende, 'Ventas',
            vende ? '<span class="pill ok">activas</span> <span class="muted small">' + productos + ' productos</span>'
              : '<span class="pill">apagadas</span>' + (productos ? ' <span class="muted small">' + productos + ' productos</span>' : ''),
            vende ? '' : 'Catálogo, horario y entregas.',
            irA(o, 'ventas', vende ? 'pedidos' : 'config', vende ? 'Ver pedidos' : 'Configurar')) +
          paso(!!fact?.enabled, 'Facturación',
            fact?.enabled ? '<span class="pill ok">activa</span>' + (fact.sandbox ? ' <span class="pill warn">modo prueba</span>' : '')
              : '<span class="pill">apagada</span>',
            fact?.enabled ? '' : 'Llaves de Factura.com, serie y claves del SAT.',
            irA(o, 'ventas', 'facturacion', fact?.enabled ? 'Ajustar' : 'Configurar') + (fact?.enabled ? irA(o, 'ventas', 'facturas', 'Ver facturas') : '')) +
          paso(facturan > 0, 'Quién factura por WhatsApp',
            facturan > 0 ? '<strong>' + facturan + '</strong> ' + (facturan === 1 ? 'número puede' : 'números pueden') + ' emitir facturas'
              : '<span class="muted">nadie todavía</span>',
            'Su personal le escribe al bot "factura para…" y se timbra con su "sí".',
            irA(o, 'directorio', '', 'Elegir en Directorio')) +
        '</div>' +
      '</article>';
    };

    // El estado de cada conector se pide después de pintar la tabla: son
    // consultas aparte y no deben frenar la vista.
    setTimeout(() => {
      for (const o of filas.filter((x) => x.sourceType === 'PC')) pintarEstadoPc(o.id);
      for (const o of filas.filter((x) => x.waLineId)) pintarEstadoWa(o.id, o.name);
    }, 0);

    const accesos = esAdmin && accesosEmpresa ? await tarjetaAccesos(filas.find((o) => o.id === accesosEmpresa)) : '';

    return formulario + accesos + '<div id="codigo-pc">' + codigoPcVigente() + '</div>' +
      '<div id="qr-wa">' + qrWaVigente() + '</div>' +
      (filas.length
        ? '<div class="emp-lista">' + filas.map(tarjeta).join('') + '</div>'
        : '<p class="vacio">No hay empresas registradas. Da de alta la primera arriba.</p>');
  },

  async documentos() {
    const empresas = await api('empresas');
    if (!empresas.length) return '<p class="vacio">No hay empresas registradas.</p>';
    if (!empresas.some((o) => o.id === docsEmpresa)) docsEmpresa = empresas[0].id;

    const filas = await api('documentos?empresa=' + encodeURIComponent(docsEmpresa) + '&estado=' + docsEstado);
    const esAdmin = puedeGestionar();

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
      const titularTxt = d.counterpart
        ? 'a nombre de ' + esc(d.counterpart) + (d.holderByOperator ? ' (corregido)' : '')
        : 'sin titular';
      const detalle = [d.folio ? 'folio ' + esc(d.folio) : '', titularTxt, tamano(d.sizeBytes)]
        .filter(Boolean).join(' · ');
      return '<tr>' +
        '<td>' + esc(d.name) + (d.summary ? '<div class="muted small">' + esc(d.summary) + '</div>' : '') + '</td>' +
        '<td class="muted small">' + detalle + '</td>' +
        '<td>' + (d.docClass === 'SENSIBLE'
          ? '<span class="pill warn">sensible</span>'
          : '<span class="pill ' + clase + '">' + estado + '</span>') + '</td>' +
        '<td class="acciones">' + (esAdmin
          ? '<button class="mini" data-titular="' + d.id + '" data-actual="' + escAttr(d.counterpart ?? '') + '">Titular</button>'
          : '') + '</td>' +
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
    const [r, m] = await Promise.all([api('ajustes/limites'), api('ajustes/modelos')]);
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

    const selector = (tarea, etiqueta, ayuda) =>
      '<label>' + etiqueta +
        '<select name="' + tarea + '"' + (esAdmin ? '' : ' disabled') + '>' +
          m.disponibles.map((d) =>
            '<option value="' + d.id + '"' + (m.modelos[tarea] === d.id ? ' selected' : '') + '>' +
              esc(d.nombre) + ' · $' + d.entrada + ' / $' + d.salida + ' USD' +
              (m.defecto[tarea] === d.id ? ' (recomendado)' : '') +
            '</option>').join('') +
        '</select>' +
        '<small class="muted">' + ayuda + '</small>' +
      '</label>';

    const modelos =
      '<form class="card form-alta" id="form-modelos">' +
        '<h3>Modelos de IA</h3>' +
        '<p class="muted small">Precio de lista por millón de tokens (entrada / salida). ' +
          'Entender y redactar pasan en cada mensaje: ahí es donde se nota el gasto. ' +
          'Clasificar pasa una vez por archivo.</p>' +
        '<div class="campos">' +
          selector('conversacion', 'Entender mensajes', 'Saca del mensaje qué documento, mes o folio pide el cliente.') +
          selector('redaccion', 'Redactar respuestas', 'Escribe la respuesta en lenguaje natural.') +
          selector('clasificacion', 'Clasificar archivos', 'Decide si un archivo se puede entregar o es interno o sensible.') +
        '</div>' +
        '<ul class="muted small modelos-ayuda">' +
          m.disponibles.map((d) => '<li><strong>' + esc(d.nombre) + ':</strong> ' + esc(d.descripcion) + '</li>').join('') +
        '</ul>' +
        (esAdmin
          ? '<button type="submit">Guardar modelos</button>'
          : '<p class="muted small">Solo un administrador puede cambiarlos.</p>') +
      '</form>';

    return '<div class="ajustes">' + uso + formulario + modelos + '</div>';
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

  if (e.target.id === 'form-modelos') {
    e.preventDefault();
    const f = e.target;
    const datos = {
      conversacion: f.conversacion.value,
      redaccion: f.redaccion.value,
      clasificacion: f.clasificacion.value,
    };
    try {
      await enviar('ajustes/modelos', datos);
      aviso('Modelos guardados: aplican desde el siguiente mensaje');
      pintar('ajustes');
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

  // Borrar una empresa se lleva todo lo suyo: se pide el nombre escrito,
  // no un clic, para que no pase por accidente.
  const borrarEmpresa = e.target.closest('[data-borrar-empresa]');
  if (borrarEmpresa) {
    const nombre = borrarEmpresa.dataset.nombre;
    const escrito = prompt('Vas a eliminar "' + nombre + '" para siempre: sus números autorizados, documentos indexados, ' +
      'usuarios de panel, catálogo y pedidos. Su WhatsApp propio se desvincula. Los archivos en Drive o en la PC no se tocan.\\n\\n' +
      'Escribe el nombre de la empresa para confirmar:');
    if (escrito === null) return;
    if (escrito.trim() !== nombre.trim()) { aviso('El nombre no coincide: no se eliminó nada', 'error'); return; }
    try {
      await enviar('empresas/borrar', { id: borrarEmpresa.dataset.borrarEmpresa, confirmar: escrito });
      if (vtEmpresa === borrarEmpresa.dataset.borrarEmpresa) vtEmpresa = null;
      aviso('Empresa eliminada');
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

  const titular = e.target.closest('[data-titular]');
  if (titular) {
    const nuevo = prompt('¿A nombre de quién va este documento? Un cliente (VIEWER) solo lo recibe si su nombre completo coincide.', titular.dataset.actual);
    if (nuevo === null) return;
    try {
      await enviar('documentos/titular', { id: titular.dataset.titular, titular: nuevo });
      aviso(nuevo.trim() ? 'Titular guardado' : 'Titular borrado: ningún cliente lo recibirá');
      pintar('documentos');
    } catch (err) { aviso(err.message, 'error'); }
    return;
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
  // Las cifras de la portada son de toda la operación: a una empresa no se
  // le enseñan (el servidor tampoco se las daría).
  if (!yo || yo.role === 'EMPRESA') {
    document.getElementById('resumen').innerHTML = yo
      ? '<span class="muted">' + esc(yo.organizationName ?? '') + '</span>'
      : '';
    return;
  }
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

/** La forma de la vista mientras carga: filas, tarjetas o tabla de mentira. */
function skeletonVista(vista) {
  const linea = (ancho, alto) => '<span class="sk sk-linea" style="width:' + ancho + ';height:' + (alto || 12) + 'px"></span>';
  if (vista === 'bandeja') {
    const fila = (i) => '<div class="fila sk-fila">' +
      '<div class="sk sk-avatar"></div>' +
      '<div class="fila-cuerpo">' +
        '<div class="fila-arriba">' + linea((30 + (i * 13) % 25) + '%', 14) + linea('48px', 10) + '</div>' +
        linea((55 + (i * 17) % 35) + '%') +
        '<div class="fila-pills">' + linea('92px', 18) + linea('64px', 18) + '</div>' +
      '</div></div>';
    return '<div class="barra">' + linea('320px', 40) + '<div class="chips">' + linea('70px', 32) + linea('160px', 32) + linea('120px', 32) + '</div></div>' +
      '<div class="lista">' + [0, 1, 2, 3, 4, 5].map(fila).join('') + '</div>';
  }
  const tarjeta = '<div class="card sk-card">' + linea('40%', 16) + linea('85%') + linea('70%') + linea('55%') + '</div>';
  return '<div class="sk-grid">' + tarjeta + tarjeta + tarjeta + '</div>';
}

async function pintar(vista, silencioso) {
  vistaActual = vista;
  document.getElementById('titulo').textContent = vista === 'bandeja' && yo
    ? 'Hola, ' + String(yo.name ?? '').trim().split(/\\s+/)[0]
    : TITULOS[vista] ?? vista;
  document.querySelectorAll('.nav-items button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === vista));
  if (!silencioso) contenido.innerHTML = skeletonVista(vista);
  try {
    contenido.innerHTML = await VISTAS[vista]();
  } catch (err) {
    contenido.innerHTML = '<p class="alert">No se pudo cargar: ' + esc(err.message) + '</p>';
  }
  document.getElementById('reloj').textContent = 'actualizado ' + hora(new Date().toISOString());
  guardarEstado();
  restaurarBorrador();
}

// ── Recordar dónde estabas y lo que estabas capturando ─────────────────
//
// Al recargar la página, el panel abría siempre en Conversaciones y lo que
// llevabas capturado se perdía. Se guarda en la pestaña (sessionStorage):
// sobrevive a recargar, no a cerrar la pestaña, y no sale del navegador.
// Las contraseñas y llaves de API nunca se guardan.

const ESTADO_KEY = 'panel-estado';
const BORRADOR_KEY = 'panel-borrador';

function leerSesion(clave) {
  try { return JSON.parse(sessionStorage.getItem(clave) ?? 'null') ?? {}; } catch { return {}; }
}
function escribirSesion(clave, valor) {
  try { sessionStorage.setItem(clave, JSON.stringify(valor)); } catch {}
}

function guardarEstado() {
  escribirSesion(ESTADO_KEY, {
    vista: vistaActual, vtTab, ftEstado, filtroBandeja, chat: chatAbierto,
  });
}

/** El borrador es por pantalla: cada pestaña de Ventas y cada empresa por su lado. */
function claveBorrador() {
  return vistaActual + (vistaActual === 'ventas' ? '|' + vtTab + '|' + vtEmpresa + '|' + (vtProducto ?? '') : '');
}

/** Cómo reconocer el mismo campo después de repintar: id, nombre+valor o su data-*. */
function claveCampo(el) {
  if (el.id) return '#' + el.id;
  if (el.name) return 'n:' + el.name + '=' + el.value;
  const dato = [...el.attributes].find((a) => a.name.startsWith('data-'));
  return dato ? 'd:' + dato.name + '=' + dato.value : null;
}

const guardable = (el) => el.closest && el.closest('#contenido') &&
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'password' && el.type !== 'search' && el.type !== 'file';

function guardarCampo(el) {
  const clave = claveCampo(el);
  if (!clave) return;
  const todos = leerSesion(BORRADOR_KEY);
  const pantalla = todos[claveBorrador()] ?? {};
  pantalla[clave] = el.type === 'checkbox' || el.type === 'radio' ? { c: el.checked } : { v: el.value };
  todos[claveBorrador()] = pantalla;
  escribirSesion(BORRADOR_KEY, todos);
}

function restaurarBorrador() {
  const pantalla = leerSesion(BORRADOR_KEY)[claveBorrador()];
  if (!pantalla) return;
  let algo = false;
  document.querySelectorAll('#contenido input, #contenido textarea, #contenido select').forEach((el) => {
    if (!guardable(el) || el.disabled) return;
    const guardado = pantalla[claveCampo(el)];
    if (!guardado) return;
    if ('c' in guardado) el.checked = guardado.c;
    else el.value = guardado.v;
    algo = true;
  });
  if (algo && typeof vtAjustarEntrega === 'function' && document.getElementById('vt-form-config')) vtAjustarEntrega();
}

document.addEventListener('input', (e) => { if (guardable(e.target)) guardarCampo(e.target); });
document.addEventListener('change', (e) => { if (guardable(e.target)) guardarCampo(e.target); });
// Al guardar el formulario, su borrador ya no hace falta.
document.addEventListener('submit', (e) => {
  if (!e.target.closest('#contenido')) return;
  const todos = leerSesion(BORRADOR_KEY);
  delete todos[claveBorrador()];
  escribirSesion(BORRADOR_KEY, todos);
}, true);

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
    document.getElementById('yo-rol').textContent = usuario.role === 'ADMIN'
      ? 'Administrador'
      : usuario.role === 'EMPRESA' ? (usuario.organizationName ?? 'Empresa') : 'Agente';
  }

  if (usuario?.role === 'EMPRESA') {
    document.querySelectorAll('.nav-items button').forEach((b) => {
      b.hidden = !['directorio', 'ventas', 'documentos'].includes(b.dataset.view);
    });
    TITULOS.directorio = 'Clientes';
    document.getElementById('hilo').hidden = true;
    pintarResumen();
    pintar(vistaGuardada(['directorio', 'ventas', 'documentos'], 'directorio'));
    return;
  }

  pintarResumen();
  pintar(vistaGuardada(Object.keys(VISTAS), 'bandeja')).then(() => {
    const chat = leerSesion(ESTADO_KEY).chat;
    if (chat) abrirHilo(chat).catch(() => {});
  });
});

/** La vista donde estabas antes de recargar, si te toca verla. */
function vistaGuardada(permitidas, porOmision) {
  const e = leerSesion(ESTADO_KEY);
  if (e.vtTab) vtTab = e.vtTab;
  if (e.ftEstado) ftEstado = e.ftEstado;
  if (e.filtroBandeja) filtroBandeja = e.filtroBandeja;
  return permitidas.includes(e.vista) ? e.vista : porOmision;
}

// Refresco de la lista cada 20 s, sin recargar debajo de un formulario a
// medio llenar. El hilo abierto tiene su propio refresco más frecuente.
/**
 * ¿Hay algo capturado y sin guardar en la pantalla? Se compara cada campo
 * contra el valor con el que se pintó. Antes solo se respetaba el campo con
 * el cursor: si capturabas y dabas clic fuera, el refresco lo borraba.
 */
function hayCapturaSinGuardar() {
  return [...document.querySelectorAll('#contenido input, #contenido textarea, #contenido select')].some((el) => {
    if (el.type === 'search' || el.disabled) return false;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') {
      // Sin opción marcada en el HTML, el navegador muestra la primera.
      const inicial = Math.max(0, [...el.options].findIndex((o) => o.defaultSelected));
      return el.selectedIndex !== inicial;
    }
    return el.value !== el.defaultValue;
  });
}

setInterval(() => {
  // Ni un formulario a medio llenar ni el buscador mientras se escribe.
  if (document.querySelector('#contenido input:focus, #contenido select:focus, #contenido textarea:focus')) return;
  if (hayCapturaSinGuardar()) return;
  if (directorioOcupado()) return;
  if (ventasOcupado()) return;
  if (vistaActual === 'empresas' && claveNueva) return;
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
  #form-modelos .campos { margin-bottom: 12px; }
  #form-modelos select { width: 100%; }
  .modelos-ayuda { margin: 0 0 16px; padding-left: 18px; }
  .modelos-ayuda li { margin-bottom: 4px; }
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
  .primario {
    background: var(--acento); border: none; color: #fff; padding: 9px 16px; font-family: inherit;
    border-radius: 10px; cursor: pointer; font-size: 13.5px; font-weight: 700;
  }
  .primario:hover { background: var(--acento-fuerte); }
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

  /* Empresas: una tarjeta por empresa con sus pasos de configuración */
  .emp-lista { display: flex; flex-direction: column; gap: 14px; }
  .emp-card { padding: 18px; }
  .emp-cabeza { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .emp-nombre h3 { margin: 0 0 2px; font-size: 17px; }
  .emp-pasos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .emp-paso {
    background: var(--caja2); border: 1px solid var(--borde); border-radius: var(--radio);
    padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0;
  }
  .emp-paso.listo { border-color: rgba(74, 222, 128, .3); }
  .emp-paso-cabeza { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .emp-paso-marca {
    width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center;
    font-size: 11px; font-weight: 800; border: 1.5px solid var(--borde2); color: var(--verde);
  }
  .emp-paso.listo .emp-paso-marca { background: var(--verde-suave); border-color: var(--verde); }
  .emp-paso-estado { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; min-width: 0; }
  .emp-paso-estado input.compacto { max-width: 100%; }
  .emp-paso-accion { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 4px; }
  .meta-texto { font-size: 12px; color: var(--suave); }
  .estado.ok { background: var(--verde-suave); color: var(--verde); }

  /* Ticket anclado dentro del hilo */
  .ticket-ancla {
    align-self: stretch; display: flex; align-items: flex-start; gap: 10px; margin: 6px 0;
    padding: 10px 12px; border-radius: var(--radio); background: var(--ambar-suave);
    border: 1px solid var(--ambar-borde); font-size: 13px;
  }
  .ticket-ancla.cerrado { background: var(--caja2); border-color: var(--borde); opacity: .75; }
  .ticket-ancla-ico { color: var(--ambar); flex-shrink: 0; display: grid; place-items: center; }
  .ticket-ancla.cerrado .ticket-ancla-ico { color: var(--tenue); }
  .ticket-ancla-ico svg { width: 18px; height: 18px; }
  .ticket-ancla-texto { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ticket-ancla-asunto { word-break: break-word; }
  .ticket-ancla.resalta { animation: resalta 1.4s ease; }
  @keyframes resalta { 0%, 40% { box-shadow: 0 0 0 3px var(--ambar-borde); } 100% { box-shadow: none; } }

  /* Skeleton de carga */
  .sk {
    display: block; border-radius: 8px;
    background: linear-gradient(90deg, var(--caja2) 0%, var(--caja3) 50%, var(--caja2) 100%);
    background-size: 200% 100%; animation: sk 1.3s ease-in-out infinite;
  }
  .sk-linea { display: inline-block; height: 12px; }
  .sk-avatar { width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0; }
  .sk-fila { cursor: default; }
  .sk-fila:hover { background: none; }
  .sk-fila .fila-cuerpo { gap: 8px; }
  .sk-burbuja { height: 44px; border-radius: 16px; }
  .sk-burbuja.entra { align-self: flex-start; border-bottom-left-radius: 5px; }
  .sk-burbuja.sale { align-self: flex-end; border-bottom-right-radius: 5px; }
  .sk-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .sk-card { display: flex; flex-direction: column; gap: 10px; padding: 18px; }
  @keyframes sk { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .sk { animation: none; } .ticket-ancla.resalta { animation: none; } }
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
  .burbuja.sale.persona {
    background: linear-gradient(160deg, #1f5c4a, #184a3c); color: #eafff7;
    border: 1px solid rgba(52, 211, 153, .35);
  }
  .burbuja.sale.persona .hora { color: rgba(234, 255, 247, .65); }
  .firma {
    display: block; margin-bottom: 3px; font-size: 10.5px; font-weight: 700;
    letter-spacing: .02em; color: rgba(241, 239, 255, .7);
  }
  .burbuja.sale.persona .firma { color: #6ee7b7; }
  /* ── Directorio: lista + ficha ─────────────────────────────────────── */
  .dir-barra { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
  .dir-buscar {
    flex: 1 1 220px; max-width: 340px; background: var(--caja); border: 1px solid var(--borde);
    border-radius: 10px; padding: 9px 12px; color: var(--texto); font: inherit; font-size: 13.5px;
  }
  .dir-buscar:focus { outline: none; border-color: var(--acento-borde); }
  .dir-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
  .dir-layout.con-ficha { grid-template-columns: minmax(0, 1fr) minmax(340px, 420px); }
  .dir-lista { padding: 6px; }
  .dir-fila {
    display: grid; grid-template-columns: 38px minmax(0, 1fr) 110px minmax(150px, auto); align-items: center;
    gap: 12px; width: 100%; padding: 10px 12px; border: none; border-radius: 10px; background: none;
    color: var(--texto); font: inherit; text-align: left; cursor: pointer;
  }
  .dir-fila + .dir-fila { border-top: 1px solid var(--borde); border-radius: 0; }
  .dir-fila:hover { background: var(--caja2); }
  .dir-fila.activa { background: var(--acento-suave); border-radius: 10px; }
  .dir-avatar {
    width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center;
    background: var(--caja3); font-weight: 800; font-size: 13px; color: var(--texto);
  }
  .dir-avatar.grande { width: 46px; height: 46px; font-size: 15px; flex-shrink: 0; }
  .dir-quien { min-width: 0; display: flex; flex-direction: column; }
  .dir-quien strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dir-quien small { color: var(--suave); font-size: 12px; }
  .dir-rol { color: var(--suave); font-size: 13px; }
  .dir-estado { justify-self: end; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
  .dir-estado.ok { background: var(--verde-suave); color: var(--verde); }
  .dir-estado.warn { background: var(--ambar-suave); color: var(--ambar); }
  .dir-ficha { position: sticky; top: 12px; padding: 18px; display: flex; flex-direction: column; gap: 6px; }
  .dir-ficha h4 {
    margin: 14px 0 4px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--tenue);
  }
  .ficha-head { display: flex; align-items: center; gap: 12px; }
  .accesos { margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
  .accesos-lista { list-style: none; margin: 0; padding: 0; }
  .accesos-lista li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--borde); }
  .accesos-lista .dir-quien { flex: 1; }
  .clave { font-size: 18px; letter-spacing: .04em; user-select: all; }
  .fila-alta { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
  .fila-alta .campo { flex: 1 1 200px; }
  .ficha-quien { flex: 1; min-width: 0; }
  .ficha-quien h3 { margin: 0 0 2px; font-size: 17px; }
  .pasos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .pasos li { display: flex; gap: 10px; }
  .paso-n {
    width: 24px; height: 24px; border-radius: 999px; flex-shrink: 0; display: grid; place-items: center;
    font-size: 12px; font-weight: 800; background: var(--ambar-suave); color: var(--ambar);
  }
  .pasos li.hecho .paso-n { background: var(--verde-suave); color: var(--verde); }
  .paso-cuerpo { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
  .paso-cuerpo strong { font-size: 13.5px; }
  .paso-cuerpo small { font-size: 12.5px; }
  .paso-cuerpo .mini { align-self: flex-start; margin-top: 4px; }
  .permisos-lista { display: flex; flex-wrap: wrap; gap: 6px; }
  .permiso {
    display: inline-flex; flex-direction: row; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 9px;
    border: 1px solid var(--borde); font-size: 13px; color: var(--texto); cursor: pointer;
  }
  .permiso.activo { border-color: var(--acento-borde); background: var(--acento-suave); }
  .atestacion {
    display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 12px;
    border-radius: 10px; background: var(--caja2); border: 1px solid var(--ambar-borde);
  }
  .atestacion p { margin: 0; }
  .campo { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; }
  .campo input, .campo select, .campo textarea {
    background: var(--caja); border: 1px solid var(--borde); border-radius: 9px; padding: 9px 11px;
    color: var(--texto); font: inherit; font-weight: 400; font-size: 13.5px; resize: vertical;
  }
  .campo small { font-weight: 400; }
  .fila-botones { display: flex; gap: 8px; margin-top: 4px; }
  .ficha-pie {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--borde);
  }
  .alta { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; }
  .tipo { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .tipo legend { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .opcion {
    display: flex; flex-direction: row; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px;
    border: 1px solid var(--borde); color: var(--texto); cursor: pointer;
  }
  .opcion:has(input:checked) { border-color: var(--acento-borde); background: var(--acento-suave); }
  .opcion span { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
  @media (max-width: 1100px) {
    .dir-layout.con-ficha { grid-template-columns: minmax(0, 1fr); }
    .dir-ficha { position: static; order: -1; }
  }
  @media (max-width: 640px) {
    .dir-fila { grid-template-columns: 38px minmax(0, 1fr); }
    .dir-rol { display: none; }
    .dir-estado { grid-column: 2; justify-self: start; }
  }
  /* ── Ventas ───────────────────────────────────────────────────────── */
  .vt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; margin-top: 12px; }
  .vt-pedido { display: flex; flex-direction: column; gap: 8px; }
  .vt-cabeza { display: flex; align-items: center; gap: 8px; }
  .vt-cabeza strong { font-size: 16px; white-space: nowrap; }
  .vt-cabeza .muted { white-space: nowrap; }
  .vt-cliente { font-weight: 700; }
  .vt-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; }
  .vt-items li { display: flex; gap: 8px; }
  .vt-total { display: flex; justify-content: space-between; border-top: 1px solid var(--borde); padding-top: 8px; }
  .vt-acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
  .vt-acciones .campo.en-linea { flex-direction: row; align-items: center; gap: 6px; }
  .vt-acciones .campo.en-linea input { width: 72px; }
  .vt-selector { flex-direction: row; align-items: center; gap: 8px; font-weight: 600; }
  .vt-selector select { min-width: 220px; }
  .vt-ficha { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 0; }
  .vt-ficha-nombre { display: flex; flex-direction: column; }
  .vt-ficha-nombre strong { font-size: 18px; }
  .vt-ficha .fila-pills { margin-top: 0; }
  .vt-motivo {
    flex: 1 1 140px; background: var(--caja); border: 1px solid var(--borde); border-radius: 9px;
    padding: 7px 10px; color: var(--texto); font: inherit; font-size: 13px;
  }
  .vt-form { max-width: 860px; }
  .vt-estado { margin: 4px 0 14px; }
  .vt-config { display: flex; flex-direction: column; gap: 14px; }
  .vt-cols { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); align-items: start; }
  .vt-sec { display: flex; flex-direction: column; gap: 12px; padding: 18px; }
  .vt-sec h3 { margin: 0; font-size: 15px; }
  .vt-sec-ancha { grid-column: 1 / -1; }
  .vt-activar-card { display: flex; flex-direction: row; gap: 12px; align-items: flex-start; padding: 16px 18px; cursor: pointer; }
  .vt-activar-card input { margin-top: 3px; }
  .vt-activar-card span, .vt-modo span { display: flex; flex-direction: column; gap: 2px; }
  .vt-dias-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .dia-chip { position: relative; cursor: pointer; }
  .dia-chip input { position: absolute; opacity: 0; pointer-events: none; }
  .dia-chip span {
    display: inline-block; min-width: 46px; text-align: center; padding: 6px 10px; border-radius: 999px;
    border: 1px solid var(--borde2); color: var(--suave); font-size: 13px; font-weight: 700;
  }
  .dia-chip input:checked + span { background: var(--acento-suave); border-color: var(--acento-borde); color: #c9c1ff; }
  .dia-chip input:focus-visible + span { outline: 2px solid var(--acento); outline-offset: 2px; }
  .vt-rango { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; color: var(--suave); }
  .vt-modos { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .vt-modo {
    display: flex; flex-direction: row; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radio);
    border: 1px solid var(--borde); background: var(--caja2); cursor: pointer; font-size: 13px;
  }
  .vt-modo:has(input:checked) { border-color: var(--acento-borde); background: var(--acento-suave); }
  .vt-modo input { margin-top: 2px; }
  button.enlace { background: none; border: none; padding: 0; color: #b3a9ff; font-weight: 600; cursor: pointer; align-self: flex-start; }
  button.enlace:hover { text-decoration: underline; }
  .vt-form h3 { margin: 0; }
  .vt-activar { align-items: flex-start; }
  .vt-activar span { display: flex; flex-direction: column; gap: 2px; }
  .vt-dia { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .vt-dia > span:first-child { width: 90px; color: var(--texto); }
  .vt-dia input[type=time] {
    background: var(--caja); border: 1px solid var(--borde); border-radius: 8px; padding: 6px 8px; color: var(--texto); font: inherit;
  }
  tr.apagado td { opacity: .55; }
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
