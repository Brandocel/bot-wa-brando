import { REGIMENES } from './catalogos';
import { normalizarNombre, normalizarRfc, tipoPersona } from './validacion';

/**
 * Datos fiscales a partir del texto de la Constancia de Situación Fiscal.
 *
 * Es la fuente buena: el SAT compara el CFDI 4.0 contra exactamente lo que
 * dice este documento. Pedírselo al cliente evita que dicte el nombre "como
 * se acuerda" y la factura rebote.
 *
 * El texto llega de pdf-parse, que pega etiqueta y valor sin espacio
 * ("Código Postal:06600Tipo de Vialidad:") y parte renglones a su modo, así
 * que cada patrón tolera las dos formas.
 */

export interface DatosConstancia {
  rfc: string | null;
  nombre: string | null;
  codigoPostal: string | null;
  /** Regímenes vigentes, en el orden en que aparecen. Los que tienen fecha de fin se omiten. */
  regimenes: string[];
}

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Valor de una etiqueta hasta el fin de renglón o la siguiente etiqueta conocida. */
function campo(texto: string, etiqueta: string, siguientes: string[]): string | null {
  const corte = siguientes.length ? `(?=${siguientes.join('|')}|\\n|$)` : '(?=\\n|$)';
  const m = texto.match(new RegExp(`${etiqueta}\\s*:?\\s*([^\\n]*?)\\s*${corte}`, 'i'));
  const v = m?.[1]?.trim();
  return v ? v : null;
}

export function esConstancia(texto: string): boolean {
  const t = sinAcentos(texto).toUpperCase();
  return /CONSTANCIA DE SITUACION FISCAL|CEDULA DE IDENTIFICACION FISCAL/.test(t);
}

export function leerConstancia(texto: string): DatosConstancia {
  const t = texto.replace(/\r/g, '');
  const plano = sinAcentos(t);

  const rfcM = plano.match(/RFC\s*:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})\b/i);
  const rfc = rfcM ? normalizarRfc(rfcM[1]!) : null;
  const tipo = rfc ? tipoPersona(rfc) : null;

  let nombre: string | null = null;
  const razon = campo(plano, 'Denominacion\\s*/?\\s*Razon\\s+Social', ['Regimen\\s+Capital', 'Nombre\\s+Comercial']);
  if (razon) {
    nombre = normalizarNombre(razon, 'moral');
  } else {
    const nombres = campo(plano, 'Nombre\\s*\\(s\\)', ['Primer\\s+Apellido']);
    const primero = campo(plano, 'Primer\\s+Apellido', ['Segundo\\s+Apellido']);
    const segundo = campo(plano, 'Segundo\\s+Apellido', ['Fecha\\s+(de\\s+)?inicio', 'Estatus']);
    const partes = [nombres, primero, segundo].filter((p): p is string => !!p);
    if (nombres && primero) nombre = normalizarNombre(partes.join(' '), tipo ?? 'fisica');
  }

  const cpM = plano.match(/Codigo\s+Postal\s*:?\s*(\d{5})/i);

  return { rfc, nombre, codigoPostal: cpM?.[1] ?? null, regimenes: regimenesVigentes(plano) };
}

/**
 * Busca los nombres del catálogo dentro de la sección "Regímenes". Un
 * renglón con dos fechas es un régimen que ya terminó (fecha de inicio y
 * de fin) y no cuenta.
 */
function regimenesVigentes(plano: string): string[] {
  const inicio = plano.search(/Regimenes\s*:?/i);
  if (inicio < 0) return [];
  const resto = plano.slice(inicio);
  const fin = resto.search(/Obligaciones\s*:?/i);
  const seccion = (fin > 0 ? resto.slice(0, fin) : resto).toLowerCase();

  // Los nombres largos primero: "actividades empresariales con ingresos a
  // través de plataformas tecnológicas" contiene "actividades empresariales".
  const catalogo = [...REGIMENES]
    .map((r) => ({ clave: r.clave, nombre: sinAcentos(r.nombre).toLowerCase().replace(/^regimen (de )?(los |las )?/, '') }))
    .sort((a, b) => b.nombre.length - a.nombre.length);

  const encontrados: string[] = [];
  for (const renglon of seccion.split('\n')) {
    const r = renglon.replace(/\s+/g, ' ');
    const fechas = r.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
    if (fechas.length >= 2) continue;
    const c = catalogo.find((c) => r.includes(c.nombre));
    if (c && !encontrados.includes(c.clave)) encontrados.push(c.clave);
  }
  return encontrados;
}
