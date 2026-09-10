/**
 * La página del panel, como una cadena.
 *
 * Sin build de frontend, sin framework, sin assets: un HTML que se sirve
 * desde memoria y habla con /panel/api. La alternativa era montar un
 * proyecto aparte con su despliegue, su pipeline y su versión que se
 * desincroniza de la API — para pintar unas tablas y tres formularios.
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
<header>
  <strong>Panel de operación</strong>
  <span class="spacer"></span>
  <span id="whoami" class="muted"></span>
  <button class="ghost" id="logout">Salir</button>
</header>

<section class="cards" id="resumen"></section>

<nav class="tabs">
  <button data-view="bandeja" class="active">Conversaciones</button>
  <button data-view="tickets">Tickets</button>
  <button data-view="directorio">Directorio</button>
  <button data-view="empresas">Empresas</button>
  <button data-view="cuarentena">Cuarentena</button>
  <button data-view="auditoria">Auditoría</button>
</nav>

<main id="contenido"><p class="muted">Cargando…</p></main>

<!-- Panel lateral del hilo. Fuera del flujo: abrir una conversación no debe
     perder la lista que estabas mirando. -->
<aside id="hilo" hidden>
  <div class="hilo-head">
    <div>
      <strong id="hilo-nombre"></strong>
      <div class="muted mono" id="hilo-numero"></div>
    </div>
    <button class="ghost" id="hilo-cerrar">Cerrar</button>
  </div>
  <div id="hilo-meta" class="hilo-meta"></div>
  <div id="hilo-tickets" class="hilo-tickets"></div>
  <div id="hilo-mensajes" class="chat"></div>
  <form id="hilo-form" class="hilo-form">
    <input id="hilo-texto" placeholder="Escribe un mensaje…" autocomplete="off">
    <button type="submit">Enviar</button>
  </form>
</aside>
<div id="velo" hidden></div>

<script>
const contenido = document.getElementById('contenido');
let vistaActual = 'bandeja';
let yo = null;
let chatAbierto = null;

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

const mes = (iso) => iso ? String(iso).slice(0, 7) : '—';

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

// ── Hilo de conversación ────────────────────────────────────────────────

async function abrirHilo(chatId) {
  chatAbierto = chatId;
  const datos = await api('conversacion?chatId=' + encodeURIComponent(chatId));
  if (!datos) return;

  document.getElementById('hilo-nombre').textContent =
    datos.contact?.displayName || datos.contact?.waId || datos.chatId;
  document.getElementById('hilo-numero').textContent = datos.contact?.waId || datos.chatId;

  const membresias = datos.contact?.memberships ?? [];
  document.getElementById('hilo-meta').innerHTML = membresias.length
    ? membresias.map((m) =>
        '<span class="pill">' + esc(m.organization.name) + ' · ' + m.role +
        (m.verifiedAt ? '' : ' · <span class="warn-text">sin verificar</span>') + '</span>',
      ).join(' ')
    : '<span class="pill warn">sin acceso a ninguna empresa</span>';

  document.getElementById('hilo-tickets').innerHTML = datos.tickets.length
    ? datos.tickets.map((t) =>
        '<div class="ticket-mini">' +
          '<span class="pill ' + t.state + '">#' + t.number + ' ' + t.state + '</span> ' +
          esc(t.subject) +
          (t.state !== 'CERRADO'
            ? ' <button class="mini" data-cerrar="' + t.id + '">Cerrar</button>'
            : '') +
        '</div>',
      ).join('')
    : '<p class="muted">Sin tickets.</p>';

  document.getElementById('hilo-mensajes').innerHTML = datos.messages.map((m) =>
    '<div class="burbuja ' + (m.direction === 'IN' ? 'entra' : 'sale') + '">' +
      esc(m.body).slice(0, 800) +
      '<span class="hora">' + hora(m.createdAt) + '</span>' +
    '</div>',
  ).join('');

  document.getElementById('hilo').hidden = false;
  document.getElementById('velo').hidden = false;

  // Al final del hilo: lo último es lo que importa.
  const caja = document.getElementById('hilo-mensajes');
  caja.scrollTop = caja.scrollHeight;
}

function cerrarHilo() {
  chatAbierto = null;
  document.getElementById('hilo').hidden = true;
  document.getElementById('velo').hidden = true;
}

document.getElementById('hilo-cerrar').addEventListener('click', cerrarHilo);
document.getElementById('velo').addEventListener('click', cerrarHilo);

document.getElementById('hilo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const campo = document.getElementById('hilo-texto');
  const texto = campo.value.trim();
  if (!texto || !chatAbierto) return;

  campo.value = '';
  try {
    await enviar('mensaje', { chatId: chatAbierto, text: texto });
    aviso('Mensaje encolado');
    await abrirHilo(chatAbierto);
  } catch (err) {
    aviso(err.message, 'error');
    campo.value = texto;
  }
});

document.addEventListener('click', async (e) => {
  const cerrar = e.target.closest('[data-cerrar]');
  if (cerrar) {
    try {
      await enviar('ticket/cerrar', { id: cerrar.dataset.cerrar });
      aviso('Ticket cerrado');
      if (chatAbierto) await abrirHilo(chatAbierto);
      pintarResumen();
    } catch (err) { aviso(err.message, 'error'); }
    return;
  }

  const fila = e.target.closest('[data-chat]');
  if (fila) abrirHilo(fila.dataset.chat);
});

// ── Vistas ──────────────────────────────────────────────────────────────

const VISTAS = {
  async bandeja() {
    const filas = await api('bandeja');
    return '<p class="muted">Lo que espera por nosotros, lo más antiguo primero. ' +
      'Haz clic en una fila para abrir la conversación.</p>' +
      tabla(
        ['Espera desde', 'Contacto', 'Tema', 'Situación', 'Ticket', 'Visto'],
        filas.map((c) => '<tr class="clic" data-chat="' + esc(c.chatId) + '">' +
          '<td><strong>' + esc(c.esperando) + '</strong></td>' +
          '<td>' + esc(c.contact?.displayName ?? c.contact?.waId ?? c.chatId) + '</td>' +
          '<td>' + (c.topic
            ? '<span class="pill">' + esc(c.topic) + '</span>'
            : '<span class="muted">sin clasificar</span>') + '</td>' +
          '<td><span class="pill ' + (c.awaiting === 'AGENTE' ? 'warn' : 'ABIERTO') + '">' +
            (c.awaiting === 'AGENTE' ? 'espera a una persona' : 'sin responder') + '</span></td>' +
          '<td>' + (c.tickets[0] ? '#' + c.tickets[0].number : '—') + '</td>' +
          '<td class="muted">' + (c.seenAt ? 'leído' : 'sin leer') + '</td>' +
        '</tr>'),
        'Nada pendiente. Todo contestado.',
      );
  },

  async tickets() {
    const filas = await api('tickets');
    return tabla(
      ['Folio', 'Asunto', 'Estado', 'Prioridad', 'Empresa', 'Contacto', 'Creado'],
      filas.map((t) => '<tr class="clic" data-chat="' + esc(t.contact?.waId ?? '') + '">' +
        '<td>#' + t.number + '</td>' +
        '<td>' + esc(t.subject) + '</td>' +
        '<td><span class="pill ' + t.state + '">' + t.state.replace('_', ' ') + '</span>' +
          (t.level > 0 ? ' <span class="muted">nivel ' + t.level + '</span>' : '') + '</td>' +
        '<td><span class="pill p' + t.priority + '">' + t.priority + '</span></td>' +
        '<td>' + esc(t.organization?.name ?? '—') + '</td>' +
        '<td class="mono muted">' + esc(t.contact?.waId ?? '') + '</td>' +
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
        '<td class="mono">' + esc(m.contact.waId.replace('@c.us', '')) + '</td>' +
        '<td>' + esc(m.contact.displayName ?? '—') + '</td>' +
        '<td>' + esc(m.organization.name) + '</td>' +
        '<td>' + m.role + '</td>' +
        '<td>' + (m.verifiedAt
          ? '<span class="pill ok">sí</span>'
          : '<span class="pill warn">no</span>') + '</td>' +
        '<td>' + (m.role === 'VIEWER'
          ? (m.grants.map((g) => esc(g.category)).join(', ') || '<span class="muted">nada</span>')
          : '<span class="muted">todo lo de su empresa</span>') + '</td>' +
        '<td>' + (esAdmin
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

    return formulario + tabla(
      ['Empresa', 'RFC', 'Carpeta de Drive', 'Números', 'Documentos', 'Tickets'],
      filas.map((o) => '<tr>' +
        '<td>' + esc(o.name) + (o.active ? '' : ' <span class="pill warn">inactiva</span>') + '</td>' +
        '<td>' + esc(o.taxId ?? '—') + '</td>' +
        '<td class="mono muted">' + esc(o.driveFolderId) + '</td>' +
        '<td>' + o._count.memberships + '</td>' +
        '<td>' + o._count.documents + '</td>' +
        '<td>' + o._count.tickets + '</td>' +
      '</tr>'),
      'No hay empresas registradas.',
    );
  },

  async cuarentena() {
    const filas = await api('cuarentena');
    return '<p class="muted">Documentos que Drive tiene y el bot no pudo clasificar. ' +
      'Les falta categoría o periodo en el nombre; mientras estén aquí, no se entregan. ' +
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
          '<td class="mono">' + esc(a.waId.replace('@c.us', '')) + '</td>' +
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

/**
 * La vista previa del número se pide al servidor con un respiro de 400 ms.
 * Sin ese respiro, cada tecla dispara una consulta a WhatsApp.
 */
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
  // MANAGER y ADMIN ven todo lo de su empresa: marcar categorías ahí solo
  // confunde a quien lea el directorio después.
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
    ['Sin responder', r.abiertos, ''],
    ['Esperan a una persona', r.revision, r.revision > 0 ? 'warn' : ''],
    ['Prioridad alta', r.alta, r.alta > 0 ? 'warn' : ''],
    ['Sin clasificar en Drive', r.cuarentena, r.cuarentena > 0 ? 'warn' : ''],
    ['Entregas 24h', r.entregas24h, ''],
    ['Negados 24h', r.denegados24h, ''],
  ].map(([etiqueta, valor, clase]) =>
    '<div class="card metric ' + clase + '"><span>' + etiqueta + '</span><strong>' + valor + '</strong></div>',
  ).join('');
}

