import { Inject, Injectable } from '@nestjs/common';
import type { Awaiting, DocCategory, Document } from '@prisma/client';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import { AccessScopeService, type OrgScope } from './access-scope.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService } from './document-search.service';
import type { SearchQuery } from './document-search.service';
import { SlotExtractorService, type SlotPendiente } from './slot-extractor.service';
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

    /**
     * Si el bot acaba de hacer una pregunta, este mensaje es la respuesta.
     *
     * Se decide ANTES de extraer nada, porque cambia cómo se lee el texto:
     * "de este" o "contrucora vega" sueltos parecen charla, y el modelo los
     * marcaba como tal; el bot contestaba con una frase amable improvisada,
     * no guardaba nada, y a la siguiente vuelta preguntaba lo mismo otra
     * vez. Desde fuera: una conversación que no avanza.
     */
    const abierto = await this.tickets.ticketAbierto(ctx.conversationId);
    const pendiente = abierto ? ultimaPregunta(abierto.slots) : null;

    const extraction = await this.slots.extract(message.body, { pendiente });

    // La empresa se busca en lo que dijo el modelo Y en el texto crudo: el
    // modelo puede no devolverla, y un nombre con erratas también cuenta.
    const empresaMencionada =
      this.resolveCompany(extraction.companyHint, scope.scopes) ??
      this.resolveCompany(message.body, scope.scopes);

    const aporta =
      extraction.query.category !== null ||
      extraction.query.period !== null ||
      extraction.query.folio !== null ||
      empresaMencionada !== null;

    // Charla solo si de verdad no trae nada y no se le había preguntado
    // nada. Un dato suelto, o cualquier cosa dicha en respuesta a una
    // pregunta del bot, sigue por el camino de los documentos.
    if (extraction.notADocumentRequest && !aporta && pendiente === null) {
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

    const guardar: Record<string, unknown> = {
      category: query.category,
      period: query.period?.toISOString() ?? null,
      folio: query.folio,
    };
    // La empresa dicha en este mensaje se guarda igual que los demás
    // datos: el siguiente mensaje ya no la va a repetir.
    if (empresaMencionada) guardar.organizationId = empresaMencionada;

    await this.tickets.updateSlots(ticket.id, guardar);

    return this.avanzar(message, scope.scopes, ticket, query, {
      ...(ticket.slots as Record<string, unknown>),
      ...guardar,
    });
  }

  /**
   * Con lo que el ticket ya sabe, da el siguiente paso: pregunta lo que
   * falta, busca, entrega o escala.
   *
   * Separado de `handle` a propósito: aquí no se lee el mensaje ni se llama
   * al modelo. Solo se mira el estado. Es lo que permite reanudar después de
   * elegir una opción numerada sin volver a interpretar nada.
   *
   * `slots` es el estado del ticket tal como queda DESPUÉS de guardar lo de
   * este mensaje; el objeto `ticket` puede traer una foto anterior.
   */
  private async avanzar(
    message: IncomingMessage,
    scopes: readonly OrgScope[],
    ticket: { id: string; number: number },
    query: SearchQuery,
    slots: unknown,
  ): Promise<StrategyReply> {
    const asked = readAsked(slots);

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
     * La empresa sale del ticket —donde ya quedó lo dicho en este mensaje,
     * lo elegido con un número, o lo heredado— o, si solo tiene acceso a
     * una, es la única posible.
     */
    const organizationId =
      scopes.length === 1
        ? scopes[0]!.organizationId
        : empresaGuardada(slots, scopes);

    // Varias empresas y no dijo cuál: se pregunta. Elegir la primera es
    // exactamente cómo se entrega la factura de la empresa equivocada.
    if (scopes.length > 1 && !organizationId) {
      // Numeradas y guardadas: la persona puede contestar "1" en vez de
      // teclear el nombre, que es donde se cuelan las erratas.
      await this.tickets.updateSlots(ticket.id, {
        opciones: scopes.map((s, i) => ({
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
          ...scopes.map((s, i) => `${i + 1}. ${s.organizationName}`),
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

    const results = await this.search.search(scopes, {
      ...query,
      organizationId,
    });

    if (results.length === 0) {
      const denial = query.category
        ? this.scope.denialFor(scopes, query.category, query.period)
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

    return this.entregar(message.chatId, ticket, results[0]!);
  }

  /**
   * Encola el documento y cierra el ticket.
   *
   * El texto va como leyenda DEL archivo, no como mensaje aparte. El envío
   * es asíncrono: un "aquí está" separado salía aunque el archivo fallara
   * después, y la persona se quedaba mirando un mensaje que prometía un PDF
   * que nunca llegó. Si el archivo no sale, lo que recibe es la disculpa
   * que se deja preparada en `fallbackText`.
   */
  private async entregar(
    chatId: string,
    ticket: { id: string; number: number },
    doc: Document,
  ): Promise<StrategyReply> {
    const sent = await this.delivery.deliver(
      chatId,
      doc,
      `Aquí está: ${doc.name}. Te dejo el folio #${ticket.number} por si necesitas darle seguimiento.`,
      [
        `Encontré ${doc.name} pero no pude enviártelo por aquí.`,
        `Ya lo pasé al equipo con el folio #${ticket.number} para que te lo hagan llegar.`,
      ].join('\n'),
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
        topic: doc.category,
      };
    }

    await this.tickets.close(ticket.id, 'resuelto');
    // Sin texto aparte: la leyenda del archivo ya lo dice todo.
    return { text: '', awaiting: 'NADIE', topic: doc.category };
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

      // Con la empresa ya resuelta se sigue desde el estado del ticket, sin
      // volver a interpretar nada: los demás slots ya están ahí. Reprocesar
      // un texto inventado ("de Constructora Vega") pasaba por el modelo,
      // que lo tomaba por charla, y la conversación se perdía otra vez.
      const scope = await this.scope.resolve(message.senderId);
      if (scope.decision !== 'ALLOW') return null;

      const actual = await this.tickets.ultimoTicket(ctx.conversationId);
      if (!actual || actual.id !== ticket.id) return null;

      return this.avanzar(
        message,
        scope.scopes,
        actual,
        mergeSlots(actual.slots, VACIA),
        actual.slots,
      );
    }

    const documento = await this.search.byId(elegida.id);
    if (!documento) return null;

    return this.entregar(message.chatId, ticket, documento);
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
      `Perdón, te lo mando otra vez: ${documento.name} (folio #${entrega.ticketNumber}).`,
      [
        `Sigo sin poder enviarte ${documento.name} por aquí.`,
        `Ya lo pasé al equipo con el folio #${entrega.ticketNumber} para que te lo hagan llegar.`,
      ].join('\n'),
    );

    // La disculpa va como leyenda del archivo, por la misma razón que en
    // la entrega normal: no prometer nada que después pueda no salir.
    if (sent.ok) {
      return { text: '', awaiting: 'NADIE', topic: documento.category };
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

  /**
   * Empresa mencionada en un texto, si coincide con exactamente una del
   * alcance.
   *
   * Se compara por palabras y sin acentos, tolerando erratas: "contrucora
   * vega" y "Contractura vega" tienen que dar Constructora Vega, porque así
   * es como la gente escribe en WhatsApp. Si el texto casa con más de una
   * empresa, no se elige ninguna: adivinar es entregar el documento
   * equivocado.
   */
  private resolveCompany(
    text: string | null,
    scopes: readonly OrgScope[],
  ): string | null {
    if (!text) return null;

    const palabras = tokens(text);
    if (palabras.length === 0) return null;

    const candidatas = scopes.filter((s) => {
      const nombre = tokens(s.organizationName);
      return nombre.some((n) => palabras.some((p) => parecidas(p, n)));
    });

    return candidatas.length === 1 ? candidatas[0]!.organizationId : null;
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
    ticket: { id: string; number: number },
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
      // Lo último que se preguntó: así el siguiente mensaje se lee como
      // la respuesta a ESO, y no como una petición suelta.
      ultimaPregunta: slot,
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

  /**
   * OTRO guardado NO cuenta como categoría.
   *
   * Es una categoría real en la base, pero como slot de una petición
   * significa "no supimos qué tipo es" — y filtrar por ella hace que una
   * factura que existe no aparezca. Se limpia aquí además de en el
   * extractor porque los tickets ya creados lo llevan dentro y se hereda
   * durante media hora.
   */
  const categoriaGuardada =
    previous.category === 'OTRO'
      ? null
      : (previous.category as SearchQuery['category'] | undefined) ?? null;

  const category = fresh.category ?? categoriaGuardada;
  const period = fresh.period ?? storedPeriod;
  const folio =
    fresh.folio ?? (typeof previous.folio === 'string' ? previous.folio : null);

  // El texto libre solo sirve cuando no hay NINGÚN dato: la misma regla que
  // aplica el parser dentro de un mensaje, pero a lo largo de la
  // conversación. "De pollos pirata" contestando a qué empresa no debe
  // convertirse en un filtro sobre el nombre del archivo, que es justo lo
  // que hacía que el folio guardado dos mensajes atrás no encontrara nada.
  const hasMetadata = category !== null || period !== null || folio !== null;

  return { category, period, folio, text: hasMetadata ? null : fresh.text };
}

/** Una consulta sin nada: para reanudar desde lo que el ticket ya guarda. */
const VACIA: SearchQuery = { category: null, period: null, folio: null, text: null };

/** La pregunta que el bot dejó en el aire en este ticket, si hay alguna. */
function ultimaPregunta(slots: unknown): SlotPendiente | null {
  const raw = (slots as { ultimaPregunta?: unknown } | null)?.ultimaPregunta;
  return raw === 'categoria' || raw === 'periodo' || raw === 'empresa'
    ? raw
    : null;
}

/** Palabras con peso de un texto: sin acentos, sin artículos ni conectores. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

/**
 * ¿Dos palabras son la misma con erratas?
 *
 * Igualdad, prefijo, o distancia de edición pequeña respecto al largo. Es
 * deliberadamente simple: los nombres de empresa son pocas palabras y lo
 * que hay que absorber son letras comidas o cambiadas, no sinónimos.
 */
function parecidas(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;

  const tolerancia = Math.floor(Math.max(a.length, b.length) / 4);
  return tolerancia > 0 && levenshtein(a, b) <= tolerancia;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      prev[j] = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = temp;
    }
  }
  return prev[b.length]!;
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
