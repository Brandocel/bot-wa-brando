import { Inject, Injectable } from '@nestjs/common';
import type { DocCategory } from '@prisma/client';
import { z } from 'zod';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import type { SearchQuery } from './document-search.service';
import { formatHistory, type HistoryTurn } from './conversation-history.service';
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

/** El dato que el bot acaba de pedir, si la respuesta viene a eso. */
export type SlotPendiente = 'categoria' | 'periodo' | 'empresa';

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

  async extract(
    text: string,
    options: {
      pendiente?: SlotPendiente | null;
      today?: Date;
      /** Mensajes anteriores del hilo. Solo contexto: no se extrae de ahí. */
      history?: readonly HistoryTurn[];
      /** Lo que la solicitud en curso ya tiene resuelto, en texto. */
      known?: readonly string[];
      /** Hay una solicitud a medias (tipo, mes o folio ya dichos). */
      enCurso?: boolean;
      /** La empresa ya se reconoció en el texto por reglas (sin modelo). */
      companyKnown?: boolean;
    } = {},
  ): Promise<ExtractionResult> {
    const today = options.today ?? new Date();
    const pendiente = options.pendiente ?? null;
    const byRules = parseQuery(text);

    /**
     * Cuándo las reglas bastan y NO se llama al modelo.
     *
     * Es la rama que hace barato al bot: cada llamada al modelo cuesta
     * tokens y segundos de "escribiendo...". Se evita siempre que el texto
     * ya diga algo que el flujo puede usar tal cual:
     *
     *  - Un tipo de documento o un folio: con eso ya se busca. Lo que
     *    falte (el mes) se resuelve enseñando lo que hay o preguntando.
     *  - Un mes, si hay una solicitud en curso: "y la de marzo" es la
     *    misma factura de otro mes, no hace falta que nadie lo interprete.
     *  - La respuesta a lo que el bot acaba de preguntar, cuando las
     *    reglas ya la leyeron: "febrero" tras "¿de qué mes?", o el nombre
     *    de una empresa tras "¿de cuál?".
     *
     * El modelo queda para lo que de verdad necesita comprensión: "la de
     * la luz del mes pasado", "lo del contrato que firmamos", y para
     * distinguir charla de petición.
     */
    const enCurso = options.enCurso === true;

    const resueltoPorReglas =
      byRules.category !== null ||
      byRules.folio !== null ||
      (byRules.period !== null && (enCurso || pendiente === 'periodo')) ||
      (pendiente === 'empresa' && options.companyKnown === true);

    if (resueltoPorReglas) {
      return {
        // El nombre de la empresa no es texto para filtrar archivos.
        query: { ...byRules, text: pendiente === 'empresa' ? null : byRules.text },
        companyHint: null,
        notADocumentRequest: false,
        source: 'reglas',
      };
    }

    const extracted = await this.llm.extract({
      system: systemPrompt(
        today,
        pendiente,
        options.history ?? [],
        options.known ?? [],
      ),
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

/**
 * Lo que se le explica al modelo. Si el bot acaba de hacer una pregunta, se
 * le dice cuál: "de este" después de "¿de qué mes?" es un periodo, y
 * "contrucora vega" después de "¿de qué empresa?" es una empresa, aunque
 * sueltos no parezcan pedir ningún documento. Sin ese contexto el modelo
 * los marcaba como charla y la conversación volvía a empezar.
 */
function systemPrompt(
  today: Date,
  pendiente: SlotPendiente | null,
  history: readonly HistoryTurn[],
  known: readonly string[],
): string {
  const iso = today.toISOString().slice(0, 10);

  const contexto = {
    categoria:
      '- El bot acaba de preguntar QUÉ TIPO de documento. El mensaje es esa respuesta (categoria); no es charla.',
    periodo:
      '- El bot acaba de preguntar DE QUÉ MES. El mensaje es esa respuesta (periodo); no es charla.',
    empresa:
      '- El bot acaba de preguntar DE QUÉ EMPRESA. El mensaje es esa respuesta (empresa, aunque traiga erratas); no es charla.',
  };

  /**
   * Corto a propósito: cada línea se paga en cada mensaje que llega al
   * modelo. La conversación va como contexto, no como fuente: "y la de
   * marzo" tras pedir una factura es una FACTURA de marzo, y "mejor la
   * cotización" cambia de tipo; sin ver el hilo el modelo no lo distingue.
   * Pero solo se extrae del último mensaje: lo que ya se sabía vive en el
   * ticket y se fusiona después, no aquí.
   */
  return [
    `Extraes datos del último mensaje de un cliente que pide documentos por WhatsApp. Hoy es ${iso}.`,
    '- Fechas relativas ("mes pasado") contra hoy; mes sin año = el más reciente ya ocurrido.',
    '- Lo que el mensaje no diga: NINGUNO/NINGUNA. No inventes.',
    '- recibo, nota, comprobante = FACTURA. "documento"/"archivo" a secas = NINGUNA.',
    '- Saludo, queja o pregunta general: no_es_documento true. Seguir con la misma solicitud ("y la de marzo", "sí, esa"): false.',
    ...(pendiente ? [contexto[pendiente]] : []),
    ...(history.length > 0 ? ['', 'Conversación previa (solo contexto):', formatHistory(history)] : []),
    ...(known.length > 0 ? ['', 'Ya se sabe (no lo repitas si el mensaje no lo dice):', ...known.map((k) => `- ${k}`)] : []),
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
