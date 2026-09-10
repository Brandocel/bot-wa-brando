/**
 * La página del panel, como una cadena.
 *
 * Sin build de frontend, sin framework, sin assets: un HTML que se sirve
 * desde memoria y habla con /panel/api. La alternativa era montar un
 * proyecto de React aparte con su despliegue, su pipeline y su versión que
 * se desincroniza de la API — todo para pintar seis tablas.
 *
 * Cuando el panel crezca a edición y necesite formularios de verdad, ese es
 * el momento de separarlo. Hoy no lo es.
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
    body: JSON.stringify({
      email: form.email.value,
      password: form.password.value,
    }),
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
  <button data-view="tickets" class="active">Tickets</button>
  <button data-view="numeros">Números</button>
  <button data-view="empresas">Empresas</button>
  <button data-view="cuarentena">Cuarentena</button>
  <button data-view="auditoria">Auditoría</button>
  <button data-view="mensajes">Mensajes</button>
</nav>

<main id="contenido"><p class="muted">Cargando…</p></main>

<script>
const contenido = document.getElementById('contenido');
let vistaActual = 'tickets';

const api = async (ruta) => {
  const res = await fetch('/panel/api/' + ruta);
  if (res.status === 401) { location.href = '/panel/login'; return null; }
  return res.json();
};

const esc = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fecha = (iso) => iso
  ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

const mes = (iso) => iso ? String(iso).slice(0, 7) : '—';

function tabla(columnas, filas, vacio) {
  if (!filas || filas.length === 0) return '<p class="muted">' + vacio + '</p>';
  return '<div class="scroll"><table><thead><tr>' +
    columnas.map((c) => '<th>' + c + '</th>').join('') +
    '</tr></thead><tbody>' + filas.join('') + '</tbody></table></div>';
}

const VISTAS = {
  async tickets() {
    const filas = await api('tickets');
    return tabla(
      ['Folio', 'Asunto', 'Estado', 'Prioridad', 'Empresa', 'Número', 'Creado'],
      filas.map((t) => '<tr>' +
        '<td>#' + t.number + '</td>' +
        '<td>' + esc(t.subject) + '</td>' +
        '<td><span class="pill ' + t.state + '">' + t.state + '</span>' +
          (t.level > 0 ? ' <span class="muted">N' + t.level + '</span>' : '') + '</td>' +
        '<td><span class="pill p' + t.priority + '">' + t.priority + '</span></td>' +
        '<td>' + esc(t.organization?.name ?? '—') + '</td>' +
        '<td>' + esc(t.contact?.waId ?? '') + '</td>' +
        '<td class="muted">' + fecha(t.createdAt) + '</td>' +
      '</tr>'),
      'No hay tickets.',
    );
  },

  async numeros() {
    const filas = await api('numeros');
    return tabla(
      ['Número', 'Nombre', 'Empresa', 'Rol', 'Verificado', 'Puede ver'],
      filas.map((m) => '<tr>' +
        '<td>' + esc(m.contact.waId) + '</td>' +
        '<td>' + esc(m.contact.displayName ?? '—') + '</td>' +
        '<td>' + esc(m.organization.name) + '</td>' +
        '<td>' + m.role + '</td>' +
        '<td>' + (m.verifiedAt
          ? '<span class="pill ok">sí</span>'
          : '<span class="pill warn">no</span>') + '</td>' +
        '<td>' + (m.role === 'VIEWER'
          ? (m.grants.map((g) => esc(g.category) +
              (g.periodFrom || g.periodTo
                ? ' (' + mes(g.periodFrom) + '→' + mes(g.periodTo) + ')'
                : '')).join(', ') || '<span class="muted">nada</span>')
          : '<span class="muted">todo lo de su empresa</span>') + '</td>' +
      '</tr>'),
      'No hay números autorizados.',
    );
  },

  async empresas() {
    const filas = await api('empresas');
    return tabla(
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
      'Les falta categoría o periodo en el nombre; mientras estén aquí, no se entregan.</p>' +
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
      'Al usuario siempre se le responde "no encontré"; el motivo real está aquí.</p>' +
      tabla(
        ['Cuándo', 'Número', 'Consulta', 'Decisión', 'Regla'],
        filas.map((a) => '<tr>' +
          '<td class="muted">' + fecha(a.createdAt) + '</td>' +
          '<td>' + esc(a.waId) + '</td>' +
          '<td>' + esc(a.query) + '</td>' +
          '<td><span class="pill ' + (a.decision === 'ALLOW' ? 'ok' : 'warn') + '">' +
            esc(a.decision) + '</span></td>' +
          '<td class="muted">' + esc(a.decidedBy) + '</td>' +
        '</tr>'),
        'Sin registros.',
      );
  },

  async mensajes() {
    const filas = await api('mensajes');
    return tabla(
      ['Cuándo', 'Dirección', 'Contacto', 'Mensaje'],
      filas.map((m) => '<tr>' +
        '<td class="muted">' + fecha(m.createdAt) + '</td>' +
        '<td>' + (m.direction === 'IN' ? '↓ entra' : '↑ sale') + '</td>' +
        '<td>' + esc(m.conversation?.contact?.displayName ?? m.conversation?.chatId ?? '') + '</td>' +
        '<td>' + esc(m.body).slice(0, 160) + '</td>' +
      '</tr>'),
      'Sin mensajes.',
    );
  },
};

async function pintarResumen() {
  const r = await api('resumen');
  if (!r) return;

  document.getElementById('resumen').innerHTML = [
    ['Abiertos', r.abiertos, ''],
    ['En revisión', r.revision, r.revision > 0 ? 'warn' : ''],
    ['Prioridad alta', r.alta, r.alta > 0 ? 'warn' : ''],
    ['En cuarentena', r.cuarentena, r.cuarentena > 0 ? 'warn' : ''],
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
  if (usuario) {
    document.getElementById('whoami').textContent = usuario.name + ' · ' + usuario.role;
  }
});

pintarResumen();
pintar('tickets');

// Refresco periódico. 30 segundos: esto es una consola de operación, no un
// tablero en vivo, y cada pasada son siete consultas a Postgres.
setInterval(() => { pintarResumen(); pintar(vistaActual); }, 30000);
</script>
</body></html>`;
}

const STYLES = `<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0f1115; color: #e6e6e6;
    font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif;
  }
  body.centered { min-height: 100vh; display: grid; place-items: center; }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 20px; border-bottom: 1px solid #232733; background: #141821;
  }
  .spacer { flex: 1; }
  .muted { color: #8b93a1; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }

  .cards { display: flex; gap: 12px; padding: 20px; flex-wrap: wrap; }
  .card { background: #141821; border: 1px solid #232733; border-radius: 10px; padding: 16px; }
  .metric { min-width: 130px; display: flex; flex-direction: column; gap: 4px; }
  .metric span { color: #8b93a1; font-size: 12px; }
  .metric strong { font-size: 26px; font-weight: 600; }
  .metric.warn strong { color: #e8c07d; }

  .tabs { display: flex; gap: 4px; padding: 0 20px; flex-wrap: wrap; }
  .tabs button {
    background: none; border: none; color: #8b93a1; cursor: pointer;
    padding: 8px 14px; border-radius: 8px 8px 0 0; font-size: 14px;
  }
  .tabs button.active { background: #141821; color: #e6e6e6; }

  main { padding: 20px; }
  /* Las tablas anchas hacen scroll dentro de su caja, no en la página. */
  .scroll { overflow-x: auto; border: 1px solid #232733; border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; background: #141821; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #1e222c; }
  th { color: #8b93a1; font-weight: 500; font-size: 12px; text-transform: uppercase; }
  tr:last-child td { border-bottom: none; }

  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; background: #232733;
  }
  .ABIERTO { background: #123a52; color: #7cc7f0; }
  .EN_REVISION { background: #33270f; color: #e8c07d; }
  .CERRADO { background: #232733; color: #8b93a1; }
  .pALTA { background: #3d1a1a; color: #f0a0a0; }
  .pMEDIA { background: #232733; color: #c5cbd6; }
  .pBAJA { background: #1b1f28; color: #8b93a1; }
  .ok { background: #10331d; color: #7ee2a8; }
  .warn { background: #33270f; color: #e8c07d; }

  .login { display: flex; flex-direction: column; gap: 14px; width: 320px; }
  .login h1 { font-size: 17px; margin: 0; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #8b93a1; }
  input {
    background: #0f1115; border: 1px solid #2b3040; border-radius: 8px;
    padding: 10px; color: #e6e6e6; font-size: 14px;
  }
  button[type=submit] {
    background: #2f6feb; border: none; color: #fff; padding: 10px;
    border-radius: 8px; cursor: pointer; font-size: 14px;
  }
  .ghost {
    background: none; border: 1px solid #2b3040; color: #8b93a1;
    padding: 6px 12px; border-radius: 8px; cursor: pointer;
  }
  .alert {
    background: #3d1a1a; color: #f0a0a0; padding: 10px 12px;
    border-radius: 8px; font-size: 13px;
  }
</style>`;
