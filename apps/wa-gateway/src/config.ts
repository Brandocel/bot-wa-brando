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
    path: process.env.WA_SESSION_PATH ?? './data/baileys',
  },

  /**
   * Dónde esperan los mensajes que el core todavía no pudo recibir.
   * Va en el disco persistente, al lado de la sesión: una cola que se borra
   * al reiniciar no sirve de nada, porque reiniciar es justo cuando se usa.
   */
  pendingPath: process.env.WA_PENDING_PATH ?? './data/pending',

  coreWebhookUrl: normalizeBaseUrl(required('CORE_WEBHOOK_URL')),
} as const;
