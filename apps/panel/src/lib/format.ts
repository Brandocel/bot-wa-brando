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

/** "hace 5 min", "ayer", "12/09": lo que se quiere leer en una lista. */
export const hace = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
};

/** "Hoy", "Ayer" o la fecha larga: el separador entre días de un hilo. */
export const nombreDia = (iso: string): string => {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
};

export const dinero = (cents: number): string =>
  `$${(cents / 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;

/** Un tono por nombre, estable: la misma persona siempre se ve del mismo color. */
export const tono = (nombre: string | null | undefined): number => {
  let h = 0;
  for (const ch of nombre ?? '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

/** Para buscar sin que importen mayúsculas ni acentos. */
export const normalizar = (texto: string | null | undefined): string =>
  (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
