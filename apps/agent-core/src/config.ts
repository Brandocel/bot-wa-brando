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

  /**
   * URL pública de este servicio, para los enlaces de descarga que se le
   * mandan al cliente. En Render la inyecta RENDER_EXTERNAL_URL sola.
   */
  publicUrl: normalizeBaseUrl(
    process.env.PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${process.env.PORT ?? 3000}`,
  ),

  /** Vacío = el bot funciona igual, pero sin conversación en lenguaje normal. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,

  llm: {
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
  },

  google: {
    /**
     * JSON completo de la cuenta de servicio, tal como lo descarga Google.
     * Va como una sola variable de entorno porque Render no monta archivos.
     *
     * Vacío = la sincronización con Drive queda apagada y el resto del bot
     * sigue funcionando. Es a propósito: poder arrancar sin Drive es lo que
     * permite probar permisos y tickets con datos sembrados.
     */
    serviceAccount: parseServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),

    syncIntervalMs: Number(process.env.DRIVE_SYNC_INTERVAL_MS ?? 5 * 60 * 1000),

    /**
     * Tope de tamaño para entregar por WhatsApp. Más grande que esto se
     * escala a un humano en vez de intentar un envío que va a fallar:
     * el archivo viaja en base64, que infla ~33%.
     */
    maxDeliverableBytes: Number(process.env.MAX_DELIVERABLE_BYTES ?? 15 * 1024 * 1024),
  },

  queue: {
    /**
     * Cuántos mensajes entrantes se atienden a la vez (de chats distintos;
     * el mismo chat siempre va en orden). Cuatro alcanza para decenas de
     * personas escribiendo en la misma hora sin que nadie espere en fila.
     * Cada uno es una conexión a Postgres y, cuando toca, una llamada al
     * modelo: no conviene subirlo a lo loco en un plan chico.
     */
    workers: Math.max(1, Number(process.env.INCOMING_WORKERS ?? 4)),
  },
} as const;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/**
 * El JSON de Google trae la llave privada con saltos de línea reales. Al
 * pegarla en un panel de variables de entorno suelen convertirse en la
 * secuencia literal de dos caracteres (barra invertida seguida de ene), y
 * entonces la firma del JWT falla con un error de OpenSSL que no menciona
 * nada de esto. Por eso se normaliza aquí.
 */
function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('faltan client_email o private_key');
    }

    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch (err) {
    // NO se lanza. Esto corre al importar el módulo, antes de que Nest
    // exista, así que un throw aquí mata el proceso entero: el bot deja de
    // contestar a todo el mundo porque una credencial OPCIONAL venía mal
    // pegada. Drive es un subsistema; su fallo lo apaga a él, no al bot.
    //
    // El error se grita en el log para que no pase inadvertido, que es el
    // otro modo de fallo que hay que evitar.
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[config] GOOGLE_SERVICE_ACCOUNT_JSON inválido (${detail}). ` +
        'La sincronización con Drive queda apagada; el resto del bot sigue.',
    );
    return null;
  }
}
