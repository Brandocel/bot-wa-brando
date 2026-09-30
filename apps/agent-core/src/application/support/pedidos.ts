import type { SearchQuery } from './document-search.service';
import { palabrasClave, parseQuery } from './query-parser';

/**
 * Varios documentos en un solo mensaje.
 *
 * "Pásame la factura de octubre y noviembre con la de septiembre", "las
 * facturas de octubre a diciembre", "todas las de Oxxo y McDonald's". Antes
 * el mensaje se leía como UNA búsqueda: se quedaba con el primer mes del
 * calendario y callaba los demás, o juntaba "oxxo macdonald" en una sola
 * búsqueda que ningún archivo cumplía.
 *
 * Aquí el mensaje se parte en pedidos. Cada trozo (separado por comas,
 * "y", "con", "también") se lee con el mismo parser de siempre, y lo que se
 * dijo una sola vez —el tipo, el año— vale para todos: "la factura de
 * octubre y noviembre" son dos facturas.
 */

export interface VariosPedidos {
  /** En el orden en que conviene entregarlos. */
  pedidos: SearchQuery[];
  /** "todas", "todos": de cada pedido se quiere todo lo que haya. */
  todas: boolean;
}

/** Más que esto en un mensaje ya no es una petición: se pide acotar. */
export const MAX_PEDIDOS = 12;

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MES = `(${Object.keys(MESES).join('|')})`;

/** Conectores que separan un pedido de otro. */
const SEPARADOR = /\s*(?:[,;]|\s+y\s+|\s+e\s+|\s+con\s+|\s+tambien\s+|\s+ademas\s+|\s+mas\s+)\s*/;

/** Palabras que acompañan una lista sin ser parte de lo que se busca. */
const SIN_VALOR = new Set([
  'orden', 'ordenadas', 'ordenados', 'seguidas', 'seguidos', 'juntas', 'juntos',
  'cada', 'respectivas', 'respectivos', 'siguiente', 'siguientes',
]);

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function mesUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Sin año, el mes más reciente que ya ocurrió (igual que el parser). */
function anioProbable(month: number, hoy = new Date()): number {
  return month <= hoy.getUTCMonth() + 1 ? hoy.getUTCFullYear() : hoy.getUTCFullYear() - 1;
}

/**
 * null = es un solo pedido (o ninguno) y sigue el camino de siempre.
 */
export function dividirPedidos(raw: string, hoy = new Date()): VariosPedidos | null {
  const texto = normalizar(raw);
  if (texto.length === 0 || texto.length > 400) return null;

  // Una corrección no es una lista: "no era febrero, era marzo" pide marzo.
  if (/\bno (?:es|era|son|eran)\b/.test(texto)) return null;

  const todas = /\b(todas|todos)\b/.test(texto);
  const anios = [...new Set(texto.match(/\b20\d{2}\b/g) ?? [])];
  const anioUnico = anios.length === 1 ? Number(anios[0]) : null;

  const rango = leerRango(texto, anioUnico, hoy);
  if (rango) {
    // El resto del mensaje (tipo, palabras clave) vale para todos los meses.
    const base = parseQuery(texto.replace(rango.frase, ' '));
    const pedidos = rango.periodos.map((period) => ({
      category: base.category,
      period,
      folio: null,
      text: base.folio ? null : claves(texto.replace(rango.frase, ' ')),
    }));
    return pedidos.length >= 2 ? { pedidos, todas } : null;
  }

  const trozos = texto.split(SEPARADOR).filter((t) => t.trim() !== '');
  if (trozos.length < 2) return null;

  const leidos = trozos.map((trozo) => {
    const q = parseQuery(trozo);
    let period = q.period;
    // "octubre y noviembre de 2025": el año dicho una vez es de todos.
    if (period && !/\b20\d{2}\b/.test(trozo) && anioUnico) {
      period = mesUTC(anioUnico, period.getUTCMonth() + 1);
    }
    return {
      category: q.category,
      period,
      folio: q.folio,
      text: q.folio ? null : claves(trozo),
    };
  });

  // Lo que distingue a un pedido de otro. Un trozo sin nada de esto ("por
  // favor", "gracias") no es un pedido.
  const distintos = (campo: 'period' | 'folio' | 'text' | 'category') =>
    new Set(leidos.map((l) => valor(l[campo])).filter((v) => v !== null)).size;

  const variaAlgo =
    distintos('period') >= 2 || distintos('folio') >= 2 || distintos('text') >= 2 || distintos('category') >= 2;
  if (!variaAlgo) return null;

  // Lo que se dijo en un trozo se hereda hacia adelante: "la factura de
  // octubre y noviembre" → noviembre también es factura.
  const pedidos: SearchQuery[] = [];
  let anterior: SearchQuery | null = null;
  for (const l of leidos) {
    const aporta = l.period !== null || l.folio !== null || l.text !== null || l.category !== null;
    if (!aporta) continue;

    const actual: SearchQuery = {
      category: l.category ?? (l.folio ? null : anterior?.category ?? null),
      period: l.period ?? (l.folio || l.text ? null : anterior?.period ?? null),
      folio: l.folio,
      // "la de Pollos Pirata de octubre y noviembre": noviembre también.
      text: l.text ?? (l.folio ? null : anterior?.text ?? null),
    };
    pedidos.push(actual);
    anterior = actual;
  }

  // Y hacia atrás lo que solo apareció al final: "facturas y contratos de
  // octubre" → las facturas también son de octubre.
  const unico = <K extends keyof SearchQuery>(campo: K): SearchQuery[K] | null => {
    const valores = [...new Map(pedidos.filter((p) => p[campo] !== null).map((p) => [valor(p[campo]), p[campo]])).values()];
    return valores.length === 1 ? (valores[0] as SearchQuery[K]) : null;
  };
  const categoria = unico('category');
  const periodo = unico('period');
  for (const p of pedidos) {
    if (!p.category && !p.folio && categoria) p.category = categoria;
    if (!p.period && !p.folio && periodo) p.period = periodo;
  }

  const sinRepetir = [...new Map(pedidos.map((p) => [clave(p), p])).values()];
  if (sinRepetir.length < 2) return null;

  // "En orden": por mes, del más viejo al más nuevo, cuando todos lo traen.
  if (sinRepetir.every((p) => p.period)) {
    sinRepetir.sort((a, b) => a.period!.getTime() - b.period!.getTime());
  }

  return { pedidos: sinRepetir.slice(0, MAX_PEDIDOS), todas };
}

