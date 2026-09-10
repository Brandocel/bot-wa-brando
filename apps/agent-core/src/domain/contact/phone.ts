/**
 * Normalización de números a identificador de WhatsApp.
 *
 * El operador teclea lo que tiene a mano: "9984862017", "998 486 2017",
 * "+52 998 486 2017". Todos son el mismo número y solo uno de los formatos
 * funciona como identificador. Guardar el que tecleó significa que el
 * permiso no aplica nunca — y el síntoma es "el bot dice que no tengo
 * acceso", que no apunta a un problema de formato por ningún lado.
 *
 * ── El "1" mexicano ───────────────────────────────────────────────────────
 * México dejó de usar el 1 para marcar móviles en 2019, pero WhatsApp sigue
 * direccionando los móviles mexicanos como 521 + 10 dígitos. Se comprueba
 * mirando cualquier número mexicano ya registrado: 5219987102151@c.us.
 *
 * Esto es una heurística, no una verdad universal, y por eso existe el
 * verificador contra WhatsApp: lo de aquí es el punto de partida, y la
 * respuesta del gateway es la que manda.
 */

/** Capa por defecto cuando el operador teclea solo los 10 dígitos locales. */
const DEFAULT_COUNTRY = '52';

export interface NormalizedPhone {
  /** Identificador de WhatsApp: "5219984862017@c.us". */
  waId: string;
  /** Formato internacional para mostrar: "+52 1 998 486 2017". */
  display: string;
  /** Solo dígitos, sin sufijo: "5219984862017". */
  digits: string;
}

export class InvalidPhoneError extends Error {}

export function normalizePhone(
  input: string,
  defaultCountry = DEFAULT_COUNTRY,
): NormalizedPhone {
  // Un id de WhatsApp completo se respeta tal cual: puede venir del propio
  // WhatsApp, y ahí ya no hay nada que adivinar.
  const asWaId = /^(\d{7,15})@(c\.us|s\.whatsapp\.net|lid)$/.exec(input.trim());
  if (asWaId) return build(asWaId[1]!);

  const digits = input.replace(/\D+/g, '');

  if (digits.length < 8) {
    throw new InvalidPhoneError(
      `"${input}" no parece un número: quedan ${digits.length} dígitos.`,
    );
  }

  if (digits.length > 15) {
    // 15 es el máximo que permite el estándar E.164.
    throw new InvalidPhoneError(`"${input}" tiene demasiados dígitos.`);
  }

  // Ya viene con lada de país mexicana.
  if (digits.startsWith('52')) {
    const resto = digits.slice(2);

    // 52 + 1 + 10 dígitos: la forma que usa WhatsApp. Se deja igual.
    if (resto.length === 11 && resto.startsWith('1')) return build(digits);

    // 52 + 10 dígitos: le falta el 1 que WhatsApp espera.
    if (resto.length === 10) return build(`521${resto}`);

    return build(digits);
  }

  // Diez dígitos pelados: es un número nacional del país por defecto.
  if (digits.length === 10) {
    return build(
      defaultCountry === '52' ? `521${digits}` : `${defaultCountry}${digits}`,
    );
  }

  // Cualquier otra cosa se asume ya internacional. No se inventa una lada:
  // meterle 52 a un número de otro país lo rompe en silencio.
  return build(digits);
}

function build(digits: string): NormalizedPhone {
  return {
    waId: `${digits}@c.us`,
    display: prettyPrint(digits),
    digits,
  };
}

/** Solo para mostrar. Nada de lógica depende de esto. */
function prettyPrint(digits: string): string {
  if (digits.startsWith('521') && digits.length === 13) {
    const n = digits.slice(3);
    return `+52 1 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }

  if (digits.startsWith('52') && digits.length === 12) {
    const n = digits.slice(2);
    return `+52 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }

  return `+${digits}`;
}
