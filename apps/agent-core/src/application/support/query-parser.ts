import type { DocCategory } from '@prisma/client';
import type { SearchQuery } from './document-search.service';

/**
 * Extracción de slots SIN LLM.
 *
 * "Factura de febrero 2026" es un patrón, no una tarea de comprensión. Este
 * parser cubre la mayoría de las consultas reales y cuesta cero. El LLM entra
 * después, solo para lo que esto no logra resolver, y su salida se valida
 * contra esta misma forma — así el resto del sistema no distingue de dónde
 * vinieron los slots.
 */

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

const CATEGORY_WORDS: Record<string, DocCategory> = {
  factura: 'FACTURA',
  facturas: 'FACTURA',
  cfdi: 'FACTURA',
  contrato: 'CONTRATO',
  contratos: 'CONTRATO',
  cotizacion: 'COTIZACION',
  cotizaciones: 'COTIZACION',
  reporte: 'REPORTE',
  reportes: 'REPORTE',
  poliza: 'POLIZA',
  polizas: 'POLIZA',
};

/** Sin acentos y en minúsculas: "Póliza" y "poliza" son la misma palabra. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Periodo en UTC y al primer día del mes. Es la misma convención con la que
 * el sincronizador escribe `Document.period`; si las dos no coinciden, la
 * búsqueda exacta no encuentra nada y el bug es invisible.
 */
function period(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function parseQuery(raw: string): SearchQuery {
  const text = normalize(raw.trim());

  let category: DocCategory | null = null;
  for (const [word, value] of Object.entries(CATEGORY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      category = value;
      break;
    }
  }

  const parsedPeriod = parsePeriod(text);

  // Folio: patrón alfanumérico con dígito, tipo "A1234" o "F-2026-88".
  const folioMatch = /\b(?:folio\s+)?([a-z]{1,3}-?\d{3,}[a-z0-9-]*)\b/.exec(text);
  // "documento 3001", "folio 3001", "el no. 3001": dígitos solos también
  // son folio si van detrás de una palabra que lo diga.
  const folioNumerico = /\b(?:folio|documento|doc|numero|no)\.?\s+(\d{3,})\b/.exec(text);
  const folio = folioMatch?.[1] ?? folioNumerico?.[1] ?? null;

  /**
   * Un nombre de archivo, o algo que lo parece, vale más que cualquier
   * metadato: "la cotización BrandoCelSanchez_2026" identifica UN archivo.
   * Antes, con categoría detectada, el nombre se tiraba y la búsqueda se
   * hacía por tipo y mes heredado — y no encontraba nada.
   */
  const nameHint = nombreDeArchivo(raw);
  if (nameHint) {
    return {
      category,
      period: parsedPeriod,
      folio: folio ? folio.toUpperCase() : null,
      text: nameHint,
    };
  }

  // Texto libre solo si no hubo ningún metadato: si ya sabemos categoría y
  // periodo, agregar un LIKE sobre el nombre solo puede quitar resultados
  // correctos.
  const hasMetadata = category !== null || parsedPeriod !== null || folio !== null;

  return {
    category,
    period: parsedPeriod,
    folio: folio ? folio.toUpperCase() : null,
    text: hasMetadata ? null : raw.trim() || null,
  };
}

/**
 * ¿Trae algo que parece nombre de archivo? Guion bajo, CamelCase, letras
 * pegadas a dígitos ("Cotizacion_Vega_2026", "BrandoCelSanchez", "fact0226").
 * Se devuelve tal cual lo escribió, sin la extensión: es lo que se va a
 * buscar dentro del nombre real.
 */
export function nombreDeArchivo(raw: string): string | null {
  const candidatos = raw
    .split(/\s+/)
    .map((t) => t.replace(/[",;:()¿?¡!]/g, '').replace(/\.(pdf|docx?|xlsx?|jpe?g|png)$/i, ''))
    .filter((t) => t.length >= 6)
    .filter(
      (t) =>
        t.includes('_') ||
        /[a-z][A-Z]/.test(t) ||
        (/[a-zA-Z]/.test(t) && /\d/.test(t) && !/^[a-zA-Z]{1,3}-?\d+$/.test(t)),
    );

  // El más largo: es el más específico, y un LIKE con dos palabras
  // pegadas no casaría con nada.
  return candidatos.sort((a, b) => b.length - a.length)[0] ?? null;
}

function parsePeriod(text: string): Date | null {
  // "este mes", "mes pasado", "mes anterior": no hace falta modelo para esto.
  const now = new Date();
  if (/\b(este mes|mes actual|del mes)\b/.test(text)) {
    return period(now.getUTCFullYear(), now.getUTCMonth() + 1);
  }
  if (/\b(mes pasado|mes anterior|el pasado)\b/.test(text)) {
    const anterior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return period(anterior.getUTCFullYear(), anterior.getUTCMonth() + 1);
  }

  // 2026-02 o 2026/02
  const iso = /\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/.exec(text);
  if (iso) return period(Number(iso[1]), Number(iso[2]));

  // 02/2026
  const slash = /\b(0?[1-9]|1[0-2])[-/](20\d{2})\b/.exec(text);
  if (slash) return period(Number(slash[2]), Number(slash[1]));

  // "febrero 2026", "febrero de 2026", o "febrero" a secas
  for (const [name, month] of Object.entries(MONTHS)) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;

    const year = /\b(20\d{2})\b/.exec(text);
    if (year) return period(Number(year[1]), month);

    // Sin año: el mes más reciente que ya ocurrió. Pedir "la factura de
    // febrero" en marzo de 2026 nunca significa febrero de 2027.
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const guessed = month <= now.getUTCMonth() + 1 ? currentYear : currentYear - 1;
    return period(guessed, month);
  }

  return null;
}
