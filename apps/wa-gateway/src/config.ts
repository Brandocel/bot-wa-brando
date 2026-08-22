import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env y llénala.`,
    );
  }
  return value;
}

/**
 * `CORE_WEBHOOK_URL` en Render llega como "host:puerto" (property: hostport
 * del render.yaml), sin esquema. En local llega como URL completa.
 */
function normalizeBaseUrl(raw: string): string {
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

export const config = {
  port: Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? 10000),

  apiKey: required('GATEWAY_API_KEY'),

  session: {
    id: process.env.WA_SESSION_ID ?? 'brando',
    path: process.env.WA_SESSION_PATH ?? './data/session',
  },

  coreWebhookUrl: normalizeBaseUrl(required('CORE_WEBHOOK_URL')),

  /**
   * Vacío en local: open-wa descarga su propio Chromium.
   * En Docker/Render apunta al chromium de apt (ver Dockerfile).
   */
  chromiumPath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

  /**
   * El Chromium que trae Puppeteer suele ser viejo y WhatsApp Web le sirve
   * una pagina de 'navegador no soportado' en vez del QR. Con Chrome real
   * eso no pasa.
   */
  useChrome: process.env.WA_USE_CHROME === 'true',

  /**
   * open-wa manda por defecto un UA que dice Chrome/104 y WhatsApp Web ya
   * responde con la pagina de 'navegador no soportado', asi que el QR nunca
   * aparece. Se puede sobreescribir.
   */
  userAgent: process.env.WA_USER_AGENT || undefined,

  /** WA_HEADLESS=false abre una ventana de Chrome visible. Ultimo recurso
   *  si WhatsApp sigue rechazando el vinculo: un navegador de verdad es
   *  mucho mas dificil de detectar. En Render no sirve (no hay pantalla). */
  headless: process.env.WA_HEADLESS !== 'false',
} as const;
