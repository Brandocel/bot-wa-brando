import { palabras, parecida } from './texto-flexible';

/**
 * ¿La persona dijo que sí? Para confirmar un pedido o una factura.
 *
 * Se lee por palabras y no con una lista de frases exactas: la gente
 * escribe "perfecto si así está bien", "simón", "siii va", "zi", "okei" o
 * "órale, dale", y cada frase nueva que no estaba en la lista dejaba al
 * cliente atorado con el mismo resumen repetido. La regla:
 *
 *  - ninguna palabra que pida un cambio ("no", "pero", "cambia"...), y
 *  - al menos una palabra de sí, y
 *  - todo lo demás es relleno ("así", "está", "por favor", "gracias").
 *
 * Cada palabra se compara tolerando faltas de ortografía (ver
 * texto-flexible). Una palabra que no es ni sí ni relleno ("perfecto pero
 * sin cebolla", "sí, a las 3") hace que NO cuente: lo dudoso se vuelve a
 * preguntar.
 */

const NIEGA = [
  'no', 'nop', 'nel', 'pero', 'cambia', 'cambiar', 'cambio', 'quita', 'quitale', 'agrega', 'agregale', 'mejor',
  'espera', 'esperame', 'mal', 'corrige', 'corregir', 'falta', 'sin', 'otro', 'otra', 'menos', 'mas',
];

const SI = [
  'si', 'sip', 'simon', 'claro', 'dale', 'va', 'sale', 'ok', 'okey', 'okay', 'okei', 'oki', 'perfecto', 'correcto',
  'exacto', 'listo', 'confirma', 'confirmo', 'confirmalo', 'confirmado', 'mandalo', 'pidela', 'adelante', 'acuerdo',
  'bien', 'orale', 'andale', 'aja', 'excelente', 'genial', 'yes', 'vale', 'jalo', 'chido', 'perfect', 'eso', 'asi',
];

const RELLENO = [
  'esta', 'estan', 'todo', 'es', 'por', 'favor', 'porfa', 'porfavor', 'plis', 'pls', 'please', 'gracias', 'gracia',
  'grax', 'de', 'muy', 'mil', 'me', 'parece', 'pues', 'entonces', 'ya', 'la', 'lo', 'el', 'y', 'ahi', 'joven',
  'amigo', 'amiga', 'super', 'oye',
];

const es = (p: string, lista: readonly string[]) => lista.some((w) => parecida(p, w));

export function esConfirmacion(texto: string): boolean {
  // Un número ("sí, a las 3") es un dato nuevo, no relleno: no es un sí limpio.
  const ps = palabras(texto);
  if (ps.length === 0 || ps.length > 12) return false;
  if (ps.some((p) => es(p, NIEGA))) return false;
  if (!ps.some((p) => es(p, SI))) return false;
  return ps.every((p) => es(p, SI) || es(p, RELLENO));
}
