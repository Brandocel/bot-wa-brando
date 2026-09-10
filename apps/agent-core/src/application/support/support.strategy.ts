import { Inject, Injectable } from '@nestjs/common';
import type { Awaiting, DocCategory, Document } from '@prisma/client';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import { AccessScopeService, type OrgScope } from './access-scope.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService } from './document-search.service';
import type { SearchQuery } from './document-search.service';
import { SlotExtractorService } from './slot-extractor.service';
import { TicketService } from './ticket.service';

/**
 * La conversación de soporte en lenguaje normal.
 *
 * Corre el mismo camino que /buscar —alcance, slots, búsqueda, ticket,
 * entrega— pero sin obligar al cliente a aprender comandos. Y con las
 * mismas reglas duras, que son las que evitan que el bot se pierda:
 *
 *  - El modelo extrae slots y redacta. NUNCA decide permisos, ni qué
 *    documento entregar, ni cuándo escalar.
 *  - Presupuesto de 3 preguntas. A la cuarta, escala. Un bot que pregunta
 *    cinco veces ya perdió al cliente.
 *  - 0 resultados escala, más de 1 pregunta, exactamente 1 entrega.
 *    Nunca "creo que te refieres a...".
 */

const MAX_QUESTIONS = 3;

/**
 * Lo que la Strategy devuelve: el texto Y de quién queda el turno.
 *
 * La bandera no se puede deducir mirando el texto desde fuera, y es lo que
 * ordena la bandeja del operador. Devolverla junto con la respuesta obliga
 * a decidirla en el mismo sitio donde se decide qué contestar.
 */
export interface StrategyReply {
  text: string;
  awaiting: Awaiting;
  /** Tema del hilo, cuando este turno lo resolvió. */
  topic?: DocCategory | null;
}

export interface StrategyContext {
  contactId: string;
  conversationId: string;
}

