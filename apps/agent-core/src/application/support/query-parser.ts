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
  // Sinónimos que la gente usa de verdad. "invoice" por los que facturan
  // en inglés; "recibo" y "comprobante" porque para el cliente es lo mismo.
  invoice: 'FACTURA',
  invoices: 'FACTURA',
  recibo: 'FACTURA',
  recibos: 'FACTURA',
  comprobante: 'FACTURA',
  comprobantes: 'FACTURA',
  presupuesto: 'COTIZACION',
  presupuestos: 'COTIZACION',
  quote: 'COTIZACION',
  informe: 'REPORTE',
  informes: 'REPORTE',
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
  // "cotizcion", "fatcura": una letra comida no debería costar una llamada
  // al modelo ni un "¿qué documento?".
  if (!category) category = categoriaConErrata(text);

  const parsedPeriod = parsePeriod(text);

  // Folio: patrón alfanumérico con dígito, tipo "A1234" o "F-2026-88".
  // "del0901" no es un folio: es "del" pegado a un número. Las palabras
  // cortas de siempre no cuentan como prefijo.
  const folioMatch = /\b(?:folio\s+)?(?!(?:del|los|las|con|por|una|uno|mes|dia|ano|los|sin)\d)([a-z]{1,3}-?\d{3,}[a-z0-9-]*)\b/.exec(text);
  // "documento 3001", "folio 3001", "el no. 3001": dígitos solos también
  // son folio si van detrás de una palabra que lo diga.
  const folioNumerico = /\b(?:folio|documento|doc|numero|no)\.?\s+(\d{3,})\b/.exec(text);
  // Y un número suelto de 3+ dígitos que no sea año: "factura 277",
  // "tienes la 15904". Se busca en folio y en nombre de archivo.
  const suelto = /\b(?!20\d{2}\b)(\d{3,})\b/.exec(text);
  const folio = folioMatch?.[1] ?? folioNumerico?.[1] ?? suelto?.[1] ?? null;

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

  /**
   * Lo que sobra después de quitar tipo, mes, folio y las palabras de
   * pedir ("necesito", "me pasas") son palabras clave: "la factura de
   * Parcia Ima" → "parcia ima", "el reporte contable de junio" →
   * "contable". Se buscan dentro del nombre Y del contenido del archivo.
   * Sin ningún metadato, el texto completo se conserva para el modelo.
   */
  const hasMetadata = category !== null || parsedPeriod !== null || folio !== null;
  const claves = palabrasClave(text);

  return {
    category,
    period: parsedPeriod,
    folio: folio ? folio.toUpperCase() : null,
    // Con folio no hacen falta palabras clave: el folio ya identifica el
    // documento, y "información de B2001" no debe filtrar por "informacion".
    text: folio ? null : claves.length > 0 ? claves.join(' ') : hasMetadata ? null : raw.trim() || null,
  };
}

/**
 * Palabras que no dicen nada del documento: verbos de pedir, cortesía,
 * conectores, y los términos que ya se leyeron como tipo, mes o folio.
 */
