/** Fechas, números y nombres como los quiere leer una persona. Todo en es-MX. */

export const fecha = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const hora = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';

/** "Septiembre de 2026", a partir de un periodo guardado en UTC. */
export const mesLargo = (iso: string): string => {
  const texto = new Date(iso).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

export const mesCorto = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('es-MX', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

export const tamano = (bytes: number): string =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Los chats que llegan por el número de una empresa traen un id compuesto
 * ("linea:<id>:<chat>"): aquí se separa para enseñar el número de verdad.
 */
export const separarLinea = (chatId: string | null | undefined): { linea: string | null; chat: string } => {
  const m = /^linea:([^:]+):(.*)$/.exec(chatId ?? '');
  return m ? { linea: m[1], chat: m[2] } : { linea: null, chat: chatId ?? '' };
};

export const numeroBonito = (waId: string | null | undefined): string =>
  separarLinea(waId).chat.replace(/@.*$/, '');

export const iniciales = (nombre: string | null | undefined): string =>
  (nombre ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();

export const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;
