/**
 * Plan Persona: lo que paga alguien que usa el bot para sí mismo.
 *
 * Premia quedarse: cada mes que sigue suscrito paga menos, hasta el piso
 * del quinto mes, que se queda para siempre. Si cancela y vuelve, es una
 * suscripción nueva y empieza otra vez en el mes 1.
 *
 * Los montos son SIN IVA y en pesos; el IVA (16 %) se cobra encima a todos,
 * pidan factura o no: el impuesto lo causa el cobro, no el CFDI. Quien no
 * pide factura entra en la factura global al público en general.
 */

export const IVA = 0.16;

/** Mes 1 a 5 en adelante, sin IVA. */
export const ESCALONES_BASE = [869, 768, 669, 569, 469] as const;

/**
 * Facturación (el bot timbra por la persona): un extra proporcional al
 * plan, ~30 % de cada escalón, que baja al mismo ritmo.
 */
export const ESCALONES_FACTURA = [259, 229, 199, 169, 139] as const;

export const MESES_ESCALERA = ESCALONES_BASE.length;

/**
 * Índice del escalón que toca en el mes `mes` (1 = el primer cobro).
 * Del quinto en adelante, siempre el último.
 */
export function escalonDe(mes: number): number {
  const m = Math.max(1, Math.floor(mes));
  return Math.min(m, MESES_ESCALERA) - 1;
}

export interface Cobro {
  /** Sin IVA. */
  subtotal: number;
  iva: number;
  total: number;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Lo que se cobra el mes `mes`, con o sin el extra de facturación. */
export function cobroDelMes(mes: number, conFactura: boolean): Cobro {
  const i = escalonDe(mes);
  const subtotal = ESCALONES_BASE[i] + (conFactura ? ESCALONES_FACTURA[i] : 0);
  const iva = centavos(subtotal * IVA);
  return { subtotal, iva, total: centavos(subtotal + iva) };
}

/** Clave estable del precio en Stripe: `persona_m1`, `persona_factura_m3`... */
export const clavePrecio = (tipo: 'base' | 'factura', escalon: number): string =>
  `persona_${tipo === 'factura' ? 'factura_' : ''}m${escalon + 1}`;

/** Prueba piloto: cuántas personas pueden tener su mes gratis a la vez. */
export const PILOTOS_MAX = 3;

/**
 * Fin del mes gratis: el mismo día del mes siguiente. Si ese día no existe
 * (31 de enero → febrero), el último día de ese mes.
 */
export function finDePrueba(desde: Date): Date {
  const fin = new Date(desde);
  const dia = fin.getUTCDate();
  fin.setUTCDate(1);
  fin.setUTCMonth(fin.getUTCMonth() + 1);
  const ultimo = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 0)).getUTCDate();
  fin.setUTCDate(Math.min(dia, ultimo));
  return fin;
}