@Injectable()
export class SupportStrategy {
  constructor(
    private readonly scope: AccessScopeService,
    private readonly slots: SlotExtractorService,
    private readonly search: DocumentSearchService,
    private readonly delivery: DocumentDeliveryService,
    private readonly tickets: TicketService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  /**
   * Devuelve la respuesta, o null si este mensaje no es para esta Strategy
   * (por ejemplo, de un número sin ninguna membresía).
   */
  async handle(
    message: IncomingMessage,
    ctx: StrategyContext,
  ): Promise<StrategyReply | null> {
    const scope = await this.scope.resolve(message.senderId);

    // Sin membresía no hay conversación de soporte. Que conteste el eco o,
    // más adelante, la Strategy de ventas.
    if (scope.decision !== 'ALLOW') return null;

    // Una foto o un audio sin texto no traen nada que extraer. Antes caían
    // en el flujo de documentos y provocaban un "¿qué documento necesitas?"
    // que no venía a cuento.
    if (message.kind !== 'TEXT' && message.body.trim() === '') {
      return {
        text: 'Recibí tu archivo, pero todavía no sé leerlo. Escríbeme qué documento necesitas y de qué mes.',
        awaiting: 'CLIENTE',
      };
    }

    /**
     * Respuesta a una lista numerada: "1", "2", "el 2".
     *
     * Los botones de WhatsApp no funcionan de forma fiable fuera de la API
     * oficial —se rompieron con multidispositivo—, así que la lista
     * numerada es la forma que sí llega a todos los teléfonos. Las opciones
     * se guardaron en el ticket al ofrecerlas.
     */
    const eleccion = leerNumero(message.body);
    if (eleccion !== null) {
      const resuelto = await this.resolverOpcion(eleccion, message, ctx);
      if (resuelto) return resuelto;
    }

    /**
     * "No veo el doc", "no me llegó", "no lo recibí".
     *
     * Es una queja sobre lo último que se entregó, no una petición nueva.
     * Tratarla como petición nueva es lo que producía el diálogo absurdo de
     * "¿cuál doc buscabas?" justo después de haberlo mandado — y obligaba a
     * la persona a repetir lo que ya había dicho.
     */
    if (esQuejaDeNoRecibido(message.body)) {
      const reenviado = await this.reenviarUltimo(message.chatId, ctx);
      if (reenviado) return reenviado;
    }

    const extraction = await this.slots.extract(message.body);

    if (extraction.notADocumentRequest) {
      return {
        text: await this.smallTalk(message.body, scope.scopes),
        awaiting: 'NADIE',
      };
    }

    const ticket = await this.tickets.openOrReattach({
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      organizationId:
        scope.scopes.length === 1 ? scope.scopes[0]!.organizationId : null,
      subject: message.body,
      priority: this.tickets.priorityFor(extraction.query),
    });

    /**
     * ESTO es lo que convierte mensajes sueltos en una conversación.
     *
     * Cada mensaje se extrae por separado, así que "de este mes" trae
     * periodo y ninguna categoría, y "factura" trae categoría y ningún
     * periodo. Sin fusionar contra lo que ya está en el ticket, el bot
     * pregunta el mes, le contestan el mes, y a la siguiente vuelta ya no
     * se acuerda de que le habían dicho "factura" — y pregunta otra vez.
     *
     * Lo nuevo pisa a lo viejo, pero un hueco NUNCA borra lo que ya
     * estaba: por eso se comprueba contra null en vez de asignar de plano.
     */
    const query = mergeSlots(ticket.slots, extraction.query);

    await this.tickets.updateSlots(ticket.id, {
      category: query.category,
      period: query.period?.toISOString() ?? null,
      folio: query.folio,
    });

    const asked = readAsked(ticket.slots);

    // Presupuesto agotado: escala en vez de seguir preguntando.
    if (asked.total >= MAX_QUESTIONS) {
      await this.tickets.escalate(ticket.id, 'slots_incompletos', null);
      return {
        text: [
          'Creo que no te estoy entendiendo bien, y no quiero hacerte dar más vueltas.',
          `Ya le pasé tu caso al equipo con el folio #${ticket.number}; alguien te contacta.`,
        ].join('\n'),
        awaiting: 'AGENTE',
      };
    }

    /**
     * La empresa puede venir de tres sitios, y este es el orden correcto:
     * lo que dijo en ESTE mensaje, lo que ya se guardó en el ticket, o —si
     * solo tiene acceso a una— la única posible.
     *
     * Leer la del ticket es lo que hace que elegir '1' funcione: la
     * elección se guarda ahí y el mensaje siguiente no la vuelve a
     * mencionar.
     */
    const organizationId =
      this.resolveCompany(extraction.companyHint, scope.scopes) ??
      empresaGuardada(ticket.slots, scope.scopes);

    // Varias empresas y no dijo cuál: se pregunta. Elegir la primera es
    // exactamente cómo se entrega la factura de la empresa equivocada.
    if (scope.scopes.length > 1 && !organizationId) {
      // Numeradas y guardadas: la persona puede contestar "1" en vez de
      // teclear el nombre, que es donde se cuelan las erratas.
      await this.tickets.updateSlots(ticket.id, {
        opciones: scope.scopes.map((s, i) => ({
          n: i + 1,
          tipo: 'empresa',
          id: s.organizationId,
          nombre: s.organizationName,
        })),
      });

      return this.ask(
        ticket,
        asked,
        'empresa',
        [
          'Tienes acceso a varias empresas. ¿De cuál lo necesitas?',
          ...scope.scopes.map((s, i) => `${i + 1}. ${s.organizationName}`),
          '',
          'Responde con el número.',
        ].join('\n'),
      );
    }

    if (!query.category && !query.folio) {
      return this.ask(
        ticket,
        asked,
        'categoria',
        '¿Qué documento necesitas? Puedo buscarte facturas, contratos, cotizaciones, reportes y pólizas.',
      );
    }

    if (!query.period && !query.folio) {
      return this.ask(ticket, asked, 'periodo', '¿De qué mes lo necesitas?');
    }

    const results = await this.search.search(scope.scopes, {
      ...query,
      organizationId,
    });

    if (results.length === 0) {
      const denial = query.category
        ? this.scope.denialFor(
            scope.scopes,
            query.category,
            query.period,
          )
        : null;

      await this.tickets.escalate(
        ticket.id,
        denial ? 'sin_permiso' : 'sin_resultados',
        null,
      );

      // Sin permiso y sin resultados dan la MISMA respuesta. Distinguirlas
      // permitiría mapear el Drive ajeno a base de preguntas.
      return {
        text: [
          'No encontré ese documento.',
          `Lo dejé anotado con el folio #${ticket.number} para que alguien del equipo lo revise.`,
        ].join('\n'),
        awaiting: 'AGENTE',
        topic: query.category,
      };
    }

    // Varios resultados NO es ambigüedad de la persona: preguntó bien y hay
    // más de un documento que encaja. Se listan con su folio para que pueda
    // señalar uno, y esta pregunta no cuenta contra el presupuesto.
    if (results.length > 1) {
      await this.tickets.updateSlots(ticket.id, {
        opciones: results.map((doc, i) => ({
          n: i + 1,
          tipo: 'documento',
          id: doc.id,
          nombre: doc.name,
        })),
      });

      return {
        text: [
          `Encontré ${results.length}. ¿Cuál necesitas?`,
          ...results.map((doc, i) => `${i + 1}. ${describe(doc)}`),
          '',
          'Responde con el número.',
        ].join('\n'),
        awaiting: 'CLIENTE',
        topic: query.category,
      };
    }

    const doc = results[0]!;
    const sent = await this.delivery.deliver(
      message.chatId,
      doc,
      `Ticket #${ticket.number} — ${doc.name}`,
    );

    await this.tickets.record(ticket.id, 'entrega', 'bot', {
      documentId: doc.id,
      name: doc.name,
      entregado: sent.ok,
    });

    if (!sent.ok) {
      await this.tickets.escalate(ticket.id, 'sin_resultados', null);
      return {
        text: [
          'Encontré tu documento pero no pude enviártelo por aquí.',
          `Ya lo pasé al equipo con el folio #${ticket.number}.`,
        ].join('\n'),
        awaiting: 'AGENTE',
        topic: query.category,
      };
    }

    await this.tickets.close(ticket.id, 'resuelto');
    return {
      text: `Aquí está. Te dejo el folio #${ticket.number} por si necesitas darle seguimiento:`,
      awaiting: 'NADIE',
      topic: doc.category,
    };
  }

  /**
   * Aplica la opción elegida de la última lista ofrecida.
   *
   * Devuelve null si no había lista o el número no corresponde a ninguna:
   * ahí el mensaje sigue su camino normal, porque un "2" suelto también
   * puede ser parte de una frase que no tiene nada que ver.
   */
  private async resolverOpcion(
    numero: number,
    message: IncomingMessage,
    ctx: StrategyContext,
  ): Promise<StrategyReply | null> {
    const ticket = await this.tickets.ultimoTicket(ctx.conversationId);
    if (!ticket) return null;

    const slots = ticket.slots as { opciones?: unknown };
    if (!Array.isArray(slots.opciones)) return null;

    const elegida = (slots.opciones as Opcion[]).find((o) => o.n === numero);
    if (!elegida) return null;

    // La lista se consume: si sigue guardada, un "1" de otra conversación
    // más adelante resucitaría una elección que ya no viene a cuento.
    await this.tickets.updateSlots(ticket.id, { opciones: null });

    if (elegida.tipo === 'empresa') {
      await this.tickets.updateSlots(ticket.id, { organizationId: elegida.id });

      // Con la empresa ya resuelta, se reprocesa la solicitud tal como
      // estaba: los demás slots siguen en el ticket.
      return this.handle(
        { ...message, body: `de ${elegida.nombre}` } as IncomingMessage,
        ctx,
      );
    }

    const documento = await this.search.byId(elegida.id);
    if (!documento) return null;

    const sent = await this.delivery.deliver(
      message.chatId,
      documento,
      `Ticket #${ticket.number} — ${documento.name}`,
    );

    await this.tickets.record(ticket.id, 'entrega', 'bot', {
      documentId: documento.id,
      name: documento.name,
      entregado: sent.ok,
    });

    if (!sent.ok) {
      await this.tickets.escalate(ticket.id, 'sin_resultados', null);
      return {
        text: [
          'Encontré tu documento pero no pude enviártelo por aquí.',
          `Ya lo pasé al equipo con el folio #${ticket.number}.`,
        ].join('\n'),
        awaiting: 'AGENTE',
        topic: documento.category,
      };
    }

    await this.tickets.close(ticket.id, 'resuelto');
    return {
      text: `Aquí está. Te dejo el folio #${ticket.number} por si necesitas darle seguimiento:`,
      awaiting: 'NADIE',
      topic: documento.category,
    };
  }

  /**
   * Reintenta la última entrega de esta conversación.
   *
   * Se busca el último ticket que registró una entrega y se vuelve a mandar
   * ese documento. Si el envío falla otra vez, se escala: dos fallos
   * seguidos ya no son mala suerte, y hacer que la persona lo pida por
   * tercera vez es perderla.
   */
  private async reenviarUltimo(
    chatId: string,
    ctx: StrategyContext,
  ): Promise<StrategyReply | null> {
    const entrega = await this.tickets.ultimaEntrega(ctx.conversationId);
    if (!entrega) return null;

    const documento = await this.search.byId(entrega.documentId);
    if (!documento) return null;

    const sent = await this.delivery.deliver(
      chatId,
      documento,
      `Ticket #${entrega.ticketNumber} — ${documento.name}`,
    );

    if (sent.ok) {
      return {
        text: 'Perdón, te lo mando otra vez:',
        awaiting: 'NADIE',
        topic: documento.category,
      };
    }

    await this.tickets.escalate(entrega.ticketId, 'sin_resultados', null);

    return {
      text: [
        'Sigo sin poder enviártelo por aquí.',
        `Ya lo pasé al equipo con el folio #${entrega.ticketNumber} para que te lo hagan llegar.`,
      ].join('\n'),
      awaiting: 'AGENTE',
      topic: documento.category,
    };
  }

  /**
   * Saludos, agradecimientos y preguntas generales.
   *
   * El modelo redacta, pero solo con lo que ya está resuelto: qué empresas
   * puede consultar quien escribe. No recibe historial ni documentos.
   */
  private async smallTalk(
    text: string,
    scopes: readonly OrgScope[],
  ): Promise<string> {
    const companies = scopes.map((s) => s.organizationName).join(', ');

    const drafted = await this.llm.draft({
      system: [
        'Eres el asistente de documentos de una empresa, por WhatsApp.',
        'Respondes en español, en tono cercano y directo, máximo dos frases.',
        'Tuteas. No usas emojis ni saludos largos.',
        `Quien escribe puede consultar documentos de: ${companies}.`,
        'Puedes buscar facturas, contratos, cotizaciones, reportes y pólizas.',
        'Si te preguntan algo que no sea sobre documentos, dilo y ofrece buscar uno.',
        'Nunca prometas nada que no sea entregar un documento.',
      ].join('\n'),
      user: text,
      maxTokens: 200,
    });

    return (
      drafted ??
      `Puedo buscarte documentos de ${companies}. Dime cuál necesitas y de qué mes.`
    );
  }

  /** Empresa mencionada en el texto, si coincide con alguna del alcance. */
  private resolveCompany(
    hint: string | null,
    scopes: readonly OrgScope[],
  ): string | null {
    if (scopes.length === 1) return scopes[0]!.organizationId;
    if (!hint) return null;

    const needle = hint.toLowerCase();
    const match = scopes.find(
      (s) =>
        s.organizationName.toLowerCase().includes(needle) ||
        needle.includes(s.organizationName.toLowerCase()),
    );

    return match?.organizationId ?? null;
  }

  /**
   * Hace una pregunta, pero solo si no se hizo ya.
   *
   * Repetir una pregunta que la persona ya contestó es la forma más rápida
   * de que abandone la conversación: da la sensación de no estar hablando
   * con nadie. Si un dato sigue faltando DESPUÉS de haberlo pedido, el
   * problema no es que falte información — es que no nos estamos
   * entendiendo, y eso lo resuelve una persona, no otra pregunta.
   *
   * Qué se preguntó vive en los slots del ticket, no en memoria: entre un
   * mensaje y el siguiente el core puede reiniciarse o atender desde otra
   * instancia.
   */
  private async ask(
    ticket: { id: string; number: number; slots: unknown },
    asked: AskedState,
    slot: AskableSlot,
    question: string,
  ): Promise<StrategyReply> {
    if (asked.slots[slot]) {
      await this.tickets.escalate(ticket.id, 'slots_incompletos', null);
      return {
        text: [
          'Ya te pregunté esto y sigo sin entenderlo bien; no quiero hacerte repetir.',
          `Se lo pasé al equipo con el folio #${ticket.number}.`,
        ].join('\n'),
        awaiting: 'AGENTE',
      };
    }

    await this.tickets.updateSlots(ticket.id, {
      preguntas: asked.total + 1,
      preguntado: { ...asked.slots, [slot]: true },
    });

    // Preguntamos: el turno pasa al cliente.
    return { text: question, awaiting: 'CLIENTE' };
  }
}

/**
 * Fusiona lo que el ticket ya sabía con lo que trajo este mensaje.
 *
 * Un campo nuevo gana. Un campo vacío se ignora: "de este mes" no puede
 * borrar el "factura" que la persona dijo hace dos mensajes.
 */
function mergeSlots(stored: unknown, fresh: SearchQuery): SearchQuery {
  const previous = (typeof stored === 'object' && stored !== null
    ? stored
    : {}) as Record<string, unknown>;

  const storedPeriod =
    typeof previous.period === 'string' ? new Date(previous.period) : null;

  return {
    category: fresh.category ?? (previous.category as SearchQuery['category']) ?? null,
    period: fresh.period ?? storedPeriod,
    folio: fresh.folio ?? (typeof previous.folio === 'string' ? previous.folio : null),
    text: fresh.text,
  };
}

/**
 * La empresa que ya se había resuelto en este ticket, si sigue estando
 * dentro del alcance de quien escribe.
 *
 * Se revalida contra el alcance a propósito: un permiso pudo revocarse
 * entre dos mensajes, y un id guardado no es autorización.
 */
function empresaGuardada(
  slots: unknown,
  scopes: readonly OrgScope[],
): string | null {
  const guardado = (slots as { organizationId?: unknown } | null)?.organizationId;
  if (typeof guardado !== 'string') return null;

  return scopes.some((s) => s.organizationId === guardado) ? guardado : null;
}

interface Opcion {
  n: number;
  tipo: 'empresa' | 'documento';
  id: string;
  nombre: string;
}

/**
 * El número de una lista, si el mensaje es SOLO eso.
 *
 * "1", "el 2", "opcion 3". Un número dentro de una frase larga no cuenta:
 * "necesito la factura 2026" no es elegir la opción 2026.
 */
function leerNumero(texto: string): number | null {
  const limpio = texto.trim().toLowerCase();
  const match = /^(?:el |la |opcion |opción |numero |número )?([1-9])\.?$/.exec(
    limpio,
  );

  return match ? Number(match[1]) : null;
}

/**
 * ¿Está diciendo que no le llegó lo que mandamos?
 *
 * Deliberadamente por reglas y no por modelo: es una frase corta y muy
 * repetida, y acertar aquí importa más que cubrir todas las variantes. Lo
 * que no case cae en el flujo normal, que ya funciona.
 *
 * El tope de longitud evita que un mensaje largo que mencione "no lo veo"
 * de pasada se lleve por delante una petición nueva.
 */
function esQuejaDeNoRecibido(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 60) return false;

