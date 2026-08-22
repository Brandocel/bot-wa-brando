import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config';
import {
  getQrPng,
  markSeen,
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
  app.use(express.json({ limit: '2mb' }));

  // Health check de Render. Sin API key: Render no manda headers custom.
  // Responde 200 aunque WhatsApp esté caído — si devolviera 503, Render
  // reiniciaría el servicio en loop y nunca podrías escanear el QR.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, ...status() });
  });

  // El QR, servido como PNG. Ábrelo en el navegador con la API key:
  //   https://wa-gateway.onrender.com/qr?key=<GATEWAY_API_KEY>
  app.get('/qr', (req, res) => {
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
