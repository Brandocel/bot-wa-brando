import { FORMAS_PAGO, REGIMENES, regimen, USOS_CFDI, type UsoCfdi } from './catalogos';
import { normalizarRfc, tipoPersona, type Receptor } from './validacion';
import { esConfirmacion } from '../../domain/message/confirmacion';
import { menciona, numeroDeOpcion, palabras, parecida } from '../../domain/message/texto-flexible';

/**
 * Lo que el cliente escribe durante la plática de factura, leído sin el
 * modelo: son respuestas cortas a preguntas cerradas ("2", "transferencia",
 * "G03", un RFC). Un error aquí factura con datos equivocados, así que lo
 * que no se entiende con certeza se vuelve a preguntar.
 *
 * Los clientes escriben como escriben: "fatura", "tranferencia", "efectibo",
 * "la uno", "zi". Las palabras se comparan tolerando faltas (ver
 * texto-flexible), y al final todo se le enseña en un resumen antes de armar
 * nada: si algo se leyó mal, ahí lo corrige.
 */

function plano(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

const PALABRAS_FACTURA = ['factura', 'facturas', 'facturar', 'facturame', 'facturen', 'facturacion', 'facturado', 'cfdi'];

/** ¿Pide factura? "me la facturas", "nesesito fatura", "requiero CFDI". */
export function pideFactura(texto: string): boolean {
  const ps = palabras(texto);
  const i = ps.findIndex((p) => p.startsWith('factur') || PALABRAS_FACTURA.some((w) => parecida(p, w)));
  if (i < 0) return false;
  // "no necesito factura", "sin factura": las palabras justo antes.
  return !ps.slice(Math.max(0, i - 4), i).some((p) => p === 'no' || p === 'sin' || p === 'nel');
}

export function quiereSalir(texto: string): boolean {
  const ps = palabras(texto);
  const [a, b] = ps;
  if (!a) return false;
  if (a === 'ya' && b === 'no') return true;
  if ((a === 'mejor' || a === 'no') && (b === 'no' || (b && parecida(b, 'gracias')))) return true;
  if (a === 'no' && b && parecida(b, 'quiero') && menciona(ps.slice(2).join(' '), PALABRAS_FACTURA)) return true;
  return ['cancela', 'cancelar', 'cancelalo', 'cancelala', 'olvidalo', 'dejalo', 'salir'].some((w) => parecida(a, w));
}

/** "sí", "si esta bien", "correcto". Lo dudoso NO es un sí. */
export function esSi(texto: string): boolean {
  return esConfirmacion(texto);
}

export function esNo(texto: string): boolean {
  const [a, b] = palabras(texto);
  if (!a) return false;
  if (['no', 'nop', 'nel', 'nou', 'nones'].includes(a)) return true;
  if (['esta', 'estan'].some((w) => parecida(a, w)) && b === 'mal') return true;
  return ['incorrecto', 'incorrectos', 'cambia', 'cambiar', 'corregir', 'corrige', 'equivocado'].some((w) => parecida(a, w));
}

/** Número de opción ("2", "la 2", "opción dos", "el primero", "2️⃣"), o null. */
export function opcion(texto: string, max: number): number | null {
  return numeroDeOpcion(texto, max);
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

const RFC_RE = /\b([A-ZÑ&]{3,4})[\s-]?([\dOoIl]{6})[\s-]?([A-Z\d]{3})\b/i;

/** "EKU9OO317" → "EKU900317": en la fecha solo van números. El dígito verificador revisa el resto. */
function fechaDeRfc(f: string): string {
  return f.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
}

/**
 * RFC, nombre, CP, régimen y correo de un texto libre ("RFC: XAXX..., CP
 * 77500, régimen 612, Juan Pérez"). Lo que no aparece con certeza queda en
 * null y se pregunta aparte; el nombre solo se toma si viene etiquetado o
 * en un renglón propio, porque es lo que más rechaza el SAT.
 */
export function leerDatosEscritos(texto: string): DatosEscritos {
  const rfcM = texto.match(RFC_RE);
  const rfc = rfcM && /\d/.test(rfcM[2]!) ? normalizarRfc(rfcM[1]! + fechaDeRfc(rfcM[2]!) + rfcM[3]!) : null;
  const sinRfc = rfcM ? texto.replace(rfcM[0], ' ') : texto;

  const emailM = sinRfc.match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/);
  const email = emailM ? corregirCorreo(emailM[0]) : null;
  const sinEmail = emailM ? sinRfc.replace(emailM[0], ' ') : sinRfc;

  const cpM = sinEmail.match(/(?:c\.?\s?p\.?|c[oó]d(?:igo)?\.?\s*postal)\s*:?\s*(\d{2}\s?\d{3})\b/i) ?? sinEmail.match(/\b(\d{5})\b/);
  const codigoPostal = cpM ? cpM[1]!.replace(/\s/g, '') : null;

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

/**
 * Régimen por clave ("612") o por nombre ("resico", "rezico", "sueldos y
 * salarios", "asalariado"). Cada regla es un conjunto de palabras que tienen
 * que estar todas, mal escritas o no.
 */
const REGIMEN_POR_PALABRAS: Array<[string, string[][]]> = [
  ['626', [['resico'], ['simplificado', 'confianza']]],
  ['605', [['sueldos'], ['salarios'], ['asalariado'], ['asalariada'], ['nomina']]],
  ['616', [['obligaciones']]],
  ['625', [['plataformas'], ['tecnologicas']]],
  ['612', [['empresariales'], ['empresarial'], ['profesionales'], ['honorarios']]],
  ['606', [['arrendamiento'], ['rentas']]],
  ['601', [['general', 'ley'], ['morales']]],
  ['603', [['lucrativos'], ['lucro']]],
  ['621', [['incorporacion'], ['rif']]],
];

export function leerRegimen(texto: string): string | null {
  const t = plano(texto);
  const clave = t.match(/\b(6[0-2]\d)\b/);
  if (clave && regimen(clave[1]!)) return clave[1]!;
  const ps = palabras(texto);
  const tiene = (w: string) => ps.some((p) => parecida(p, w));
  for (const [reg, reglas] of REGIMEN_POR_PALABRAS) {
    if (reglas.some((r) => r.every(tiene))) return reg;
  }
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
  const t = plano(texto).replace(/\s+/g, '');
  // "g03", "G 03", "g3"
  const clave = t.match(/(?:^|[^a-z])([gids])0?(\d{1,2})(?![\d])/i);
  if (clave) {
    const c = (clave[1]! + clave[2]!.padStart(2, '0')).toUpperCase();
    if (opciones.some((o) => o.clave === c)) return c;
  }
  const disponible = (c: string) => opciones.find((o) => o.clave === c)?.clave ?? null;
  if (menciona(texto, ['gastos', 'gasto', 'general'])) return disponible('G03');
  if (menciona(texto, ['efectos', 'efecto'])) return disponible('S01');
  if (menciona(texto, ['mercancia', 'mercancias'])) return disponible('G01');
  if (menciona(texto, ['medicos', 'medico', 'dentales', 'hospital'])) return disponible('D01');
  if (menciona(texto, ['colegiatura', 'colegiaturas', 'escuela'])) return disponible('D10');
  if (menciona(texto, ['computo', 'computadora'])) return disponible('I04');
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
  if (menciona(texto, ['efectivo', 'cash', 'billetes', 'contado'])) return '01';
  if (menciona(texto, ['transferencia', 'transferi', 'transfer', 'transf', 'spei', 'deposito', 'deposite'])) return '03';
  if (menciona(texto, ['debito'])) return '28';
  if (menciona(texto, ['credito'])) return '04';
  if (menciona(texto, ['tarjeta', 'terminal', 'tdc', 'tdd'])) return 'tarjeta';
  return null;
}

/**
 * "brando @ gmail .com" → "brando@gmail.com"; "gmial.con" → "gmail.com".
 * Se le enseña en el resumen, así que si se corrigió de más, lo ve.
 */
export function corregirCorreo(correo: string): string {
  let c = correo.toLowerCase().replace(/\s+/g, '').replace(/[.,;]+$/, '');
  const [usuario, dominio] = c.split('@');
  if (!usuario || !dominio) return c;
  const partes = dominio.split('.');
  const nombre = partes[0]!;
  const conocidos = ['gmail', 'hotmail', 'outlook', 'yahoo', 'icloud', 'live', 'prodigy'];
  // Un dominio real (mail.com, aol.com) se respeta aunque se parezca a otro.
  const reales = [...conocidos, 'mail', 'aol', 'msn', 'me', 'proton', 'protonmail', 'zoho', 'gmx', 'telmex', 'infinitum'];
  const arreglado = reales.includes(nombre) ? nombre : (conocidos.find((k) => parecida(nombre, k)) ?? nombre);
  const resto = partes.slice(1).map((x) => (x === 'con' || x === 'cmo' || x === 'om' || x === 'co m' ? 'com' : x));
  c = usuario + '@' + [arreglado, ...resto].join('.');
  return c;
}

export function leerCorreo(texto: string): string | 'ninguno' | null {
  const junto = texto.replace(/\s*@\s*/g, '@').replace(/\s*\.\s*(com|mx|net|org|con|edu|gob)\b/gi, '.$1');
  const m = junto.match(/[^\s@,;:]+@[^\s@,;:]+\.[^\s@,;:]+/);
  if (m) return corregirCorreo(m[0]);
  const ps = palabras(texto);
  const [a] = ps;
  if (!a) return null;
  if (['no', 'nop', 'nel', 'nou'].includes(a)) return 'ninguno';
  if (parecida(a, 'ninguno') || parecida(a, 'ninguna')) return 'ninguno';
  if (menciona(texto, ['whatsapp', 'wasap', 'whats', 'aqui']) && !menciona(texto, ['correo', 'mail'])) return 'ninguno';
  if (a === 'sin' || (a === 'no' && ps[1] === 'tengo')) return 'ninguno';
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