  return /\b(no (lo |la |me )?(veo|llego|llega|recibi|aparece|abre)|no me lo mandaste|donde esta|no vino|no esta el (doc|archivo|pdf))\b/.test(
    limpio,
  );
}

/** Los datos que el bot sabe pedir cuando faltan. */
type AskableSlot = 'categoria' | 'periodo' | 'empresa';

interface AskedState {
  /** Cuántas preguntas se han hecho en este ticket. */
  total: number;
  /** Cuáles en concreto, para no repetir ninguna. */
  slots: Partial<Record<AskableSlot, boolean>>;
}

/**
 * El estado de la conversación vive en el ticket.
 *
 * Es la "ventana de contexto" del bot, y a propósito NO es el historial de
 * mensajes: es un puñado de campos resueltos. Mandarle al modelo cuarenta
 * mensajes crudos es la causa número uno de que un bot se pierda, además de
 * lo que hace que cada turno cueste más que el anterior.
 */
function readAsked(slots: unknown): AskedState {
  const raw = (typeof slots === 'object' && slots !== null
    ? slots
    : {}) as Record<string, unknown>;

  const preguntado =
    typeof raw.preguntado === 'object' && raw.preguntado !== null
      ? (raw.preguntado as Partial<Record<AskableSlot, boolean>>)
      : {};

  return {
    total: typeof raw.preguntas === 'number' ? raw.preguntas : 0,
    slots: preguntado,
  };
}

function describe(doc: Document): string {
  const period = doc.period ? doc.period.toISOString().slice(0, 7) : 'sin fecha';
  return `${doc.name} (${period}${doc.folio ? `, folio ${doc.folio}` : ''})`;
}
