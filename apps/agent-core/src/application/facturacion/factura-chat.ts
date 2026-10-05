import { FORMAS_PAGO, REGIMENES, regimen, USOS_CFDI, type UsoCfdi } from './catalogos';
import { normalizarRfc, tipoPersona, type Receptor } from './validacion';

/**
 * Lo que el cliente escribe durante la plática de factura, leído sin el
 * modelo: son respuestas cortas a preguntas cerradas ("2", "transferencia",
 * "G03", un RFC). Un error aquí factura con datos equivocados, así que lo
 * que no se entiende con certeza se vuelve a preguntar.
 */

function plano(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** ¿Pide factura? "me la facturas", "necesito factura", "requiero CFDI". */
export function pideFactura(texto: string): boolean {
  const t = plano(texto);
  if (/\b(no|sin) (necesito |quiero |ocupo )?(la |una )?factura/.test(t)) return false;
  return /\bfactur|\bcfdi\b/.test(t);
}

export function quiereSalir(texto: string): boolean {
  const t = plano(texto);
  return /^(cancela|cancelar|cancelalo|ya no|olvidalo|dejalo|mejor no|no gracias|no quiero factura|salir)\b/.test(t);
}

/** "sí", "si esta bien", "correcto". Lo dudoso NO es un sí. */
export function esSi(texto: string): boolean {
  const t = plano(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(no|pero|cambia|cambiar|mal|corrige|espera)\b/.test(t)) return false;
  return /^(si|sip|claro|dale|va|ok|okey|correcto|exacto|esta bien|asi esta bien|asi|perfecto|de acuerdo|adelante|confirmo|confirmado)( (por favor|porfa|gracias|asi|esta bien|correcto|va|dale))*$/.test(t);
}

export function esNo(texto: string): boolean {
  const t = plano(texto).replace(/[^a-z\s]/g, ' ').trim();
  return /^(no|nop|nel|no es|no son|incorrecto|esta mal|estan mal|cambia|cambiar|corregir)\b/.test(t);
}

/** Número de opción ("2", "la 2", "opcion 2"), o null. */
export function opcion(texto: string, max: number): number | null {
  const m = plano(texto).match(/^(?:la |el |opcion |numero |#)?(\d{1,2})\.?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n : null;
}

/** "P-1042", "1042", "el pedido 1042". */
export function numeroDePedido(texto: string): number | null {
  const m = plano(texto).match(/(?:^|\bp-?|pedido\s*#?\s*|^#)(\d{1,7})\b/);
  return m ? Number(m[1]) : null;
}

// ── Datos fiscales escritos a mano ────────────────────────────────────

export interface DatosEscritos {
  rfc: string | null;
  nombre: string | null;
  codigoPostal: string | null;
  regimen: string | null;
  email: string | null;
}

const RFC_RE = /\b([A-ZÑ&]{3,4})[\s-]?(\d{6})[\s-]?([A-Z\d]{3})\b/i;

/**
 * RFC, nombre, CP, régimen y correo de un texto libre ("RFC: XAXX..., CP
 * 77500, régimen 612, Juan Pérez"). Lo que no aparece con certeza queda en
 * null y se pregunta aparte; el nombre solo se toma si viene etiquetado o
 * en un renglón propio, porque es lo que más rechaza el SAT.
 */
export function leerDatosEscritos(texto: string): DatosEscritos {
  const rfcM = texto.match(RFC_RE);
  const rfc = rfcM ? normalizarRfc(rfcM[1]! + rfcM[2]! + rfcM[3]!) : null;
  const sinRfc = rfcM ? texto.replace(rfcM[0], ' ') : texto;

  const emailM = sinRfc.match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/);
  const email = emailM ? emailM[0].toLowerCase() : null;
  const sinEmail = emailM ? sinRfc.replace(emailM[0], ' ') : sinRfc;

  const cpM = sinEmail.match(/(?:c\.?\s?p\.?|c[oó]digo postal)\s*:?\s*(\d{5})\b/i) ?? sinEmail.match(/\b(\d{5})\b/);
  const codigoPostal = cpM ? cpM[1]! : null;

  const regimenLeido = leerRegimen(sinEmail);

  let nombre: string | null = null;
  const etiquetado = sinEmail.match(/(?:nombre|raz[oó]n social|a nombre de)\s*:?\s*([^\n,;]+)/i);
  if (etiquetado) nombre = etiquetado[1]!.trim();
  else {
    // En una lista de datos (un dato por renglón), el único renglón que
    // solo trae letras es el nombre. En una frase suelta ("mi rfc es...",
    // "no sé") no se adivina.
    const renglones = sinEmail.split('\n').map((r) => r.trim()).filter(Boolean);
    const soloLetras = renglones.filter((r) => r.length >= 5 && /^[A-ZÁÉÍÓÚÑÜ&.,' ]+$/i.test(r) && !leerRegimen(r));
    if (renglones.length >= 3 && soloLetras.length === 1) nombre = soloLetras[0]!;
  }
  if (nombre) nombre = nombre.replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim() || null;

  return { rfc, nombre, codigoPostal, regimen: regimenLeido, email };
}

/** Régimen por clave ("612") o por nombre ("resico", "sueldos y salarios"). */
export function leerRegimen(texto: string): string | null {
  const t = plano(texto);
  const clave = t.match(/\b(6[0-2]\d)\b/);
  if (clave && regimen(clave[1]!)) return clave[1]!;
  if (/\bresico\b|simplificado de confianza/.test(t)) return '626';
  if (/sueldos|salarios|asalariad/.test(t)) return '605';
  if (/sin obligaciones/.test(t)) return '616';
  if (/actividad(es)? empresarial|profesional|honorarios/.test(t)) return '612';
  if (/plataformas tecnologicas/.test(t)) return '625';
  if (/arrendamiento/.test(t)) return '606';
  if (/general de ley/.test(t)) return '601';
  if (/fines no lucrativos/.test(t)) return '603';
  if (/incorporacion fiscal|\brif\b/.test(t)) return '621';
  return null;
}

// ── Opciones que se le ofrecen ────────────────────────────────────────

/** Los usos que tienen sentido para su régimen, con los comunes primero. */
export function usosPara(reg: string, rfc: string): UsoCfdi[] {
  const tipo = tipoPersona(rfc);
  const orden = ['G03', 'G01', 'S01', 'D01', 'D02', 'D07', 'D10', 'I04'];
  return USOS_CFDI
    .filter((u) => u.regimenes.includes(reg) && (tipo === 'moral' ? u.moral : u.fisica) && orden.includes(u.clave))
    .sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave));
}

export function leerUso(texto: string, opciones: readonly UsoCfdi[]): string | null {
  const n = opcion(texto, opciones.length);
  if (n) return opciones[n - 1]!.clave;
  const t = plano(texto);
  const clave = t.match(/\b([gids]\d{2}|cp01|cn01)\b/i)?.[1]?.toUpperCase();
  if (clave && opciones.some((o) => o.clave === clave)) return clave;
  if (/gastos? en general/.test(t)) return opciones.find((o) => o.clave === 'G03')?.clave ?? null;
  if (/sin efectos/.test(t)) return opciones.find((o) => o.clave === 'S01')?.clave ?? null;
  if (/mercancia/.test(t)) return opciones.find((o) => o.clave === 'G01')?.clave ?? null;
  return null;
}

/** Formas de pago que se ofrecen, en el orden en que se listan. */
export const PAGOS_OFRECIDOS = ['01', '03', '28', '04'] as const;

/**
 * "transferencia", "spei", "2", "con tarjeta de débito". "Tarjeta" a secas
 * no basta: débito y crédito son claves distintas y se pregunta cuál.
 */
export function leerFormaPago(texto: string): string | 'tarjeta' | null {
  const n = opcion(texto, PAGOS_OFRECIDOS.length);
  if (n) return PAGOS_OFRECIDOS[n - 1]!;
  const t = plano(texto);
  if (/efectivo|cash/.test(t)) return '01';
  if (/transferencia|spei|deposito/.test(t)) return '03';
  if (/debito/.test(t)) return '28';
  if (/credito/.test(t)) return '04';
  if (/tarjeta/.test(t)) return 'tarjeta';
  return null;
}

export function leerCorreo(texto: string): string | 'ninguno' | null {
  const m = texto.match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/);
  if (m) return m[0].toLowerCase();
  const t = plano(texto);
  if (/^(no|nop|sin correo|no tengo|ninguno|asi|solo por aqui|por aqui|por whatsapp|aqui)\b/.test(t)) return 'ninguno';
  return null;
}

// ── Textos ────────────────────────────────────────────────────────────

export function listaUsos(opciones: readonly UsoCfdi[]): string {
  return opciones.map((u, i) => `${i + 1}. ${u.nombre} (${u.clave})`).join('\n');
}

export function listaPagos(): string {
  return PAGOS_OFRECIDOS.map((c, i) => `${i + 1}. ${FORMAS_PAGO[c]}`).join('\n');
}

export function listaRegimenes(claves: readonly string[]): string {
  return claves.map((c, i) => `${i + 1}. ${REGIMENES.find((r) => r.clave === c)?.nombre ?? c} (${c})`).join('\n');
}

export function datosEnTexto(r: Partial<Receptor>): string {
  const reg = r.regimen ? regimen(r.regimen) : undefined;
  return [
    `• RFC: ${r.rfc ?? '—'}`,
    `• Nombre: ${r.nombre ?? '—'}`,
    `• Código postal: ${r.codigoPostal ?? '—'}`,
    `• Régimen: ${reg ? `${reg.nombre} (${reg.clave})` : '—'}`,
  ].join('\n');
}
