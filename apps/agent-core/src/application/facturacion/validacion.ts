import { FORMAS_PAGO, regimen, usoCfdi } from './catalogos';

/**
 * Validaciones del receptor ANTES de llegar al PAC.
 *
 * En CFDI 4.0 el SAT compara nombre, RFC, código postal y régimen contra
 * su padrón, y basta una letra distinta para que rebote. El PAC lo dice,
 * pero tarde y en su idioma ("CFDI40145 - El campo Nombre del receptor...").
 * Aquí se detecta lo que se puede detectar sin el padrón, y cada error sale
 * en palabras que se le pueden decir al cliente por WhatsApp.
 */

export interface Receptor {
  rfc: string;
  nombre: string;
  codigoPostal: string;
  regimen: string;
  usoCfdi: string;
  email?: string | null;
}

export type TipoPersona = 'fisica' | 'moral';

/** Público en general (ventas a quien no da RFC) y extranjero. */
export const RFC_PUBLICO_GENERAL = 'XAXX010101000';
export const RFC_EXTRANJERO = 'XEXX010101000';

/** Lo que pone el SAT en "Régimen Capital" y que NO va en el nombre del CFDI 4.0. */
const REGIMEN_SOCIETARIO =
  /[\s,]+(S\.?\s?A\.?\s?P\.?\s?I\.?|S\.?\s?A\.?\s?B\.?|S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|S\.?\s?DE\s?R\.?\s?L\.?|S\.?\s?C\.?|A\.?\s?C\.?|S\.?\s?C\.?\s?(DE\s?)?R\.?\s?L\.?|S\.?\s?C\.?\s?P\.?)(\s+DE\s+C\.?\s?V\.?)?\.?$/;

/** RFC en mayúsculas y sin espacios ni guiones: "goDe-561231 gr8" → "GODE561231GR8". */
export function normalizarRfc(rfc: string): string {
  return rfc.toUpperCase().replace(/[\s\-.]/g, '');
}

/**
 * El nombre como lo espera el SAT: mayúsculas, un solo espacio y sin el
 * régimen societario ("ACME SA DE CV" → "ACME"), que solo se quita a
 * empresas. Los acentos y la Ñ se quedan: así vienen en la Constancia.
 */
export function normalizarNombre(nombre: string, tipo: TipoPersona | null = null): string {
  let n = nombre.toUpperCase().replace(/\s+/g, ' ').trim();
  // Una persona física no tiene régimen societario: "JUAN PEREZ SA" se queda.
  if (tipo === 'fisica') return n;
  // Dos pasadas: "ACME, S.A.P.I. DE C.V." deja la coma colgando en la primera.
  for (let i = 0; i < 2; i++) n = n.replace(REGIMEN_SOCIETARIO, '').replace(/[\s,]+$/, '').trim();
  return n;
}

export function tipoPersona(rfc: string): TipoPersona | null {
  const r = normalizarRfc(rfc);
  if (/^[A-ZÑ&]{3}\d{6}[A-Z\d]{3}$/.test(r)) return 'moral';
  if (/^[A-ZÑ&]{4}\d{6}[A-Z\d]{3}$/.test(r)) return 'fisica';
  return null;
}

const DIGITOS = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

/**
 * Dígito verificador del RFC (el último carácter de la homoclave).
 * Atrapa el error más común al dictarlo: una letra o número cambiado.
 */
export function digitoVerificadorValido(rfc: string): boolean {
  const r = normalizarRfc(rfc);
  const base = (r.length === 12 ? ' ' + r : r).slice(0, 12);
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    const v = DIGITOS.indexOf(base[i]!);
    if (v < 0) return false;
    suma += v * (13 - i);
  }
  const resto = suma % 11;
  const esperado = resto === 0 ? '0' : 11 - resto === 10 ? 'A' : String(11 - resto);
  return r[r.length - 1] === esperado;
}

/** La fecha dentro del RFC (AAMMDD) tiene que existir. */
function fechaValida(rfc: string): boolean {
  const r = normalizarRfc(rfc);
  const fecha = r.slice(r.length - 9, r.length - 3);
  const mes = Number(fecha.slice(2, 4));
  const dia = Number(fecha.slice(4, 6));
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
}

