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

  // La categoría puede venir del nombre o de la subcarpeta: una carpeta
  // "Facturas" es una señal tan buena como el prefijo del archivo, y muchos
  // clientes nombran los archivos solo con el folio.
  const haystack = [text, ...folderPath.map(normalize)].join(' ');

  let category: DocCategory | null = null;
  for (const [pattern, value] of CATEGORY_PATTERNS) {
    if (pattern.test(haystack)) {
      category = value;
      break;
    }
  }

  return {
    category,
    period: parsePeriod(text),
    folio: parseFolio(text),
  };
}

function parsePeriod(text: string): Date | null {
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
  return pattern ? pattern[1]!.toUpperCase() : null;
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