const RUIDO = new Set([
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'oye', 'oiga', 'que', 'tal',
  'necesito', 'quiero', 'quisiera', 'ocupo', 'busco', 'dame', 'mandame', 'pasame', 'enviame',
  'manda', 'pasa', 'envia', 'mandar', 'pasar', 'enviar', 'compartir', 'comparteme', 'tienes',
  'tendras', 'tendra', 'tiene', 'habra', 'hay', 'puedes', 'podrias', 'puede', 'podria',
  'favor', 'porfa', 'porfavor', 'gracias', 'ayuda', 'ayudame', 'apoyo', 'apoyame', 'urgente',
  'urge', 'rapido', 'ahora', 'hoy', 'ayer', 'este', 'esta', 'estos', 'estas', 'ese', 'esa',
  'esos', 'esas', 'aquel', 'aquella', 'mes', 'meses', 'ano', 'anos', 'pasado', 'pasada',
  'anterior', 'actual', 'presente', 'ultimo', 'ultima', 'ultimos', 'ultimas', 'nuevo', 'nueva',
  'del', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'con', 'sin', 'para', 'por', 'como',
  'donde', 'cuando', 'cual', 'cuales', 'quien', 'pero', 'tambien', 'ademas', 'solo', 'nada',
  'algo', 'todo', 'toda', 'todos', 'todas', 'otra', 'otro', 'otras', 'otros', 'misma', 'mismo',
  'documento', 'documentos', 'archivo', 'archivos', 'pdf', 'doc', 'docs', 'papel', 'papeles',
  'copia', 'copias', 'version', 'folio', 'numero', 'num', 'nombre', 'fecha', 'fechas',
  'empresa', 'cliente', 'proveedor', 'correspondiente', 'correspondientes', 'referente',
  'sobre', 'acerca', 'respecto', 'entonces', 'ahi', 'aqui', 'alla', 'bien', 'mal', 'creo',
  'digo', 'dije', 'decia', 'era', 'ser', 'estar', 'estan', 'son', 'fue', 'sea',
  'tengo', 'tenia', 'tenemos', 'vez', 'sirve', 'sirven', 'ver',
  'checar', 'revisar', 'buscar', 'encontrar', 'ubicar', 'localizar', 'mandaste', 'enviaste',
  'pasaste', 'llego', 'recibi', 'faltaba', 'falta', 'faltan', 'igual',
  'porfis', 'porfas', 'jefe', 'jefa', 'amigo', 'amiga', 'compa', 'brother', 'bro', 'rey',
  'okay', 'vale', 'sale', 'listo', 'lista',
  'facturado', 'facturada', 'facturar', 'facturame', 'cotizar', 'cotizado', 'cotizada',
  'reportar', 'contratar', 'asegurar',
  'sino', 'aunque', 'porque', 'hasta', 'desde', 'entre', 'tras', 'segun', 'contra',
  'mio', 'mia', 'mios', 'mias', 'tuyo', 'tuya', 'suyo', 'suya', 'nuestro', 'nuestra',
  'exactamente', 'exacto', 'exacta', 'correcto', 'correcta', 'equivocado', 'equivocada',
  'corresponde', 'coincide', 'diferente', 'distinto', 'distinta',
  'pasas', 'pasarme', 'mandas', 'mandarme', 'envias', 'enviarme', 'das', 'darme', 'dar',
  'sabes', 'sabe', 'saben', 'dices', 'dice', 'crees', 'cree', 'mira', 'checa', 'ves',
  'pueden', 'tienen', 'ocupamos', 'necesitamos', 'queremos', 'quieres', 'quiere',
  'seguro', 'segura', 'verdad', 'cierto', 'claro', 'obvio', 'gracias', 'oye', 'hey',
  'sera', 'seria', 'sean', 'este', 'esta', 'estos', 'estas', 'mio', 'nuestro',
  'alguna', 'alguno', 'algunas', 'algunos', 'cualquier', 'cualquiera', 'ninguna', 'ninguno',
  'informacion', 'info', 'datos', 'dato', 'detalle', 'detalles', 'referencia', 'tipo',
]);

export function palabrasClave(raw: string): string[] {
  const text = normalize(raw);
  const meses = new Set(Object.keys(MONTHS));
  const tipos = new Set(Object.keys(CATEGORY_WORDS));

  return [
    ...new Set(
      text
        .split(/[^a-z0-9ñ]+/)
        .filter((t) => t.length >= 3)
        .filter((t) => !RUIDO.has(t))
        .filter((t) => !meses.has(t) && !tipos.has(t))
        .filter((t) => categoriaConErrata(t) === null)
        // Números: son folios o años, y esos ya se leyeron aparte.
        .filter((t) => !/^\d+$/.test(t)),
    ),
  ].slice(0, 4);
}

/** "cotizcion" → COTIZACION: una letra de diferencia en una palabra larga. */
function categoriaConErrata(text: string): DocCategory | null {
  for (const token of text.split(/[^a-z]+/)) {
    if (token.length < 6) continue;
    for (const [word, value] of Object.entries(CATEGORY_WORDS)) {
      if (word.length < 6) continue;
      if (Math.abs(word.length - token.length) > 1) continue;
      if (distancia(token, word) <= 1) return value;
    }
  }
  return null;
}

function distancia(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length]!;
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
        // Letras y dígitos, pero no un folio ("V3001", "F-2026-88"): eso
        // ya lo lee el patrón de folio y se busca por su campo.
        (/[a-zA-Z]/.test(t) && /\d/.test(t) && !/^[a-zA-Z]{1,3}-?\d{3,}[a-zA-Z0-9-]*$/.test(t)),
    );

  // El más largo: es el más específico, y un LIKE con dos palabras
  // pegadas no casaría con nada.
  return candidatos.sort((a, b) => b.length - a.length)[0] ?? null;
}

function parsePeriod(text: string): Date | null {
  // "este mes", "mes pasado", "mes anterior": no hace falta modelo para esto.
  const now = new Date();
  // Con un mes escrito ("del mes de junio"), ese manda; lo relativo solo
  // cuenta cuando no hay ninguno.
  const mesEscrito = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\b`).test(text);
  if (!mesEscrito) {
    if (/\b(mes pasado|mes anterior|el pasado)\b/.test(text)) {
      const anterior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return period(anterior.getUTCFullYear(), anterior.getUTCMonth() + 1);
    }
    if (/\b(este mes|mes actual|del mes|mes en curso)\b/.test(text)) {
      return period(now.getUTCFullYear(), now.getUTCMonth() + 1);
    }
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
