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

/** En Render `hostport` llega sin esquema; en local viene la URL completa. */
function normalizeBaseUrl(raw: string): string {
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

export const config = {
  port: Number(process.env.PORT ?? process.env.CORE_PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  gatewayUrl: normalizeBaseUrl(required('GATEWAY_URL')),
  gatewayApiKey: required('GATEWAY_API_KEY'),

  /**
   * Mi número. Es lo único que otorga rol OWNER, así que si esto está mal
   * el asistente personal no te reconoce — y si estuviera vacío, cualquiera
   * podría caer en la rama de OWNER. Por eso es required().
   */
  ownerWaId: required('OWNER_WA_ID'),

  /**
   * Id del chat 'Mensajes contigo mismo'. WhatsApp lo direcciona por LID
   * (ej. 108817861898421@lid), NO por tu numero, asi que no se puede derivar
   * de OWNER_WA_ID. Es solo un respaldo: lo normal es que el mapper lo
   * detecte con chat.contact.isMe. Opcional.
   */
  ownerSelfChatId: process.env.OWNER_SELF_CHAT_ID || null,
} as const;
