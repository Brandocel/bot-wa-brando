import type { DocCategory } from '@prisma/client';

/**
 * Metadatos a partir del nombre del archivo.
 *
 * La regla dura de §1.3 de la arquitectura vive aquí: si no se puede
 * determinar con certeza qué es un archivo, NO se indexa. Un documento mal
 * clasificado en un sistema de facturas no es un detalle de UX, es una fuga
 * de datos fiscales entre clientes.
 *
 * La organización nunca sale de aquí: sale de la carpeta raíz. Un archivo
 * llamado "FACTURA_POLLOS_2026-02.pdf" que alguien subió por error a la
 * carpeta de otra empresa pertenece a la carpeta, no a su nombre.
 */

export interface ParsedName {
  category: DocCategory | null;
  /** Primer día del mes, en UTC. */
  period: Date | null;
  folio: string | null;
}

const CATEGORY_PATTERNS: [RegExp, DocCategory][] = [
  // Los plurales no son adorno: la carpeta real casi siempre se llama
  // "Facturas", no "Factura", y sin la `s` opcional el \b hace que no case.
  [/\b(facturas?|cfdis?|invoices?)\b/, 'FACTURA'],
  [/\b(contratos?|contracts?)\b/, 'CONTRATO'],
  [/\b(cotizacion|cotizaciones|quotes?)\b/, 'COTIZACION'],
  [/\b(reportes?|reports?|informes?)\b/, 'REPORTE'],
  [/\b(polizas?|seguros?)\b/, 'POLIZA'],
];

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-.]+/g, ' ');
}

export function parseDocumentName(
  fileName: string,
  folderPath: string[] = [],
): ParsedName {
  const text = normalize(fileName);

  /**
   * La categoría puede venir del nombre o de la subcarpeta: una carpeta
   * "Facturas" es una buena señal, y muchos clientes nombran los archivos
   * solo con el folio.
   *
   * Pero el nombre manda sobre la carpeta. Antes se juntaba todo en un
   * solo texto y ganaba el primer patrón de la lista: "Cotizacion_X.pdf"
   * dentro de "Facturas/" quedaba como FACTURA, y el bot la ofrecía como
   * factura. Un archivo mal ubicado sigue siendo lo que dice su nombre.
   */
  let category: DocCategory | null = null;
  for (const fuente of [text, ...folderPath.map(normalize)]) {
    for (const [pattern, value] of CATEGORY_PATTERNS) {
      if (pattern.test(fuente)) {
        category = value;
        break;
      }
    }
    if (category) break;
  }

  return {
    category,
    period: parsePeriod(text),
    folio: parseFolio(text),
  };
}

function parsePeriod(text: string): Date | null {
  // 20260901: fecha pegada, como la ponen los sistemas de facturación.
  const compacta = /\b(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/.exec(text);
  if (compacta) return utcMonth(Number(compacta[1]), Number(compacta[2]));

  // 1782860673094: marca de tiempo en milisegundos (2014–2036). Los CFDI
  // descargados de los portales vienen así, sin mes legible.
  const epoch = /\b(1[4-9]\d{11}|20\d{11})\b/.exec(text);
  if (epoch) {
    const d = new Date(Number(epoch[1]));
    return utcMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }

  // 2026-02 / 2026 02 (el normalize ya convirtió guiones y puntos en espacios)
  const iso = /\b(20\d{2})[ /](0?[1-9]|1[0-2])\b/.exec(text);
  if (iso) return utcMonth(Number(iso[1]), Number(iso[2]));

  // 02 2026
  const reversed = /\b(0?[1-9]|1[0-2])[ /](20\d{2})\b/.exec(text);
  if (reversed) return utcMonth(Number(reversed[2]), Number(reversed[1]));

  // "febrero 2026"
  for (const [name, month] of Object.entries(MONTHS)) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
    const year = /\b(20\d{2})\b/.exec(text);
    if (year) return utcMonth(Number(year[1]), month);
  }

  // Solo el año: sirve para contratos y pólizas, que no son mensuales.
  const onlyYear = /\b(20\d{2})\b/.exec(text);
  if (onlyYear) return utcMonth(Number(onlyYear[1]), 1);

  return null;
}

function parseFolio(text: string): string | null {
  // "folio A1234" gana sobre cualquier heurística: es explícito.
  const explicit = /\bfolio ([a-z0-9]{2,}[a-z0-9-]*)\b/.exec(text);
  if (explicit) return explicit[1]!.toUpperCase();

  // Letras + dígitos pegados: A1234, B2001, V3001. Se excluye lo que parezca
  // un año suelto para no confundir "2026" con un folio.
  const pattern = /\b([a-z]{1,3}\d{3,}[a-z0-9]*)\b/.exec(text);
  if (pattern) return pattern[1]!.toUpperCase();

  // Un número suelto de 4 o más dígitos que no sea fecha ni marca de
  // tiempo: "factura_15904_1778770514351" tiene folio 15904.
  for (const m of text.matchAll(/\b(\d{4,})\b/g)) {
    const n = m[1]!;
    if (/^20\d{2}$/.test(n)) continue; // año
    if (/^20\d{6}$/.test(n)) continue; // yyyymmdd
    if (n.length === 13) continue; // epoch ms
    return n;
  }
  return null;
}

function utcMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * ¿Es entregable? Solo formatos que WhatsApp muestra bien y que podemos
 * clasificar. Los Google Docs nativos quedan fuera: no tienen bytes que
 * descargar sin exportarlos primero.
 */
export function isDeliverable(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('image/') ||
    mimeType === 'text/plain' ||
    mimeType === 'text/csv' ||
    mimeType.startsWith('application/vnd.openxmlformats-officedocument') ||
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.ms-excel'
  );
}
