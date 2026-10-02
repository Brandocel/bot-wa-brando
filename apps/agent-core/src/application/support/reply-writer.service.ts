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
 * Lo que el modelo no decide: qué documento, permisos ni entregas. Recibe
 * los hechos ya resueltos y una lista de literales que su texto tiene que
 * contener (el folio, sobre todo). La validación es de forma, no de fondo:
 * si el borrador no trae esos literales, se pasa de largo o mete un
 * enlace, se descarta y sale el texto fijo que quien llama dejó preparado.
 * Que no invente hechos depende del prompt; por eso nunca recibe nombres
 * de archivo (ver formatHistory). Sin modelo configurado sale ese mismo texto: el bot nunca se
 * queda callado por culpa de la redacción.
 */

export interface ReplyBrief {
  /** Qué está haciendo el bot en este turno. Guía el tono. */
  intent: 'charla' | 'consulta' | 'queja';
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
    // Reglas en el system; la plática y el mensaje en el turno del usuario.
    // Al revés (como estaba), el modelo a veces "seguía" la conversación e
    // inventaba una línea del cliente antes de contestar.
    const drafted = await this.llm.draft({
      tarea: 'redaccion',
      system: persona(ctx, brief),
      user: conversacion(ctx),
      maxTokens: 150,
    });

    const text = drafted?.trim() ?? '';
    const problema = validar(text, brief, ctx);

    if (problema) {
      if (drafted) this.logger.debug(`borrador descartado (${problema})`);
      return brief.fallback;
    }

    return text;
  }
}

/**
 * Quién es el bot, cómo habla y qué sabe hacer. Corto a propósito: se paga
 * entero en cada turno que llega al modelo.
 */
function persona(ctx: ReplyContext, brief: ReplyBrief): string {
  const empresas = ctx.scopes.map((s) => s.organizationName).join(', ');
  const yaSaludo = ctx.history.some(
    (t) => t.role === 'bot' && /\bhola\b/i.test(t.text),
  );

  return [
    `Eres el asistente automático de documentos de ${empresas || 'la empresa'} por WhatsApp. Español de México, de tú, cordial y claro.`,
    'Registro: amable y profesional. Nada de apodos ni muletillas ("hermano", "bro", "jefe", "compa", "Ey", "oye", "la onda"). Sin emojis, sin fórmulas de call center ("con gusto le atiendo", "no dude en"), sin firma, sin enlaces.',
    'Una o dos frases en UN solo párrafo. Contesta a lo que dijo antes de ofrecer nada. No escribas lo que dijo el cliente ni inventes preguntas suyas.',
    yaSaludo ? 'Ya se saludaron: no vuelvas a saludar.' : 'Si saluda, devuélvele el saludo con calidez y brevedad.',
    'Qué SÍ puedes hacer: buscar y mandar por aquí facturas, contratos, cotizaciones, reportes, pólizas, estados de cuenta y documentos contables; decir qué documentos hay de un mes o tipo; reenviar uno que ya se mandó; y pasar la conversación con una persona del equipo.',
    'Si preguntan quién o qué eres, di con honestidad que eres el asistente automático de documentos; no inventes edad, nombre propio ni detalles técnicos.',
    'No inventes horarios, precios, trámites, políticas, documentos, fechas ni folios. Si no sabes algo, dilo una vez y di qué sí puedes hacer.',
    'No repitas una frase que ya dijiste en la conversación: si ya ofreciste pasarlo con alguien, no lo vuelvas a ofrecer igual.',
    '',
    TONO[brief.intent],
    ...brief.facts.map((f) => `- ${f}`),
    ...(brief.mustInclude && brief.mustInclude.length > 0
      ? [`Incluye tal cual: ${brief.mustInclude.map((m) => `"${m}"`).join(', ')}`]
      : []),
    ...(ctx.known && ctx.known.length > 0
      ? ['', 'Ya se sabe de la solicitud:', ...ctx.known.map((k) => `- ${k}`)]
      : []),
    '',
    'Responde solo con el texto de tu mensaje.',
  ].join('\n');
}

/** La plática reciente y el mensaje a contestar. */
function conversacion(ctx: ReplyContext): string {
  return [
    ...(ctx.history.length > 0 ? ['Conversación reciente:', formatHistory(ctx.history), ''] : []),
    `Mensaje del cliente que debes contestar: ${ctx.incoming || '(sin texto)'}`,
  ].join('\n');
}

const TONO: Record<ReplyBrief['intent'], string> = {
  charla: 'No pide documento. Contesta corto y, si viene al caso, ofrece buscar algo.',
  consulta: 'Pregunta algo que no es pedir un documento. Contesta lo que sepas con lo de arriba; si no, dilo con honestidad.',
  queja: 'Expresa una inconformidad. Reconócela primero, en una frase y sin excusas; luego di qué sí puedes hacer.',
};

/** Igual que lo que ya dijo el bot, sin contar mayúsculas, signos ni espacios. */
function mismaFrase(a: string, b: string): boolean {
  const n = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return n(a) === n(b);
}

/** Por qué se descarta un borrador, o null si sirve. */
function validar(text: string, brief: ReplyBrief, ctx?: ReplyContext): string | null {
  if (!text) return 'vacío';
  if (text.length > (brief.maxChars ?? MAX_CHARS_DEFAULT)) return 'demasiado largo';
  if (/https?:\/\//i.test(text)) return 'trae enlace';
  // Dos bloques o un "Cliente:" = el modelo escribió también lo del cliente.
  if (/\n\s*\n/.test(text)) return 'más de un párrafo';
  if (/^(?:cliente|usuario|bot|asistente)\s*:/im.test(text)) return 'trae diálogo';
  if (ctx?.history.some((t) => t.role === 'bot' && mismaFrase(t.text, text))) return 'repite lo que ya dijo';

  for (const literal of brief.mustInclude ?? []) {
    if (!text.includes(literal)) return `falta "${literal}"`;
  }

  return null;
}
