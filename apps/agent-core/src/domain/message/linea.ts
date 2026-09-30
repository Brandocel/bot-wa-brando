/**
 * Conversaciones por línea de WhatsApp.
 *
 * Con un número por empresa, la misma persona puede escribirle a dos
 * empresas y esas son DOS conversaciones distintas, aunque del otro lado
 * esté el mismo teléfono. El core identifica cada conversación por su
 * chatId, así que a las que llegan por la línea de una empresa se les da uno
 * compuesto: `linea:<id>:<chat>`. Todo el core lo trata como un id opaco
 * (bandeja, tickets, candados, topes), y solo el mapper de entrada y el
 * adaptador de salida lo arman y lo desarman.
 *
 * Las del número principal conservan el chatId de siempre: no hay que
 * migrar ninguna conversación existente.
 */

export const LINEA_PRINCIPAL = 'principal';
const PREFIJO = 'linea:';

/** El chatId del core para un chat de WhatsApp que llegó por esa línea. */
export function chatDeLinea(linea: string | null | undefined, chat: string): string {
  if (!linea || linea === LINEA_PRINCIPAL) return chat;
  return `${PREFIJO}${linea}:${chat}`;
}

/** De un chatId del core, la línea y el chat de WhatsApp de verdad. */
export function separarChat(chatId: string): { linea: string | null; chat: string } {
  if (!chatId.startsWith(PREFIJO)) return { linea: null, chat: chatId };
  const resto = chatId.slice(PREFIJO.length);
  const i = resto.indexOf(':');
  if (i <= 0) return { linea: null, chat: chatId };
  return { linea: resto.slice(0, i), chat: resto.slice(i + 1) };
}

/** Prefijo común de todas las conversaciones de una línea. */
export function prefijoDeLinea(linea: string): string {
  return `${PREFIJO}${linea}:`;
}

/** El id de línea que se le da a una empresa en el gateway. */
export function lineaDeEmpresa(organizationId: string): string {
  return `org_${organizationId}`.replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
}
