import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config';
import {
  checkNumber,
  diagnosticar,
  probarEnvioReal,
  getQrPng,
  markSeen,
  sendFile,
  sendText,
  setTyping,
  status,
  whoAmI,
} from './whatsapp';

/**
 * Contrato HTTP del gateway. ESTE es el contrato que importa, no el de Baileys.
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

  /**
   * Health check de Render. Sin API key: Render no manda headers custom.
   *
   * Devuelve 503 SOLO en CRASHED, que es cuando la sesión está muerta de
   * verdad. Así Render reinicia el servicio por su cuenta, sin depender de
   * que el proceso se suicide correctamente — dos mecanismos independientes
   * para el mismo fallo, que es lo que hace que no haga falta un humano.
   *
   * BOOTING y WAITING_QR siguen devolviendo 200 a propósito: si un servicio
   * esperando QR respondiera 503, Render lo reiniciaría en bucle y nunca
   * habría tiempo de escanear nada.
   */
  app.get('/healthz', (_req, res) => {
    const estado = status();
    res.status(estado.state === 'CRASHED' ? 503 : 200).json({
      ok: estado.state !== 'CRASHED',
      ...estado,
    });
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
      const { to, url, base64, filename, caption, quotedMsgId } = req.body as {
        to?: string;
        url?: string;
        base64?: string;
        filename?: string;
        caption?: string;
        quotedMsgId?: string;
      };

      if (!to || !filename) {
        res.status(400).json({ error: 'faltan "to" o "filename"' });
        return;
      }
      if (!url && !base64) {
        res.status(400).json({ error: 'se requiere "url" o "base64"' });
        return;
      }

      const messageId = await sendFile({ to, url, base64, filename, caption, quotedMsgId });
      res.json({ messageId });
    }),
  );

  /**
   * Comprueba un número contra WhatsApp y devuelve su id canónico.
   *
   * Lo usa el panel al dar de alta un número: así el permiso se guarda con
   * el identificador que WhatsApp usa de verdad, y no con el que nosotros
   * dedujimos.
   */
  app.get(
    '/contacts/check',
    requireApiKey,
    wrap(async (req, res) => {
      const number = String(req.query.number ?? '');
      if (!number) {
        res.status(400).json({ error: 'falta "number"' });
        return;
      }

      res.json(await checkNumber(number));
    }),
  );

  /**
   * Por qué no salen los archivos: las tres hipótesis, preguntadas de golpe.
   *
   * Devuelve lo que WhatsApp contesta sobre cada variante del número (con y
   * sin el "1" mexicano), si existe un chat guardado bajo cada una, y lo que
   * cuelga del chat LID. No manda nada: es seguro llamarlo.
   */
  app.get(
    '/diag/destino',
    requireApiKey,
    wrap(async (req, res) => {
      const to = String(req.query.to ?? '');
      if (!to) {
        res.status(400).json({ error: 'falta "to"' });
        return;
      }

      res.json(await diagnosticar(to));
    }),
  );

  /**
   * Prueba de entrega completa: texto y archivo al mismo destino. Esto sí
   * manda mensajes de verdad, así que el destino va explícito y no se deduce
   * de nada — nadie debería recibir una prueba por accidente.
   */
  app.post(
    '/diag/enviar',
    requireApiKey,
    wrap(async (req, res) => {
      const { to, base64, filename } = req.body as {
        to?: string;
        base64?: string;
        filename?: string;
      };

      if (!to) {
        res.status(400).json({ error: 'falta "to"' });
        return;
      }

      // Un PDF mínimo de verdad. Un base64 inventado lo rechazaría WhatsApp
      // por el archivo y no por el destino, que es lo que se está probando.
      const contenido =
        base64 ??
        'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA5OSA5OV0+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4K';

      res.json({
        destino: to,
        pasos: await probarEnvioReal(to, contenido, filename ?? 'prueba.pdf'),
      });
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
  /* Sin esto, el atributo hidden NO oculta la caja del QR: el
     display inline-block de .qr le gana a la regla del navegador y la caja
     se queda visible con el icono de imagen rota dentro. */
  [hidden] { display: none !important; }
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