/** "de octubre a diciembre", "desde enero hasta marzo", "entre enero y marzo". */
function leerRango(
  texto: string,
  anioUnico: number | null,
  hoy: Date,
): { frase: string; periodos: Date[] } | null {
  const m =
    new RegExp(`\\b(?:de|del|desde)\\s+(?:el\\s+mes\\s+de\\s+)?${MES}(?:\\s+(?:de\\s+)?(20\\d{2}))?\\s+(?:a|al|hasta)\\s+(?:el\\s+mes\\s+de\\s+)?${MES}(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`).exec(texto) ??
    new RegExp(`\\bentre\\s+${MES}(?:\\s+(?:de\\s+)?(20\\d{2}))?\\s+y\\s+${MES}(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`).exec(texto);
  if (!m) return null;

  const mesIni = MESES[m[1]!]!;
  const mesFin = MESES[m[3]!]!;
  let anioFin = m[4] ? Number(m[4]) : anioUnico ?? anioProbable(mesFin, hoy);
  let anioIni = m[2] ? Number(m[2]) : mesIni <= mesFin ? anioFin : anioFin - 1;
  // "de noviembre a febrero" sin años cruza el cambio de año.
  if (!m[2] && !m[4] && !anioUnico && mesIni > mesFin) {
    anioIni = anioProbable(mesFin, hoy) - 1;
    anioFin = anioIni + 1;
  }

  const periodos: Date[] = [];
  let y = anioIni;
  let mes = mesIni;
  while ((y < anioFin || (y === anioFin && mes <= mesFin)) && periodos.length < MAX_PEDIDOS) {
    periodos.push(mesUTC(y, mes));
    mes += 1;
    if (mes > 12) { mes = 1; y += 1; }
  }
  return periodos.length >= 2 ? { frase: m[0], periodos } : null;
}

function claves(trozo: string): string | null {
  const palabras = palabrasClave(trozo).filter((p) => !SIN_VALOR.has(p));
  return palabras.length > 0 ? palabras.join(' ') : null;
}

function valor(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function clave(p: SearchQuery): string {
  return [p.category, valor(p.period), p.folio, p.text].join('|');
}

/**
 * Varios números de una lista: "la 1 y la 2", "1, 3", "las dos", "ambas",
 * "todas". Devuelve 'todas' o los números (al menos dos), o null.
 */
export function leerVariasOpciones(raw: string): number[] | 'todas' | null {
  const texto = normalizar(raw).replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const palabras = texto.split(' ').filter(Boolean);
  if (palabras.length === 0 || palabras.length > 10) return null;

  // Con tipo, mes o folio es una petición, no una elección.
  if (new RegExp(`\\b(factura|contrato|cotizacion|reporte|poliza|${MES.slice(1, -1)}|20\\d\\d)\\b`).test(texto)) return null;
  if (/\b[a-z]{1,3}\d{3,}\b/.test(texto)) return null;

  if (/^(?:(?:dame|mandame|pasame|enviame|quiero|me das|me pasas|me mandas)\s+)?(?:las|los)?\s*(?:dos|ambas|ambos|todas|todos|las dos|los dos)(?:\s+(?:por favor|porfa|plis|gracias))?$/.test(texto)) {
    return /\b(dos|ambas|ambos)\b/.test(texto) ? [1, 2] : 'todas';
  }

  const ORDINALES: Record<string, number> = {
    primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3,
    cuarto: 4, cuarta: 4, quinto: 5, quinta: 5,
    uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  };
  const numeros = palabras
    .map((p) => (/^[1-9]$/.test(p) ? Number(p) : ORDINALES[p] ?? null))
    .filter((n): n is number => n !== null);

  const unicos = [...new Set(numeros)];
  return unicos.length >= 2 ? unicos : null;
}