export function esRfcGenerico(rfc: string): boolean {
  const r = normalizarRfc(rfc);
  return r === RFC_PUBLICO_GENERAL || r === RFC_EXTRANJERO;
}

/** null = válido; si no, qué está mal, dicho para el cliente. */
export function errorDeRfc(rfc: string): string | null {
  const r = normalizarRfc(rfc);
  if (esRfcGenerico(r)) return null;
  if (!tipoPersona(r)) {
    return 'El RFC no tiene el formato correcto: son 13 caracteres para persona física o 12 para empresa.';
  }
  if (!fechaValida(r)) return 'La fecha dentro del RFC no es válida. ¿Me lo confirmas?';
  if (!digitoVerificadorValido(r)) return 'El RFC parece tener un carácter equivocado. ¿Me lo confirmas tal como sale en tu Constancia?';
  return null;
}

/**
 * Todo lo que está mal en los datos del receptor. Vacío = se puede intentar
 * timbrar (el SAT todavía puede rechazar por el padrón).
 */
export function erroresDeReceptor(r: Receptor): string[] {
  const errores: string[] = [];
  const rfc = normalizarRfc(r.rfc);

  const tipo = tipoPersona(rfc);
  const errRfc = errorDeRfc(rfc);
  if (errRfc) errores.push(errRfc);

  if (normalizarNombre(r.nombre, tipo).length < 2) errores.push('Falta el nombre o razón social, tal como aparece en la Constancia.');
  if (!/^\d{5}$/.test(r.codigoPostal.trim())) errores.push('El código postal fiscal debe ser de 5 dígitos.');

  const reg = regimen(r.regimen);
  const uso = usoCfdi(r.usoCfdi);

  if (!reg) errores.push('El régimen fiscal no es válido.');
  else if (tipo === 'fisica' && !reg.fisica) errores.push(`El régimen ${reg.clave} es solo para empresas, y el RFC es de persona física.`);
  else if (tipo === 'moral' && !reg.moral) errores.push(`El régimen ${reg.clave} es solo para personas físicas, y el RFC es de empresa.`);

  if (!uso) errores.push('El uso del CFDI no es válido.');
  else {
    if (tipo === 'fisica' && !uso.fisica) errores.push(`El uso ${uso.clave} es solo para empresas.`);
    if (tipo === 'moral' && !uso.moral) errores.push(`El uso ${uso.clave} (${uso.nombre}) es solo para personas físicas.`);
    if (reg && !uso.regimenes.includes(reg.clave)) {
      errores.push(`Con el régimen ${reg.clave} (${reg.nombre}) no se puede usar ${uso.clave} (${uso.nombre}).`);
    }
  }

  // Reglas del SAT para el RFC genérico nacional. El nombre "PUBLICO EN
  // GENERAL" obliga al nodo InformacionGlobal (CFDI40130): eso es la factura
  // global del periodo, no la de un cliente. La de un cliente sin RFC lleva
  // su nombre.
  if (rfc === RFC_PUBLICO_GENERAL) {
    if (/PUBLICO EN GENERAL/.test(normalizarNombre(r.nombre).normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
      errores.push('Con RFC genérico la factura lleva el nombre de quien compra; "PUBLICO EN GENERAL" es solo para la factura global.');
    }
    if (r.regimen !== '616') errores.push('Con RFC genérico el régimen debe ser 616.');
    if (r.usoCfdi !== 'S01') errores.push('Con RFC genérico el uso debe ser S01.');
  }

  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) errores.push('El correo no es válido.');
  return errores;
}

export type MetodoPago = 'PUE' | 'PPD';

/** PUE = ya se pagó; PPD = se paga después y la forma es "99 Por definir". */
export function errorDePago(formaPago: string, metodoPago: MetodoPago): string | null {
  if (!FORMAS_PAGO[formaPago]) return 'La forma de pago no es válida.';
  if (metodoPago === 'PPD' && formaPago !== '99') return 'Si se paga después (PPD), la forma de pago debe ser 99 Por definir.';
  if (metodoPago === 'PUE' && formaPago === '99') return 'Si ya se pagó (PUE), hay que decir cómo: efectivo, transferencia, tarjeta...';
  return null;
}
