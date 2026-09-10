import { Inject, Injectable } from '@nestjs/common';
import type { DocCategory } from '@prisma/client';
import { z } from 'zod';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import type { SearchQuery } from './document-search.service';
import { parseQuery } from './query-parser';

/**
 * Extracción de slots: primero reglas, el modelo solo cuando hacen falta.
 *
 * "Factura de febrero 2026" es un patrón, no una tarea de comprensión. El
 * parser determinista la resuelve gratis y en microsegundos. El LLM entra
 * para lo que ese parser no alcanza — "la de la luz del mes pasado",
 * "mándame lo del contrato que firmamos" — y su salida se valida contra la
 * MISMA forma, así que nada río abajo distingue de dónde salieron los slots.
 *
 * El modelo no ve documentos ni permisos. Solo convierte una frase en
 * campos. Es todo lo que puede hacer y es a propósito.
 */

const CATEGORIES = [
  'FACTURA',
  'CONTRATO',
  'COTIZACION',
  'REPORTE',
  'POLIZA',
  'OTRO',
] as const;

const ExtractedSlots = z.object({
  categoria: z.enum([...CATEGORIES, 'NINGUNA']),
  /** "2026-02", o "NINGUNO". Nunca una fecha completa. */
  periodo: z.string(),
  folio: z.string(),
  /** Nombre de empresa si lo mencionó; "NINGUNA" si no. */
  empresa: z.string(),
  /** true = el mensaje no es una petición de documento. */
  no_es_documento: z.boolean(),
});

const SCHEMA = {
  type: 'object',
  properties: {
    categoria: { type: 'string', enum: [...CATEGORIES, 'NINGUNA'] },
    periodo: {
      type: 'string',
      description: 'Mes en formato YYYY-MM, o "NINGUNO" si no lo dice.',
    },
    folio: { type: 'string', description: 'Folio o número de documento, o "NINGUNO".' },
    empresa: { type: 'string', description: 'Empresa mencionada, o "NINGUNA".' },
    no_es_documento: {
      type: 'boolean',
      description: 'true si el mensaje no pide ningún documento.',
    },
  },
  required: ['categoria', 'periodo', 'folio', 'empresa', 'no_es_documento'],
  additionalProperties: false,
};

export interface ExtractionResult {
  query: SearchQuery;
  /** Empresa mencionada en el texto, para desambiguar. */
  companyHint: string | null;
  /** true = no pedía un documento; hay que responder otra cosa. */
  notADocumentRequest: boolean;
  /** De dónde salieron los slots. Solo para logs y depuración. */
  source: 'reglas' | 'modelo' | 'ninguno';
}

@Injectable()
export class SlotExtractorService {
  constructor(@Inject(LLM_PORT) private readonly llm: LlmPort) {}

  async extract(text: string, today = new Date()): Promise<ExtractionResult> {
    const byRules = parseQuery(text);

    // Con categoría Y periodo el parser ya resolvió: no se llama al modelo.
    // Esta rama es la que hace que el bot sea barato en el caso común.
    if (byRules.category && byRules.period) {
      return {
        query: byRules,
        companyHint: null,
        notADocumentRequest: false,
        source: 'reglas',
      };
    }

    const extracted = await this.llm.extract({
      system: systemPrompt(today),
      user: text,
      schema: SCHEMA,
      validate: (value) => {
        const parsed = ExtractedSlots.safeParse(value);
        return parsed.success ? parsed.data : null;
      },
    });

    if (!extracted) {
      // El modelo falló o no está configurado. Lo que sacaron las reglas es
      // mejor que nada, y si tampoco alcanza, quien llama va a preguntar.
      return {
        query: byRules,
        companyHint: null,
        notADocumentRequest: false,
        source: 'ninguno',
      };
    }

    return {
      query: {
        category: toCategory(extracted.categoria) ?? byRules.category,
        period: toPeriod(extracted.periodo) ?? byRules.period,
        folio: toValue(extracted.folio)?.toUpperCase() ?? byRules.folio,
        text: null,
      },
      companyHint: toValue(extracted.empresa),
      notADocumentRequest: extracted.no_es_documento,
      source: 'modelo',
    };
  }
}

function systemPrompt(today: Date): string {
  const iso = today.toISOString().slice(0, 10);

  return [
    'Extraes datos de mensajes de WhatsApp que piden documentos a una empresa.',
    `Hoy es ${iso}.`,
    '',
    'Reglas:',
    '- "el mes pasado", "este mes" y similares se resuelven contra la fecha de hoy.',
    '- Si el mes no lleva año, usa el más reciente que ya haya ocurrido.',
    '- No inventes: lo que el mensaje no diga, va como NINGUNO o NINGUNA.',
    '- "recibo", "nota" y "comprobante" cuentan como FACTURA.',
    '- Un saludo, una queja o una pregunta general llevan no_es_documento en true.',
  ].join('\n');
}

function toValue(raw: string): string | null {
  const clean = raw.trim();
  if (!clean || /^(ninguno|ninguna|null|n\/a)$/i.test(clean)) return null;
  return clean;
}

function toCategory(raw: string): DocCategory | null {
  const value = toValue(raw);
  if (!value) return null;
  return (CATEGORIES as readonly string[]).includes(value)
    ? (value as DocCategory)
    : null;
}

function toPeriod(raw: string): Date | null {
  const value = toValue(raw);
  if (!value) return null;

  const match = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;

  // UTC y primer día del mes: la misma convención con la que el
  // sincronizador escribe Document.period. Si las dos no coinciden, la
  // búsqueda exacta no encuentra nada y el bug es invisible.
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}
