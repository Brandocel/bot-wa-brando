import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config';
import {
  getQrPng,
  markSeen,
  sendFile,
  sendText,
  setTyping,
  status,
  whoAmI,
} from './whatsapp';

/**
 * Contrato HTTP del gateway. ESTE es el contrato que importa, no el de open-wa.
 * Mientras estos endpoints se respeten, el core no sabe ni le importa qué hay
 * del otro lado.
 */

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual truena si difieren en longitud, así que se compara aparte.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('x-gateway-key') ?? '';
  if (!safeEqual(provided, config.apiKey)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

/** Envuelve handlers async para que un throw no deje la petición colgada. */
function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req, res).catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[http]', detail);
      res.status(502).json({ error: detail });
    });
  };
}

export function buildServer() {
  const app = express();
  // 25mb, no 2mb: los documentos viajan en base64 dentro del JSON, y base64
  // infla ~33%. El tope real de lo que se entrega lo pone el core con
  // MAX_DELIVERABLE_BYTES; esto solo tiene que quedar holgado por encima.
  app.use(express.json({ limit: '25mb' }));

  // Health check de Render. Sin API key: Render no manda headers custom.
  // Responde 200 aunque WhatsApp esté caído — si devolviera 503, Render
  // reiniciaría el servicio en loop y nunca podrías escanear el QR.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, ...status() });
  });

  /**
   * Pantalla de vinculación. Ábrela en el navegador:
   *   https://wa-gateway.onrender.com/qr?key=<GATEWAY_API_KEY>
   *
   * Es una página y no el PNG pelón porque el QR de WhatsApp caduca cada
   * ~20 segundos. Con la imagen sola hay que recargar a mano y casi siempre
   * escaneas uno ya vencido; aquí la página se refresca sola y avisa cuando
   * la sesión quedó conectada.
   */
  app.get('/qr', (req, res) => {
    const key = String(req.query.key ?? req.header('x-gateway-key') ?? '');
    if (!safeEqual(key, config.apiKey)) {
      res.status(401).send('unauthorized');
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(qrPage(key));
  });

  /** La imagen sola. La consume la página de arriba. */
  app.get('/qr.png', (req, res) => {
    const key = String(req.query.key ?? req.header('x-gateway-key') ?? '');
    if (!safeEqual(key, config.apiKey)) {
      res.status(401).send('unauthorized');
      return;
    }

    const png = getQrPng();
    if (!png) {
      res
        .status(404)
        .send(`No hay QR pendiente. Estado actual: ${status().state}`);
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  });

  // Identidad de la cuenta conectada. El core la usa para saber quien es
  // el dueno sin que nadie tenga que teclear un numero a mano.
  app.get(
    '/me',
    requireApiKey,
    wrap(async (_req, res) => {
      res.json(await whoAmI());
    }),
  );

  app.post(
    '/messages/text',
    requireApiKey,
    wrap(async (req, res) => {
      const { to, text } = req.body as { to?: string; text?: string };
      if (!to || !text) {
        res.status(400).json({ error: 'faltan "to" o "text"' });
        return;
      }
      const messageId = await sendText(to, text);
      res.json({ messageId });
    }),
  );

  // Entrega de documentos. `base64` es el camino normal: el core baja el
  // archivo de Drive con sus credenciales y lo manda ya resuelto, porque el
  // gateway no tiene con qué autenticarse contra Drive. `url` queda para
  // archivos de acceso público.
  app.post(
    '/messages/file',
    requireApiKey,
    wrap(async (req, res) => {
      const { to, url, base64, filename, caption } = req.body as {
        to?: string;
        url?: string;
        base64?: string;
        filename?: string;
        caption?: string;
      };

      if (!to || !filename) {
        res.status(400).json({ error: 'faltan "to" o "filename"' });
        return;
      }
      if (!url && !base64) {
        res.status(400).json({ error: 'se requiere "url" o "base64"' });
        return;
      }

      const messageId = await sendFile({ to, url, base64, filename, caption });
      res.json({ messageId });
    }),
  );

  app.post(
    '/messages/typing',
    requireApiKey,
    wrap(async (req, res) => {
      const { to, on } = req.body as { to?: string; on?: boolean };
      if (!to) {
        res.status(400).json({ error: 'falta "to"' });
        return;
      }
      await setTyping(to, on ?? true);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/messages/seen',
    requireApiKey,
    wrap(async (req, res) => {
      const { to } = req.body as { to?: string };
      if (!to) {
        res.status(400).json({ error: 'falta "to"' });
        return;
      }
      await markSeen(to);
      res.json({ ok: true });
    }),
  );

  return app;
}

/**
 * Página de vinculación.
 *
 * Sin dependencias ni assets: un solo HTML que se sirve desde memoria. El
 * gateway existe para hablar con WhatsApp, no para servir una aplicación web,
 * y meterle un framework por una pantalla sería pagar arranque y superficie
 * de ataque a cambio de nada.
 *
 * La llave viaja en la URL porque es como ya se abría el QR. Es una URL para
 * pegar en tu navegador, no para compartir.
 */
function qrPage(key: string): string {
  const encodedKey = encodeURIComponent(key);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vincular WhatsApp</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0f1115; color: #e6e6e6;
    font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif;
  }
  .card { text-align: center; padding: 24px; max-width: 380px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p { color: #9aa0aa; margin: 0 0 20px; }
  /* Fondo blanco fijo: un QR sobre fondo oscuro no lo lee ningún teléfono. */
  .qr { background: #fff; padding: 12px; border-radius: 12px; display: inline-block; }
  .qr img { display: block; width: 260px; height: 260px; }
  .waiting {
    width: 284px; height: 284px; margin: 0 auto; border-radius: 12px;
    background: #141821; border: 1px solid #232733;
    display: grid; place-items: center; color: #8b93a1; font-size: 13px;
    padding: 0 24px; text-align: center;
  }
  .state {
    margin-top: 20px; padding: 10px 14px; border-radius: 8px;
    background: #1a1d24; font-size: 13px;
  }
  .ok { background: #10331d; color: #7ee2a8; }
  .warn { background: #33270f; color: #e8c07d; }
  ol { text-align: left; color: #9aa0aa; font-size: 13px; padding-left: 20px; }
</style>
</head>
<body>
<div class="card">
  <h1>Vincular WhatsApp</h1>
  <p>El código se renueva solo cada 20 segundos.</p>

  <div class="qr" id="qrbox" hidden><img id="qr" alt="Código QR" src="/qr.png?key=${encodedKey}"></div>
  <div class="waiting" id="waiting">Levantando el navegador…</div>

  <div class="state" id="state">Consultando estado…</div>

  <ol>
    <li>WhatsApp en tu teléfono</li>
    <li>Ajustes → Dispositivos vinculados</li>
    <li>Vincular un dispositivo</li>
  </ol>
</div>

<script>
const key = ${JSON.stringify(key)};
const img = document.getElementById('qr');
const qrbox = document.getElementById('qrbox');
const waiting = document.getElementById('waiting');
const state = document.getElementById('state');

/** Mientras no haya QR, la caja se oculta: un <img> sin imagen dibuja el
 *  icono de rota, que parece un error y no lo es. */
function mostrarQr(visible) {
  qrbox.hidden = !visible;
  waiting.hidden = visible;
}

async function tick() {
  try {
    const res = await fetch('/healthz');
    const data = await res.json();

    if (data.state === 'CONNECTED') {
      state.className = 'state ok';
      state.textContent = 'Conectado. Ya puedes cerrar esta pestaña.';
      mostrarQr(false);
      waiting.textContent = 'Sesión vinculada.';
      return; // se deja de refrescar: ya no hay QR que mostrar
    }

    if (data.state === 'WAITING_QR') {
      state.className = 'state';
      state.textContent = 'Esperando escaneo…';
      mostrarQr(true);
      // El parámetro sirve para saltarse la caché del navegador; sin él,
      // la imagen se queda pegada en el primer QR, que ya caducó.
      img.src = '/qr.png?key=' + encodeURIComponent(key) + '&t=' + Date.now();
    } else {
      state.className = 'state warn';
      state.textContent = 'Estado: ' + data.state +
        (data.lastError ? ' — ' + data.lastError : '');
      mostrarQr(false);
      waiting.textContent = data.state === 'BOOTING'
        ? 'Levantando el navegador… puede tardar un par de minutos.'
        : 'Sin código disponible ahora mismo.';
    }
  } catch {
    state.className = 'state warn';
    state.textContent = 'Sin conexión con el gateway.';
  }

  setTimeout(tick, 5000);
}

tick();
</script>
</body>
</html>`;
}
