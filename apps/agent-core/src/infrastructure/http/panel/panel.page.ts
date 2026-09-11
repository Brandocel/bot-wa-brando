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

export function loginPage(error = false): string {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel · Entrar</title>${STYLES}</head>
<body class="centered">
  <form class="card login" id="form">
    <h1>Panel de operación</h1>
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
<title>Panel de operación</title>${STYLES}</head>
<body>
<div class="app" id="app">

  <!-- Menú lateral -->
  <aside class="nav" id="nav">
    <div class="nav-brand">
      <span class="logo">◔</span>
      <span class="nav-text"><strong>Panel</strong><small>operación</small></span>
      <button class="icon nav-text" id="nav-plegar" title="Plegar menú">‹</button>
    </div>
    <nav class="nav-items">
      <button data-view="bandeja" class="active" title="Conversaciones"><span class="ico">💬</span><span class="nav-text">Conversaciones</span><span class="badge nav-text" id="badge-persona" hidden></span></button>
      <button data-view="tickets" title="Tickets"><span class="ico">🎫</span><span class="nav-text">Tickets</span></button>
      <button data-view="directorio" title="Directorio"><span class="ico">👤</span><span class="nav-text">Directorio</span></button>
      <button data-view="empresas" title="Empresas"><span class="ico">🏢</span><span class="nav-text">Empresas</span></button>
      <button data-view="cuarentena" title="Cuarentena"><span class="ico">📁</span><span class="nav-text">Cuarentena</span><span class="badge nav-text" id="badge-cuarentena" hidden></span></button>
      <button data-view="auditoria" title="Auditoría"><span class="ico">🔍</span><span class="nav-text">Auditoría</span></button>
    </nav>
    <div class="nav-foot">
      <div class="nav-text"><div id="whoami" class="muted small"></div></div>
      <button class="ghost" id="logout" title="Salir"><span class="ico">⏻</span><span class="nav-text">Salir</span></button>
    </div>
  </aside>
  <div id="nav-velo" hidden></div>

  <!-- Centro -->
  <div class="main">
    <header class="top">
      <button class="icon" id="nav-abrir" title="Menú">☰</button>
      <strong id="titulo">Conversaciones</strong>
      <span class="spacer"></span>
      <span class="muted small" id="reloj"></span>
      <button class="icon" id="refrescar" title="Actualizar">↻</button>
    </header>
    <section class="cards" id="resumen"></section>
    <main id="contenido"><p class="muted">Cargando…</p></main>
  </div>

  <!-- Hilo -->
  <aside id="hilo" hidden>
    <div class="hilo-head">
      <button class="icon solo-movil" id="hilo-volver" title="Volver">‹</button>
      <div class="hilo-quien">
        <strong id="hilo-nombre"></strong>
        <div class="muted mono small" id="hilo-numero"></div>
      </div>
      <button class="ghost small" id="hilo-atender"></button>
      <button class="icon no-movil" id="hilo-cerrar" title="Cerrar">×</button>
    </div>
    <div id="hilo-estado" class="hilo-estado"></div>
    <div id="hilo-meta" class="hilo-meta"></div>
    <div id="hilo-tickets" class="hilo-tickets"></div>
    <div id="hilo-mensajes" class="chat"></div>
    <form id="hilo-form" class="hilo-form">
      <textarea id="hilo-texto" rows="1" placeholder="Escribe un mensaje… (Enter envía, Shift+Enter salto)"></textarea>
      <button type="submit" title="Enviar">➤</button>
    </form>
  </aside>
</div>

<script>
const contenido = document.getElementById('contenido');
const app = document.getElementById('app');
let vistaActual = 'bandeja';
let filtroBandeja = 'todas';
let yo = null;
let chatAbierto = null;
let ultimoHilo = null;

const TITULOS = {
  bandeja: 'Conversaciones', tickets: 'Tickets', directorio: 'Directorio',
  empresas: 'Empresas', cuarentena: 'Cuarentena', auditoria: 'Auditoría',
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

const numeroBonito = (waId) => String(waId ?? '').replace(/@.*$/, '');
const iniciales = (nombre) => String(nombre ?? '?').trim().split(/\\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
// Un color por persona, estable: el mismo nombre siempre se ve igual.
const tono = (nombre) => { let h = 0; for (const ch of String(nombre ?? '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

const CATEGORIAS = ['FACTURA', 'CONTRATO', 'COTIZACION', 'REPORTE', 'POLIZA', 'OTRO'];

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

function pintarMensajes(datos) {
  const caja = document.getElementById('hilo-mensajes');
  const abajo = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 40;

  const burbujas = datos.messages.map((m) =>
    '<div class="burbuja ' + (m.direction === 'IN' ? 'entra' : 'sale') + '">' +
      esc(m.body).slice(0, 1200) +
      '<span class="hora">' + hora(m.createdAt) + '</span>' +
    '</div>');

  const pendientes = (datos.pendientes ?? []).map((p) =>
    '<div class="burbuja sale pendiente' + (p.status === 'FAILED' ? ' fallo' : '') + '">' +
      esc(p.body).slice(0, 1200) +
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
    estado.innerHTML = '<span class="pill warn">Lo atiendes tú · el bot no contesta</span>' +
      (datos.handoffUntil ? ' <span class="muted small">hasta ' + hora(datos.handoffUntil) + '</span>' : '');
  } else {
    boton.textContent = 'Atender yo';
    boton.className = 'ghost small';
    const etiqueta = {
      BOT: ['warn', 'sin responder'],
      AGENTE: ['warn', 'espera a una persona'],
      CLIENTE: ['', 'espera al cliente'],
      NADIE: ['ok', 'al día'],
    }[datos.awaiting] ?? ['', datos.awaiting];
    estado.innerHTML = '<span class="pill ' + etiqueta[0] + '">' + etiqueta[1] + '</span>' +
      ' <span class="muted small">el bot atiende</span>';
  }
}

async function abrirHilo(chatId, silencioso) {
  chatAbierto = chatId;
  const datos = await api('conversacion?chatId=' + encodeURIComponent(chatId));
  if (!datos) return;

  document.getElementById('hilo-nombre').textContent =
    datos.contact?.displayName || numeroBonito(datos.contact?.waId) || datos.chatId;
  document.getElementById('hilo-numero').textContent = numeroBonito(datos.contact?.waId || datos.chatId);

  pintarEstadoHilo(datos);

  const membresias = datos.contact?.memberships ?? [];
  document.getElementById('hilo-meta').innerHTML = membresias.length
    ? membresias.map((m) =>
        '<span class="pill">' + esc(m.organization.name) + ' · ' + m.role +
        (m.verifiedAt ? '' : ' · <span class="warn-text">sin verificar</span>') + '</span>',
      ).join(' ')
    : '<span class="pill warn">sin acceso a ninguna empresa</span>';

  const abiertos = datos.tickets.filter((t) => t.state !== 'CERRADO');
  document.getElementById('hilo-tickets').innerHTML = abiertos.length
    ? abiertos.map((t) =>
        '<div class="ticket-mini">' +
          '<span class="pill ' + t.state + '">#' + t.number + '</span> ' +
          '<span class="recorte">' + esc(t.subject) + '</span>' +
          ' <button class="mini" data-cerrar="' + t.id + '">Cerrar</button>' +
        '</div>',
      ).join('')
    : '<span class="muted small">Sin tickets abiertos' +
      (datos.tickets.length ? ' · ' + datos.tickets.length + ' cerrados' : '') + '</span>';

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
  document.getElementById('hilo').hidden = true;
  app.classList.remove('con-hilo');
  document.querySelectorAll('[data-chat].abierta').forEach((el) => el.classList.remove('abierta'));
}

document.getElementById('hilo-cerrar').addEventListener('click', cerrarHilo);
document.getElementById('hilo-volver').addEventListener('click', cerrarHilo);

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
campoTexto.addEventListener('input', () => {
  campoTexto.style.height = 'auto';
  campoTexto.style.height = Math.min(campoTexto.scrollHeight, 140) + 'px';
});

document.getElementById('hilo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = campoTexto.value.trim();
  if (!texto || !chatAbierto) return;

  campoTexto.value = '';
  campoTexto.style.height = 'auto';

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

  const filtro = e.target.closest('[data-filtro]');
  if (filtro) {
    filtroBandeja = filtro.dataset.filtro;
    pintar('bandeja');
    return;
  }

  const fila = e.target.closest('[data-chat]');
  if (fila && fila.dataset.chat) abrirHilo(fila.dataset.chat);
});

// ── Vistas ──────────────────────────────────────────────────────────────

const VISTAS = {
  async bandeja() {
    const consulta = filtroBandeja === 'todas' ? 'bandeja' : 'bandeja?esperando=' + filtroBandeja;
    const filas = await api(consulta);

    const chips = [
      ['todas', 'Todas'], ['persona', 'Esperan a una persona'], ['BOT', 'Sin responder'], ['CLIENTE', 'Esperan al cliente'],
    ].map(([valor, texto]) =>
      '<button class="chip' + (filtroBandeja === valor ? ' activo' : '') + '" data-filtro="' + valor + '">' + texto + '</button>',
    ).join('');

    const lista = filas.length
      ? '<div class="lista">' + filas.map((c) => {
          const nombre = c.contact?.displayName || numeroBonito(c.contact?.waId) || c.chatId;
          const ultimo = c.ultimo
            ? (c.ultimo.direction === 'OUT' ? '↩ ' : '') + c.ultimo.body.replace(/\\s+/g, ' ').slice(0, 90)
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
          return '<div class="fila' + (c.chatId === chatAbierto ? ' abierta' : '') + '" data-chat="' + esc(c.chatId) + '">' +
            '<div class="avatar" style="--h:' + tono(nombre) + '">' + esc(iniciales(nombre)) + '</div>' +
            '<div class="fila-cuerpo">' +
              '<div class="fila-arriba"><strong class="recorte">' + esc(nombre) + '</strong>' +
                '<span class="muted small">' + hace(c.lastInboundAt) + '</span></div>' +
              '<div class="fila-abajo"><span class="muted recorte">' + esc(ultimo) + '</span></div>' +
              '<div class="fila-pills">' + estado +
                (c.topic ? ' <span class="pill">' + esc(c.topic) + '</span>' : '') +
                (c.tickets[0] ? ' <span class="muted small">#' + c.tickets[0].number + '</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>'
      : '<p class="vacio">' + (filtroBandeja === 'todas'
          ? 'Nadie ha escrito en las últimas dos semanas.'
          : 'Nada aquí. Todo atendido.') + '</p>';

    return '<div class="chips">' + chips + '</div>' + lista;
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
          <label>Carpeta de Drive
            <input id="emp-drive" placeholder="1a2B3c4D5e6F7g8H" required>
            <small class="muted">El id que sale en la URL de la carpeta.</small>
          </label>
        </div>
        <button type="submit">Crear empresa</button>
      </form>\` : '';

    const esFalsa = (id) => id.startsWith('drive-folder-');

    return formulario + tabla(
      ['Empresa', 'RFC', 'Carpeta de Drive', 'Números', 'Documentos', 'Tickets', ''],
      filas.map((o) => '<tr>' +
        '<td>' + esc(o.name) + (o.active ? '' : ' <span class="pill warn">inactiva</span>') + '</td>' +
        '<td>' + esc(o.taxId ?? '—') + '</td>' +
        '<td class="mono">' +
          (esAdmin
            ? '<input class="mono compacto" value="' + esc(o.driveFolderId) +
              '" data-carpeta="' + o.id + '">'
            : esc(o.driveFolderId)) +
          (esFalsa(o.driveFolderId) ? ' <span class="pill warn">de prueba</span>' : '') +
        '</td>' +
        '<td>' + o._count.memberships + '</td>' +
        '<td>' + o._count.documents + '</td>' +
        '<td>' + o._count.tickets + '</td>' +
        '<td class="acciones">' + (esAdmin
          ? '<button class="mini" data-guardar="' + o.id + '">Guardar</button>'
          : '') + '</td>' +
      '</tr>'),
      'No hay empresas registradas.',
    );
  },

  async cuarentena() {
    const filas = await api('cuarentena');
    return '<p class="muted">Documentos que Drive tiene y el bot no pudo clasificar. ' +
      'Les falta tipo o mes en el nombre; mientras estén aquí, no se entregan. ' +
      'Formato esperado: <code>FACTURA_2026-02_A1234.pdf</code></p>' +
      tabla(
        ['Archivo', 'Empresa', 'Tipo', 'Indexado'],
        filas.map((d) => '<tr>' +
          '<td>' + esc(d.name) + '</td>' +
          '<td>' + esc(d.organization.name) + '</td>' +
          '<td class="muted">' + esc(d.mimeType) + '</td>' +
          '<td class="muted">' + fecha(d.indexedAt) + '</td>' +
        '</tr>'),
        'Nada en cuarentena.',
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

document.addEventListener('change', (e) => {
  if (e.target.id !== 'rol') return;
  document.getElementById('permisos').hidden = e.target.value !== 'VIEWER';
});

document.addEventListener('submit', async (e) => {
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
      await enviar('empresas', {
        name: document.getElementById('emp-nombre').value,
        taxId: document.getElementById('emp-rfc').value,
        driveFolderId: document.getElementById('emp-drive').value,
      });
      aviso('Empresa creada. Comparte la carpeta con la cuenta de servicio y corre /sync.');
      pintar('empresas');
    } catch (err) { aviso(err.message, 'error'); }
  }
});

document.addEventListener('click', async (e) => {
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

// ── Armazón ─────────────────────────────────────────────────────────────

async function pintarResumen() {
  const r = await api('resumen');
  if (!r) return;

  document.getElementById('resumen').innerHTML = [
    ['Sin responder', r.abiertos, r.abiertos > 0 ? 'warn' : ''],
    ['Esperan a una persona', r.revision, r.revision > 0 ? 'warn' : ''],
    ['Prioridad alta', r.alta, r.alta > 0 ? 'warn' : ''],
    ['Sin clasificar en Drive', r.cuarentena, r.cuarentena > 0 ? 'warn' : ''],
    ['Entregas 24h', r.entregas24h, ''],
    ['Negados 24h', r.denegados24h, ''],
  ].map(([etiqueta, valor, clase]) =>
    '<div class="card metric ' + clase + '"><span>' + etiqueta + '</span><strong>' + valor + '</strong></div>',
  ).join('');

  const bp = document.getElementById('badge-persona');
  bp.textContent = r.revision; bp.hidden = !(r.revision > 0);
  const bc = document.getElementById('badge-cuarentena');
  bc.textContent = r.cuarentena; bc.hidden = !(r.cuarentena > 0);
}

async function pintar(vista, silencioso) {
  vistaActual = vista;
  document.getElementById('titulo').textContent = TITULOS[vista] ?? vista;
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
    document.getElementById('whoami').textContent = usuario.name + ' · ' + usuario.role;
  }
  pintar('bandeja');
});

pintarResumen();

// Refresco de la lista cada 20 s, sin recargar debajo de un formulario a
// medio llenar. El hilo abierto tiene su propio refresco más frecuente.
setInterval(() => {
  if (document.querySelector('.form-alta input:focus')) return;
  pintarResumen();
  pintar(vistaActual, true);
}, 20000);
</script>
</body></html>`;
}

const STYLES = `<style>
  :root {
    color-scheme: dark;
    --fondo: #0f1115;
    --caja: #141821;
    --caja2: #1a1f2a;
    --borde: #232733;
    --texto: #e6e6e6;
    --suave: #8b93a1;
    --azul: #2f6feb;
    --nav: 232px;
    --nav-plegado: 60px;
    --hilo: 420px;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--fondo); color: var(--texto);
    font: 14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif;
  }
  body.centered { min-height: 100vh; display: grid; place-items: center; }
  .muted { color: var(--suave); }
  .small { font-size: 12px; }
  .centro { text-align: center; }
  .warn-text { color: #e8c07d; }
  .ok-text { color: #7ee2a8; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: #1b1f28; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .spacer { flex: 1; }
  .recorte { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .recorte-celda { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
  main { padding: 16px 20px 28px; overflow-y: auto; flex: 1; }
  main > p:first-child { margin-top: 0; }

  /* ── Menú lateral ────────────────────────────────────────────────── */
  .nav {
    background: var(--caja); border-right: 1px solid var(--borde);
    display: flex; flex-direction: column; overflow: hidden; min-width: 0;
  }
  .nav-brand { display: flex; align-items: center; gap: 10px; padding: 14px 12px 12px 16px; border-bottom: 1px solid var(--borde); }
  .logo { font-size: 20px; color: var(--azul); }
  .nav-brand strong { display: block; line-height: 1.1; }
  .nav-brand small { color: var(--suave); font-size: 11px; }
  .nav-brand .nav-text { flex: 1; }
  .nav-items { display: flex; flex-direction: column; gap: 2px; padding: 10px 8px; flex: 1; }
  .nav-items button {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    background: none; border: none; color: var(--suave); cursor: pointer;
    padding: 9px 10px; border-radius: 8px; font-size: 14px; white-space: nowrap;
  }
  .nav-items button:hover { background: var(--caja2); color: var(--texto); }
  .nav-items button.active { background: #1c2a45; color: #fff; }
  .ico { width: 20px; text-align: center; flex-shrink: 0; font-size: 15px; }
  .badge { margin-left: auto; background: #33270f; color: #e8c07d; border-radius: 999px; padding: 0 7px; font-size: 11px; }
  .nav-foot { padding: 10px 8px 12px; border-top: 1px solid var(--borde); display: flex; flex-direction: column; gap: 8px; }
  .nav-foot .nav-text { padding: 0 8px; }
  .nav-foot .ghost { display: flex; align-items: center; gap: 10px; width: 100%; justify-content: flex-start; }
  .plegado .nav-text { display: none !important; }
  .plegado .nav-brand { padding-left: 12px; justify-content: center; }
  .plegado .nav-items button { justify-content: center; padding: 10px 0; }
  .plegado .nav-foot .ghost { justify-content: center; }
  #nav-velo { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 30; }

  /* ── Barra superior y tarjetas ───────────────────────────────────── */
  .top {
    display: flex; align-items: center; gap: 12px; padding: 10px 16px;
    border-bottom: 1px solid var(--borde); background: var(--caja);
  }
  .top strong { font-size: 15px; }
  .icon {
    background: none; border: 1px solid transparent; color: var(--suave); cursor: pointer;
    width: 34px; height: 34px; border-radius: 8px; font-size: 18px; line-height: 1;
  }
  .icon:hover { color: var(--texto); background: var(--caja2); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; padding: 16px 20px 0; }
  .card { background: var(--caja); border: 1px solid var(--borde); border-radius: 10px; padding: 14px 16px; }
  .metric { display: flex; flex-direction: column; gap: 2px; }
  .metric span { color: var(--suave); font-size: 12px; }
  .metric strong { font-size: 24px; font-weight: 600; }
  .metric.warn strong { color: #e8c07d; }

  /* ── Lista de conversaciones ─────────────────────────────────────── */
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .chip {
    background: var(--caja); border: 1px solid var(--borde); color: var(--suave);
    padding: 5px 12px; border-radius: 999px; cursor: pointer; font-size: 13px;
  }
  .chip:hover { color: var(--texto); }
  .chip.activo { background: #1c2a45; border-color: #2a3f6b; color: #fff; }
  .lista { background: var(--caja); border: 1px solid var(--borde); border-radius: 10px; overflow: hidden; }
  .fila { display: flex; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #1e222c; cursor: pointer; }
  .fila:last-child { border-bottom: none; }
  .fila:hover { background: var(--caja2); }
  .fila.abierta { background: #182238; }
  .avatar {
    width: 38px; height: 38px; border-radius: 50%; background: #243250; color: #cfe0ff;
    display: grid; place-items: center; font-size: 13px; font-weight: 600; flex-shrink: 0;
  }
  .fila-cuerpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .fila-arriba, .fila-abajo { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .fila-pills { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 3px; }

  /* ── Tablas ──────────────────────────────────────────────────────── */
  .vacio { color: var(--suave); padding: 32px; text-align: center; background: var(--caja);
           border: 1px dashed var(--borde); border-radius: 10px; }
  .scroll { overflow-x: auto; border: 1px solid var(--borde); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; background: var(--caja); }
  th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid #1e222c; }
  th { color: var(--suave); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  tr:last-child td { border-bottom: none; }
  tr.clic { cursor: pointer; }
  tr.clic:hover td { background: var(--caja2); }
  td.acciones { white-space: nowrap; }

  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; background: #232733; white-space: nowrap; }
  .ABIERTO { background: #123a52; color: #7cc7f0; }
  .EN_REVISION { background: #33270f; color: #e8c07d; }
  .CERRADO { background: #232733; color: var(--suave); }
  .pALTA { background: #3d1a1a; color: #f0a0a0; }
  .pMEDIA { background: #232733; color: #c5cbd6; }
  .pBAJA { background: #1b1f28; color: var(--suave); }
  .ok { background: #10331d; color: #7ee2a8; }
  .warn { background: #33270f; color: #e8c07d; }

  /* ── Formularios ─────────────────────────────────────────────────── */
  .form-alta { margin-bottom: 20px; }
  .form-alta h3 { margin: 0 0 14px; font-size: 15px; }
  .campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--suave); }
  input, select, textarea {
    background: var(--fondo); border: 1px solid #2b3040; border-radius: 8px;
    padding: 9px 10px; color: var(--texto); font-size: 14px; font-family: inherit;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--azul); }
  .compacto { padding: 4px 7px; font-size: 12px; width: 240px; }
  .permisos { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin: 14px 0; font-size: 13px; }
  .check { flex-direction: row; align-items: center; gap: 6px; color: var(--texto); }
  button[type=submit] {
    background: var(--azul); border: none; color: #fff; padding: 10px 18px;
    border-radius: 8px; cursor: pointer; font-size: 14px;
  }
  .ghost { background: none; border: 1px solid #2b3040; color: var(--suave);
           padding: 6px 12px; border-radius: 8px; cursor: pointer; }
  .ghost:hover { color: var(--texto); }
  .ghost.small { padding: 4px 10px; font-size: 12px; white-space: nowrap; }
  .ghost.activo { border-color: #6b5320; color: #e8c07d; }
  .mini { background: none; border: 1px solid #2b3040; color: var(--suave);
          padding: 3px 9px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .mini:hover { color: var(--texto); }
  .mini.peligro:hover { border-color: #6b2b2b; color: #f0a0a0; }

  /* ── Hilo ────────────────────────────────────────────────────────── */
  #hilo {
    background: var(--caja); border-left: 1px solid var(--borde);
    display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  }
  .hilo-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--borde); }
  .hilo-quien { flex: 1; min-width: 0; }
  .hilo-quien strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hilo-estado { padding: 8px 14px; border-bottom: 1px solid var(--borde); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .hilo-meta { padding: 8px 14px; display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--borde); }
  .hilo-tickets { padding: 8px 14px; border-bottom: 1px solid var(--borde); max-height: 120px; overflow-y: auto; }
  .ticket-mini { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 13px; }
  .ticket-mini .recorte { flex: 1; }
  .chat { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; background: var(--fondo); }
  .burbuja {
    max-width: 84%; padding: 8px 11px; border-radius: 10px; font-size: 13px;
    white-space: pre-wrap; word-break: break-word; position: relative;
  }
  .burbuja.entra { background: #1e222c; align-self: flex-start; border-bottom-left-radius: 3px; }
  .burbuja.sale { background: #14452f; align-self: flex-end; border-bottom-right-radius: 3px; }
  .burbuja.pendiente { opacity: .6; }
  .burbuja.fallo { opacity: 1; background: #3d1a1a; }
  .hora { display: block; font-size: 10px; color: var(--suave); margin-top: 3px; text-align: right; }
  .hilo-form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--borde); align-items: flex-end; }
  .hilo-form textarea { flex: 1; resize: none; max-height: 140px; line-height: 1.4; }
  .hilo-form button { padding: 9px 14px; }
  .solo-movil { display: none; }

  /* ── Avisos ──────────────────────────────────────────────────────── */
  .toast {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: #1e222c; border: 1px solid var(--borde); color: var(--texto);
    padding: 11px 18px; border-radius: 10px; z-index: 50; font-size: 13px;
    box-shadow: 0 8px 24px rgba(0,0,0,.4); max-width: 90vw;
  }
  .toast.error { background: #3d1a1a; border-color: #6b2b2b; color: #f0a0a0; }
  .login { display: flex; flex-direction: column; gap: 14px; width: min(320px, 92vw); }
  .login h1 { font-size: 17px; margin: 0; }
  .alert { background: #3d1a1a; color: #f0a0a0; padding: 10px 12px; border-radius: 8px; font-size: 13px; }

  /* ── Pantallas medianas: el hilo se superpone en vez de partir ───── */
  @media (max-width: 1180px) {
    .app.con-hilo, .app.plegado.con-hilo { grid-template-columns: var(--nav) 1fr 0; }
    .app.plegado.con-hilo { grid-template-columns: var(--nav-plegado) 1fr 0; }
    #hilo { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); z-index: 20;
            box-shadow: -12px 0 32px rgba(0,0,0,.45); }
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
    .plegado .nav-items button { justify-content: flex-start; padding: 9px 10px; }
    #nav-plegar { display: none; }
    #hilo { width: 100vw; }
    .solo-movil { display: inline-block; }
    .no-movil { display: none; }
    .cards { grid-template-columns: repeat(2, 1fr); padding: 12px 12px 0; gap: 8px; }
    .metric strong { font-size: 20px; }
    main { padding: 12px 12px 24px; }
    .fila-abajo .recorte { max-width: 100%; }
    th, td { padding: 9px 10px; }
  }
</style>`;
