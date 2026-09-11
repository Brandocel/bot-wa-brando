import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import type { OrgScope } from './access-scope.service';
import { formatHistory, type HistoryTurn } from './conversation-history.service';

/**
 * Redacción con modelo, solo para lo que no tiene plantilla.
 *
 * Preguntas, entregas, listas y escalados salen de plantillas que ya
 * conocen el contexto (tipo, mes, si es la segunda entrega del hilo):
 * cuestan cero. Aquí llega únicamente la charla libre —"¿qué me
 * mandaste?", "¿quién eres?", "¿me ayudas con otra cosa?"— donde una
 * plantilla sonaría a contestador. El modelo ve la conversación reciente
 * para no saludar dos veces ni preguntar lo que ya se dijo.
 *
 * Lo que el modelo NO puede hacer: cambiar el fondo. Recibe los hechos ya
 * resueltos y una lista de literales que su texto tiene que contener (el
 * folio, sobre todo). Si el borrador no los trae, o se pasa de largo, o
 * mete un enlace, se descarta y sale el texto fijo que quien llama dejó
 * preparado. Sin modelo configurado sale ese mismo texto: el bot nunca se
 * queda callado por culpa de la redacción.
 */

export interface ReplyBrief {
  /** Qué está haciendo el bot en este turno. Guía el tono. */
  intent: 'charla';
  /** Qué tiene que transmitir, en frases sueltas. El modelo lo redacta. */
  facts: readonly string[];
  /** Literales que el texto DEBE contener, tal cual. */
  mustInclude?: readonly string[];
  /** Texto fijo, siempre válido. Sale si el modelo falla o se desvía. */
  fallback: string;
  /** Tope de caracteres del borrador; por encima se descarta. */
  maxChars?: number;
}

export interface ReplyContext {
  history: readonly HistoryTurn[];
  /** El mensaje que se está contestando. */
  incoming: string;
  scopes: readonly OrgScope[];
  /** Lo que ya se sabe de la solicitud en curso, en texto. */
  known?: readonly string[];
}

const MAX_CHARS_DEFAULT = 420;

@Injectable()
export class ReplyWriterService {
  private readonly logger = new Logger(ReplyWriterService.name);

  constructor(@Inject(LLM_PORT) private readonly llm: LlmPort) {}

  async write(brief: ReplyBrief, ctx: ReplyContext): Promise<string> {
    const drafted = await this.llm.draft({
      system: persona(ctx),
      user: instruction(brief),
      maxTokens: 150,
    });

    const text = drafted?.trim() ?? '';
    const problema = validar(text, brief);

    if (problema) {
      if (drafted) this.logger.debug(`borrador descartado (${problema})`);
      return brief.fallback;
    }

    return text;
  }
}

/**
 * Quién es el bot y cómo habla. Va con la conversación reciente para que
 * el modelo no salude dos veces ni pregunte lo que ya se dijo.
 *
 * Corto a propósito: se paga entero en cada turno que llega al modelo.
 */
function persona(ctx: ReplyContext): string {
  const empresas = ctx.scopes.map((s) => s.organizationName).join(', ');
  const yaSaludo = ctx.history.some(
    (t) => t.role === 'bot' && /\bhola\b/i.test(t.text),
  );

  return [
    'Asistente de documentos de una empresa, por WhatsApp. Español de México, tuteo, directo y cercano, como alguien del equipo.',
    'Máximo dos frases. Sin emojis, sin relleno ("con gusto", "no dudes en"), sin firma, sin enlaces.',
    yaSaludo ? 'Ya saludaste: no vuelvas a saludar.' : 'Si saluda, devuelve el saludo en dos palabras.',
    'No repitas lo que la persona dijo. No pidas lo que ya se sabe. No inventes documentos, fechas ni folios. No prometas nada fuera de los hechos.',
    `Puede consultar documentos de: ${empresas || 'ninguna empresa'}. Tipos: facturas, contratos, cotizaciones, reportes, pólizas.`,
    ...(ctx.history.length > 0 ? ['', 'Conversación:', formatHistory(ctx.history)] : []),
    `Cliente: ${ctx.incoming || '(sin texto)'}`,
    ...(ctx.known && ctx.known.length > 0
      ? ['', 'Ya se sabe de la solicitud:', ...ctx.known.map((k) => `- ${k}`)]
      : []),
  ].join('\n');
}

const TONO: Record<ReplyBrief['intent'], string> = {
  charla: 'No pide documento. Contesta corto y, si viene al caso, ofrece buscar algo.',
};

function instruction(brief: ReplyBrief): string {
  return [
    TONO[brief.intent],
    ...brief.facts.map((f) => `- ${f}`),
    ...(brief.mustInclude && brief.mustInclude.length > 0
      ? [`Incluye tal cual: ${brief.mustInclude.map((m) => `"${m}"`).join(', ')}`]
      : []),
    'Responde solo con el texto del mensaje.',
  ].join('\n');
}

/** Por qué se descarta un borrador, o null si sirve. */
function validar(text: string, brief: ReplyBrief): string | null {
  if (!text) return 'vacío';
  if (text.length > (brief.maxChars ?? MAX_CHARS_DEFAULT)) return 'demasiado largo';
  if (/https?:\/\//i.test(text)) return 'trae enlace';

  for (const literal of brief.mustInclude ?? []) {
    if (!text.includes(literal)) return `falta "${literal}"`;
  }

  return null;
}