async function pintar(vista) {
  vistaActual = vista;
  contenido.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    contenido.innerHTML = await VISTAS[vista]();
  } catch (err) {
    contenido.innerHTML = '<p class="alert">No se pudo cargar: ' + esc(err.message) + '</p>';
  }
}

document.querySelectorAll('.tabs button').forEach((boton) => {
  boton.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    boton.classList.add('active');
    pintar(boton.dataset.view);
  });
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

// Refresco periódico. 30 segundos: esto es una consola de operación, no un
// tablero en vivo. No refresca con el hilo abierto ni con un formulario a
// medio llenar: recargar debajo de las manos del operador es peor que un
// dato con medio minuto de retraso.
setInterval(() => {
  if (chatAbierto) return;
  if (document.querySelector('.form-alta input:focus')) return;
  pintarResumen();
  pintar(vistaActual);
}, 30000);
</script>
</body></html>`;
}

const STYLES = `<style>
  :root {
    color-scheme: dark;
    --fondo: #0f1115;
    --caja: #141821;
    --borde: #232733;
    --texto: #e6e6e6;
    --suave: #8b93a1;
    --azul: #2f6feb;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body {
    margin: 0; background: var(--fondo); color: var(--texto);
    font: 14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif;
  }
  body.centered { min-height: 100vh; display: grid; place-items: center; }
  header {
    display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 5;
    padding: 14px 20px; border-bottom: 1px solid var(--borde); background: var(--caja);
  }
  .spacer { flex: 1; }
  .muted { color: var(--suave); }
  .warn-text { color: #e8c07d; }
  .ok-text { color: #7ee2a8; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: #1b1f28; padding: 1px 5px; border-radius: 4px; font-size: 12px; }

  .cards { display: flex; gap: 12px; padding: 20px 20px 0; flex-wrap: wrap; }
  .card { background: var(--caja); border: 1px solid var(--borde); border-radius: 10px; padding: 16px; }
  .metric { min-width: 150px; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .metric span { color: var(--suave); font-size: 12px; }
  .metric strong { font-size: 26px; font-weight: 600; }
  .metric.warn strong { color: #e8c07d; }

  .tabs { display: flex; gap: 4px; padding: 16px 20px 0; flex-wrap: wrap; border-bottom: 1px solid var(--borde); }
  .tabs button {
    background: none; border: none; color: var(--suave); cursor: pointer;
    padding: 9px 14px; border-radius: 8px 8px 0 0; font-size: 14px;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tabs button:hover { color: var(--texto); }
  .tabs button.active { color: var(--texto); border-bottom-color: var(--azul); }

  main { padding: 20px; }
  main > p:first-child { margin-top: 0; }
  .vacio { color: var(--suave); padding: 32px; text-align: center; background: var(--caja);
           border: 1px dashed var(--borde); border-radius: 10px; }

  .scroll { overflow-x: auto; border: 1px solid var(--borde); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; background: var(--caja); }
  th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid #1e222c; }
  th { color: var(--suave); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  tr:last-child td { border-bottom: none; }
  tr.clic { cursor: pointer; }
  tr.clic:hover td { background: #1a1f2a; }

  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; background: #232733; }
  .ABIERTO { background: #123a52; color: #7cc7f0; }
  .EN_REVISION { background: #33270f; color: #e8c07d; }
  .CERRADO { background: #232733; color: var(--suave); }
  .pALTA { background: #3d1a1a; color: #f0a0a0; }
  .pMEDIA { background: #232733; color: #c5cbd6; }
  .pBAJA { background: #1b1f28; color: var(--suave); }
  .ok { background: #10331d; color: #7ee2a8; }
  .warn { background: #33270f; color: #e8c07d; }

  .form-alta { margin-bottom: 20px; }
  .form-alta h3 { margin: 0 0 14px; font-size: 15px; }
  .campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--suave); }
  input, select {
    background: var(--fondo); border: 1px solid #2b3040; border-radius: 8px;
    padding: 9px 10px; color: var(--texto); font-size: 14px; font-family: inherit;
  }
  input:focus, select:focus { outline: none; border-color: var(--azul); }
  .permisos { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin: 14px 0; font-size: 13px; }
  .check { flex-direction: row; align-items: center; gap: 6px; color: var(--texto); }
  button[type=submit] {
    background: var(--azul); border: none; color: #fff; padding: 10px 18px;
    border-radius: 8px; cursor: pointer; font-size: 14px;
  }
  .ghost { background: none; border: 1px solid #2b3040; color: var(--suave);
           padding: 6px 12px; border-radius: 8px; cursor: pointer; }
  .mini { background: none; border: 1px solid #2b3040; color: var(--suave);
          padding: 3px 9px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .mini:hover { color: var(--texto); }
  .mini.peligro:hover { border-color: #6b2b2b; color: #f0a0a0; }

  /* Hilo lateral */
  #velo { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 8; }
  #hilo {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); z-index: 9;
    background: var(--caja); border-left: 1px solid var(--borde);
    display: flex; flex-direction: column;
  }
  .hilo-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px;
               border-bottom: 1px solid var(--borde); }
  .hilo-head strong { display: block; }
  .hilo-head > div:first-child { flex: 1; }
  .hilo-meta { padding: 12px 16px; display: flex; gap: 6px; flex-wrap: wrap;
               border-bottom: 1px solid var(--borde); }
  .hilo-tickets { padding: 12px 16px; border-bottom: 1px solid var(--borde); max-height: 140px; overflow-y: auto; }
  .ticket-mini { margin-bottom: 6px; font-size: 13px; }
  .chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .burbuja {
    max-width: 82%; padding: 8px 11px; border-radius: 10px; font-size: 13px;
    white-space: pre-wrap; word-break: break-word; position: relative;
  }
  .burbuja.entra { background: #1e222c; align-self: flex-start; }
  .burbuja.sale { background: #14452f; align-self: flex-end; }
  .hora { display: block; font-size: 10px; color: var(--suave); margin-top: 3px; text-align: right; }
  .hilo-form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--borde); }
  .hilo-form input { flex: 1; }

  .toast {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: #1e222c; border: 1px solid var(--borde); color: var(--texto);
    padding: 11px 18px; border-radius: 10px; z-index: 20; font-size: 13px;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
  }
  .toast.error { background: #3d1a1a; border-color: #6b2b2b; color: #f0a0a0; }

  .login { display: flex; flex-direction: column; gap: 14px; width: 320px; }
  .login h1 { font-size: 17px; margin: 0; }
  .alert { background: #3d1a1a; color: #f0a0a0; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
</style>`;
