import { Injectable } from '@nestjs/common';
import type { Awaiting, DocCategory, Document } from '@prisma/client';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { AccessScopeService, type OrgScope } from './access-scope.service';
import {
  ConversationHistoryService,
  type HistoryTurn,
} from './conversation-history.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService } from './document-search.service';
import type { SearchQuery } from './document-search.service';
import { ReplyWriterService } from './reply-writer.service';
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
 *
 * Dos memorias distintas, a propósito:
 *  - Los slots del ticket son la VERDAD sobre la solicitud (qué, de qué
 *    mes, de qué empresa). Los escribe el código.
 *  - El historial de mensajes es CONTEXTO para el modelo: para entender
 *    "y la de marzo", para no saludar dos veces, para no preguntar lo que
 *    la persona ya dijo. El modelo lo lee; nunca decide nada con él.
 */

const MAX_QUESTIONS = 3;

/**
 * Sin mes, cuántos documentos del tipo pedido se enseñan antes de preguntar
 * el mes. "¿Tienes la cotización?" con dos cotizaciones en el Drive se
 * contesta enseñando las dos, no preguntando "¿de qué mes?".
 */
const MAX_OPCIONES = 5;

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

/**
 * Todo lo que un turno necesita para decidir Y para redactar.
 *
 * Se resuelve una vez al principio de `handle` y se pasa entero: así ni la
 * elección numerada ni la entrega tienen que volver a cargar el alcance o
 * el historial, y todas las respuestas del turno se redactan viendo la
 * misma conversación.
 */
interface Turn {
  message: IncomingMessage;
  scopes: readonly OrgScope[];
  history: readonly HistoryTurn[];
}

@Injectable()
export class SupportStrategy {
  constructor(
    private readonly scope: AccessScopeService,
    private readonly slots: SlotExtractorService,
    private readonly search: DocumentSearchService,
    private readonly delivery: DocumentDeliveryService,
    private readonly tickets: TicketService,
    private readonly history: ConversationHistoryService,
    private readonly writer: ReplyWriterService,
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

    // El mensaje actual ya está guardado (fase 1 del caso de uso); se
    // excluye para que no aparezca dos veces en el prompt.
    const turn: Turn = {
      message,
      scopes: scope.scopes,
      history: await this.history.recent(ctx.conversationId, {
        excludeId: message.id,
      }),
    };

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
      const resuelto = await this.resolverOpcion(eleccion, turn, ctx);
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

    /**
     * Lo que la solicitud ya tiene resuelto, en palabras.
     *
     * Se le enseña al modelo tanto al extraer como al redactar: es lo que
     * evita que pregunte el mes que la persona dijo hace dos mensajes, y lo
     * que le permite entender "y la de marzo" como "la factura de marzo".
     */
    const vigentes =
      abierto?.slots ?? (await this.tickets.slotsVigentes(ctx.conversationId));
    const conocido = describirSlots(vigentes, scope.scopes);
    const enCurso = tieneDatos(vigentes);

    /**
     * Saludos, gracias y "ok" se contestan sin modelo.
     *
     * Son la mitad de los mensajes de un chat y no hay nada que
     * interpretar. Un "gracias" después de una entrega recibe un "de nada";
     * un "ok" no recibe nada, que es lo que haría una persona. Solo si no
     * hay una pregunta en el aire: "ok" contestando a "¿de qué mes?" sí
     * tiene que pasar por el flujo normal.
     */
    const rapida = respuestaRapida(message.body, turn, pendiente);
    if (rapida !== null) {
      return { text: rapida, awaiting: pendiente ? 'CLIENTE' : 'NADIE' };
    }

    // La empresa se busca primero en el texto crudo, por reglas: un nombre
    // con erratas también cuenta, y si se reconoce aquí el extractor puede
    // ahorrarse la llamada al modelo.
    const empresaEnTexto = this.resolveCompany(message.body, scope.scopes);

    const extraction = await this.slots.extract(message.body, {
      pendiente,
      history: turn.history,
      known: conocido,
      enCurso,
      companyKnown: empresaEnTexto !== null,
    });

    // ...y después en lo que dijo el modelo, por si lo nombró de otra forma.
    const empresaMencionada =
      empresaEnTexto ??
      this.resolveCompany(extraction.companyHint, scope.scopes);

    const aporta =
      extraction.query.category !== null ||
      extraction.query.period !== null ||
      extraction.query.folio !== null ||
      empresaMencionada !== null;

    /**
     * Sin ningún dato nuevo y sin pregunta en el aire, es charla — diga lo
     * que diga el modelo sobre si "pide un documento".
     *
     * Un mensaje que no aporta tipo, mes, folio ni empresa no puede cambiar
     * la búsqueda; lo único que haría es repetir la anterior. Así es como
     * "va con eso está bien gracias" acababa en la misma cotización por
     * segunda vez. Un dato suelto, o cualquier cosa dicha en respuesta a
     * una pregunta del bot, sí sigue por el camino de los documentos.
     */
    if (!aporta && pendiente === null) {
      return {
        text: await this.smallTalk(turn, conocido),
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

    return this.avanzar(turn, ticket, query, {
      ...(ticket.slots as Record<string, unknown>),
      ...guardar,
    });
  }

  /**
   * Con lo que el ticket ya sabe, da el siguiente paso: pregunta lo que
   * falta, busca, entrega o escala.
   *
   * Separado de `handle` a propósito: aquí no se lee el mensaje ni se
   * extrae nada. Solo se mira el estado. Es lo que permite reanudar después
   * de elegir una opción numerada sin volver a interpretar nada.
   *
   * `slots` es el estado del ticket tal como queda DESPUÉS de guardar lo de
   * este mensaje; el objeto `ticket` puede traer una foto anterior.
   */
  private async avanzar(
    turn: Turn,
    ticket: { id: string; number: number },
    query: SearchQuery,
    slots: unknown,
  ): Promise<StrategyReply> {
    const { scopes } = turn;
    const asked = readAsked(slots);

    // Presupuesto agotado: escala en vez de seguir preguntando.
    if (asked.total >= MAX_QUESTIONS) {
      return this.escalarPorNoEntender(ticket);
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
        opcionesAt: new Date().toISOString(),
      });

      const lista = scopes.map((s, i) => `${i + 1}. ${s.organizationName}`);

      return this.ask(
        ticket,
        asked,
        'empresa',
        'Tienes acceso a varias empresas. ¿De cuál lo necesitas?',
        lista,
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

    /**
     * Sin mes y sin folio, primero se mira cuántos hay.
     *
     * Preguntar "¿de qué mes?" cuando solo existe una cotización es hacer
     * dar una vuelta de más; enseñar dos o tres para que señale una es lo
     * que haría alguien del equipo. Solo si hay demasiadas se pregunta.
     */
    if (!query.period && !query.folio) {
      const candidatos = await this.search.search(
        scopes,
        { ...query, organizationId },
        MAX_OPCIONES + 1,
      );

      if (candidatos.length > MAX_OPCIONES) {
        return this.ask(ticket, asked, 'periodo', `¿De qué mes necesitas la ${nombre(query.category)}?`);
      }

      return this.resolverResultados(turn, ticket, query, candidatos);
    }

    const results = await this.search.search(scopes, {
      ...query,
      organizationId,
    });

    return this.resolverResultados(turn, ticket, query, results);
  }

  /**
   * 0 resultados escala, 1 entrega, varios se enseñan numerados.
   *
   * Varios resultados NO es ambigüedad de la persona: preguntó bien y hay
   * más de un documento que encaja. Se listan con su folio para que pueda
   * señalar uno, y esta lista no cuenta contra el presupuesto de preguntas.
   */
  private async resolverResultados(
    turn: Turn,
    ticket: { id: string; number: number },
    query: SearchQuery,
    results: Document[],
  ): Promise<StrategyReply> {
    if (results.length === 0) {
      const denial = query.category
        ? this.scope.denialFor(turn.scopes, query.category, query.period)
        : null;

      await this.tickets.escalate(
        ticket.id,
        denial ? 'sin_permiso' : 'sin_resultados',
        null,
      );

      const folio = `#${ticket.number}`;

      // Sin permiso y sin resultados dan la MISMA respuesta. Distinguirlas
      // permitiría mapear el Drive ajeno a base de preguntas.
      //
      // Plantilla, sin modelo: es un mensaje informativo que sale una vez
      // por solicitud, y ya nombra lo que se buscó. No hay nada que ganar
      // redactándolo cada vez.
      return {
        text: [
          `No encontré ${describirPedido(query)}.`,
          `Lo dejé anotado con el folio ${folio} para que alguien del equipo lo revise.`,
        ].join('\n'),
        awaiting: 'AGENTE',
        topic: query.category,
      };
    }

    if (results.length > 1) {
      await this.tickets.updateSlots(ticket.id, {
        opciones: results.map((doc, i) => ({
          n: i + 1,
          tipo: 'documento',
          id: doc.id,
          nombre: doc.name,
        })),
        opcionesAt: new Date().toISOString(),
      });

      // Plantilla con el tipo y el mes en palabras: dice lo mismo que
      // diría una persona y no cuesta una llamada.
      const que = query.period
        ? `${nombrePlural(query.category)} de ${mesEnPalabras(query.period)}`
        : nombrePlural(query.category);

      return {
        text: [
          `Tengo ${results.length} ${que}. ¿Cuál necesitas?`,
          ...results.map((doc, i) => `${i + 1}. ${describe(doc)}`),
          '',
          'Responde con el número.',
        ].join('\n'),
        awaiting: 'CLIENTE',
        topic: query.category,
      };
    }

    return this.entregar(turn, ticket, results[0]!);
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
    turn: Turn,
    ticket: { id: string; number: number },
    doc: Document,
  ): Promise<StrategyReply> {
    const folio = `#${ticket.number}`;

    /**
     * Leyenda por plantilla, sin modelo.
     *
     * Lo que la hace sonar a persona no es la redacción variable, sino
     * que sepa dónde está en la conversación: la segunda entrega del hilo
     * es "aquí va también", no otro "aquí está". Eso se sabe mirando el
     * historial, y no cuesta tokens.
     */
    const yaEntregoAlgo = turn.history.some(
      (t) => t.role === 'bot' && t.text.startsWith('[documento]'),
    );
    const que = `la ${nombre(doc.category)}${
      doc.period ? ` de ${mesEnPalabras(doc.period)}` : ''
    }`;
    const caption = yaEntregoAlgo
      ? `Aquí va también ${que}. Folio ${folio} por si algo.`
      : `Aquí está ${que}. Te dejo el folio ${folio} por si necesitas darle seguimiento.`;

    const sent = await this.delivery.deliver(
      turn.message.chatId,
      doc,
      caption,
      // Solo la coletilla: el enlace de descarga lo antepone la entrega, y
      // decir "no pude enviártelo" antes del enlace que sí lo entrega dejaba
      // a la persona creyendo que se había quedado sin documento.
      `Cualquier cosa, quedó anotado con el folio ${folio}.`,
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
          `Ya lo pasé al equipo con el folio ${folio}.`,
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
   *
   * La lista NO se consume al elegir. "La 2" y luego "¿y me das la 1?"
   * es una conversación normal: la persona sigue mirando la misma lista
   * en su pantalla. Lo que la retira es el tiempo (media hora) o que se
   * ofrezca otra. Antes se borraba al primer uso, y el segundo número
   * caía en el modelo, que lo adivinaba a partir del historial: acertó
   * una vez y a la siguiente pidió una "cotización de enero" que no
   * existía y escaló un ticket por nada.
   */
  private async resolverOpcion(
    numero: number,
    turn: Turn,
    ctx: StrategyContext,
  ): Promise<StrategyReply | null> {
    const ticket = await this.tickets.ticketConOpciones(ctx.conversationId);
    if (!ticket) return null;

    const slots = ticket.slots as { opciones?: unknown };
    if (!Array.isArray(slots.opciones)) return null;

    const elegida = (slots.opciones as Opcion[]).find((o) => o.n === numero);
    if (!elegida) return null;

    if (elegida.tipo === 'empresa') {
      // La lista de empresas sí se consume: ya cumplió, y los siguientes
      // números de la conversación van a ser documentos.
      await this.tickets.updateSlots(ticket.id, { opciones: null });
      await this.tickets.updateSlots(ticket.id, { organizationId: elegida.id });

      // Con la empresa ya resuelta se sigue desde el estado del ticket, sin
      // volver a interpretar nada: los demás slots ya están ahí. Reprocesar
      // un texto inventado ("de Constructora Vega") pasaba por el modelo,
      // que lo tomaba por charla, y la conversación se perdía otra vez.
      const actual = await this.tickets.ultimoTicket(ctx.conversationId);
      if (!actual || actual.id !== ticket.id) return null;

      return this.avanzar(
        turn,
        actual,
        mergeSlots(actual.slots, VACIA),
        actual.slots,
      );
    }

    const documento = await this.search.byId(elegida.id);
    if (!documento) return null;

    return this.entregar(turn, ticket, documento);
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
   * El modelo redacta viendo la conversación: un "hola" a mitad del hilo
   * no se contesta igual que el primero, y un "gracias" después de una
   * entrega no merece un "¿qué documento necesitas?".
   */
  private async smallTalk(
    turn: Turn,
    conocido: readonly string[],
  ): Promise<string> {
    const companies = turn.scopes.map((s) => s.organizationName).join(', ');

    return this.writer.write(
      {
        intent: 'charla',
        facts: [
          'El mensaje no pide ningún documento.',
          'Si te preguntan algo que no sea sobre documentos, dilo y ofrece buscar uno.',
        ],
        fallback: `Puedo buscarte documentos de ${companies}. Dime cuál necesitas y de qué mes.`,
      },
      this.replyContext(turn, conocido),
    );
  }

  /** Escalado por no entender, con el mismo texto venga de donde venga. */
  private async escalarPorNoEntender(ticket: { id: string; number: number }): Promise<StrategyReply> {
    await this.tickets.escalate(ticket.id, 'slots_incompletos', null);

    // Plantilla: sale una vez por solicitud y siempre dice lo mismo.
    return {
      text: [
        'Creo que no te estoy entendiendo bien, y no quiero hacerte dar más vueltas.',
        `Ya le pasé tu caso al equipo con el folio #${ticket.number}; alguien te contacta.`,
      ].join('\n'),
      awaiting: 'AGENTE',
    };
  }

  private replyContext(turn: Turn, conocido: readonly string[]) {
    return {
      history: turn.history,
      incoming: turn.message.body,
      scopes: turn.scopes,
      known: conocido,
    };
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
   *
   * Las preguntas son plantillas, sin modelo: ya nombran el tipo de
   * documento y llegan como mucho tres veces por solicitud. `lista` son
   * las opciones numeradas que van después, cuando hay que elegir.
   */
  private async ask(
    ticket: { id: string; number: number },
    asked: AskedState,
    slot: AskableSlot,
    question: string,
    lista: readonly string[] = [],
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

    const text =
      lista.length > 0
        ? [question, ...lista, '', 'Responde con el número.'].join('\n')
        : question;

    // Preguntamos: el turno pasa al cliente.
    return { text, awaiting: 'CLIENTE' };
  }
}

/**
 * Fusiona lo que el ticket ya sabía con lo que trajo este mensaje.
 *
 * Un campo nuevo gana. Un campo vacío se ignora: "de este mes" no puede
 * borrar el "factura" que la persona dijo hace dos mensajes.
 *
 * PERO un dato nuevo que contradice al viejo abre otra solicitud, y lo que
 * identificaba a la anterior deja de valer:
 *
 *  - Otro tipo de documento ("¿y tienes la cotización?") suelta el folio Y
 *    el mes. El folio apuntaba a la factura; heredarlo era exactamente lo
 *    que hacía que el bot mandara la misma factura tres veces. El mes
 *    tampoco se hereda: la cotización no tiene por qué ser del mismo mes,
 *    y con el tipo solo ya se puede buscar y enseñar lo que hay.
 *  - Otro mes ("y la de marzo") suelta el folio, pero conserva el tipo.
 *  - Otro folio suelta tipo y mes: un folio identifica UN documento, y un
 *    mes heredado de otra petición solo puede hacer que no aparezca.
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
  const storedCategory =
    previous.category === 'OTRO'
      ? null
      : (previous.category as SearchQuery['category'] | undefined) ?? null;

  const storedFolio =
    typeof previous.folio === 'string' ? previous.folio : null;

  /**
   * Cambia de tipo si dice uno distinto al guardado, O si dice uno y la
   * solicitud anterior se identificaba solo por folio ("me das el v3001"
   * y luego "¿y la cotización?"): ahí no había tipo que comparar, pero el
   * folio sigue apuntando al documento de antes. Si solo había un mes
   * guardado, no es cambio: es la respuesta a "¿qué documento?".
   */
  const cambiaTipo =
    fresh.category !== null &&
    fresh.category !== storedCategory &&
    (storedCategory !== null || storedFolio !== null);

  const cambiaMes =
    fresh.period !== null &&
    storedPeriod !== null &&
    fresh.period.getTime() !== storedPeriod.getTime();


  let category = fresh.category ?? storedCategory;
  let period = fresh.period ?? storedPeriod;
  let folio = fresh.folio ?? storedFolio;

  if (cambiaTipo) {
    period = fresh.period;
    folio = fresh.folio;
  }
  if (cambiaMes) folio = fresh.folio;
  if (fresh.folio !== null && fresh.folio !== storedFolio) {
    category = fresh.category;
    period = fresh.period;
  }

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

/** Cómo se llama cada tipo de documento cuando se le habla a una persona. */
const NOMBRES: Record<DocCategory, [string, string]> = {
  FACTURA: ['factura', 'facturas'],
  CONTRATO: ['contrato', 'contratos'],
  COTIZACION: ['cotización', 'cotizaciones'],
  REPORTE: ['reporte', 'reportes'],
  POLIZA: ['póliza', 'pólizas'],
  OTRO: ['documento', 'documentos'],
};

function nombre(category: DocCategory | null): string {
  return category ? NOMBRES[category][0] : 'documento';
}

function nombrePlural(category: DocCategory | null): string {
  return category ? NOMBRES[category][1] : 'documentos';
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function mesEnPalabras(period: Date): string {
  return `${MESES[period.getUTCMonth()]} de ${period.getUTCFullYear()}`;
}

/** "la factura de febrero de 2026", "el documento con folio V3001". */
function describirPedido(query: SearchQuery): string {
  if (query.folio) return `el documento con folio ${query.folio}`;

  const base = `la ${nombre(query.category)}`;
  return query.period ? `${base} de ${mesEnPalabras(query.period)}` : base;
}

/**
 * Los slots del ticket en palabras, para enseñárselos al modelo.
 *
 * Es la parte de la memoria que NO está en el historial de mensajes: lo
 * que el código ya resolvió. Decírselo es lo que evita que pregunte por
 * un mes que ya se sabe, o que redacte "¿qué documento?" cuando el tipo ya
 * quedó claro dos mensajes atrás.
 */
function describirSlots(
  slots: unknown,
  scopes: readonly OrgScope[],
): string[] {
  const raw = (typeof slots === 'object' && slots !== null
    ? slots
    : {}) as Record<string, unknown>;

  const out: string[] = [];

  if (typeof raw.category === 'string' && raw.category !== 'OTRO') {
    out.push(`Tipo de documento: ${nombre(raw.category as DocCategory)}`);
  }
  if (typeof raw.period === 'string') {
    const fecha = new Date(raw.period);
    if (!Number.isNaN(fecha.getTime())) out.push(`Mes: ${mesEnPalabras(fecha)}`);
  }
  if (typeof raw.folio === 'string') out.push(`Folio del documento: ${raw.folio}`);

  const empresa =
    scopes.length === 1
      ? scopes[0]!.organizationName
      : scopes.find((s) => s.organizationId === raw.organizationId)
          ?.organizationName;
  if (empresa) out.push(`Empresa: ${empresa}`);

  return out;
}


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
 * El número de una lista, si el mensaje viene a eso.
 *
 * "1", "el 2", "la 2", "y la 2", "me pasas el 1", "dame la primera". Es
 * una frase corta cuyo único dato es un número chico o un ordinal. Un
 * número dentro de una frase con más información no cuenta: "necesito la
 * factura 2026" no es elegir la opción 2026, y "la factura 3 de marzo"
 * trae tipo y mes, así que va por el flujo normal.
 *
 * Antes solo se aceptaba el número pelado. "Oye me puedes dar el 1" caía
 * en el modelo, que lo resolvía adivinando a partir del historial: a
 * veces bien, a veces pidiendo un documento que no existía.
 */
function leerNumero(texto: string): number | null {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const palabras = limpio.split(' ').filter(Boolean);
  if (palabras.length === 0 || palabras.length > 8) return null;

  // Con tipo, mes, año o folio no es una elección: es una petición.
  if (/\b(factura|contrato|cotizacion|reporte|poliza|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|mes|meses|20\d\d)\b/.test(limpio)) {
    return null;
  }
  if (/\b[a-z]{1,3}\d{3,}\b/.test(limpio)) return null;

  const ORDINALES: Record<string, number> = {
    primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3,
    cuarto: 4, cuarta: 4, quinto: 5, quinta: 5,
  };

  const numeros = palabras
    .map((p) => (/^[1-9]$/.test(p) ? Number(p) : ORDINALES[p] ?? null))
    .filter((n): n is number => n !== null);

  // Exactamente uno: "el 1 y el 2" no se puede resolver con una entrega.
  return numeros.length === 1 ? numeros[0]! : null;
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

/**
 * Respuesta a saludos, agradecimientos y acuses, sin modelo.
 *
 * Devuelve el texto, '' para no contestar nada, o null si el mensaje no es
 * ninguna de esas cosas y tiene que seguir el flujo normal.
 *
 * Solo mensajes cortos que sean SOLO eso: "hola, me pasas la factura" no
 * entra aquí. Y el saludo mira el historial: la segunda vez no se saluda
 * igual que la primera, que es la diferencia entre alguien que sigue el
 * hilo y un contestador.
 */
function respuestaRapida(
  texto: string,
  turn: Turn,
  pendiente: SlotPendiente | null,
): string | null {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (limpio.length === 0 || limpio.length > 60) return null;

  // Si trae un dato de documento, no es charla por corta que sea.
  if (parseQueryTieneDatos(limpio)) return null;

  const saludo =
    /^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que tal|hey|que onda|como estas|como andas)( (buenas|que tal|como estas|como andas|buen dia|buenos dias|buenas tardes))?$/;

  if (saludo.test(limpio)) {
    // Con una pregunta en el aire se repite, sin gastar presupuesto: la
    // persona volvió y no tiene por qué acordarse de dónde se quedó.
    if (pendiente) return `Aquí sigo. ${PREGUNTA_PENDIENTE[pendiente]}`;

    const yaSaludo = turn.history.some(
      (t) => t.role === 'bot' && /\bhola\b/i.test(t.text),
    );
    if (yaSaludo) return 'Aquí sigo. ¿Qué documento necesitas?';

    return turn.scopes.length === 1
      ? `¡Hola! Dime qué documento necesitas de ${turn.scopes[0]!.organizationName} y lo busco.`
      : '¡Hola! Dime qué documento necesitas y de qué empresa, y lo busco.';
  }

  // Lo de abajo solo sin pregunta pendiente: "ok" contestando a "¿de qué
  // mes?" tiene que pasar por el flujo normal.
  if (pendiente) return null;

  /**
   * Gracias y cierres: "gracias", "va con eso está bien gracias", "es
   * todo", "con eso basta". Frases cortas sin ningún dato de documento.
   * Antes "va con eso está bien gracias" caía en el modelo y acababa en
   * una entrega repetida.
   */
  const palabras = limpio.split(' ').length;
  if (palabras <= 8 && /\bgracias\b/.test(limpio)) {
    return 'De nada. Cualquier otro documento, aquí estoy.';
  }

  const cierre =
    /\b(es todo|eso es todo|con eso (esta bien|basta|es suficiente|me sirve|quedo)|asi esta bien|esta bien asi|ya quedo|ya con eso|nada mas|por ahora no|no gracias)\b/;
  const acuse =
    /^(ok|okay|okey|oki|va|vale|sale|listo|perfecto|excelente|genial|de acuerdo|entendido|enterado|recibido|ya|si|dale|orale|ah ok|va bien|esta bien|muy bien)$/;

  // Un "ok" no se contesta: ya quedó marcado como leído, y responderle a
  // cada acuse es justo lo que hace que un bot se sienta como bot.
  if (acuse.test(limpio) || (palabras <= 8 && cierre.test(limpio))) return '';

  return null;
}

/** Cómo se repite la pregunta pendiente cuando la persona vuelve. */
const PREGUNTA_PENDIENTE: Record<SlotPendiente, string> = {
  categoria: '¿Qué documento necesitas?',
  periodo: '¿De qué mes lo necesitas?',
  empresa: '¿De qué empresa lo necesitas? Responde con el número de la lista.',
};

/** ¿El texto trae tipo, mes, año o folio? Entonces no es charla. */
function parseQueryTieneDatos(limpio: string): boolean {
  return (
    /\b(factura|facturas|contrato|contratos|cotizacion|cotizaciones|reporte|reportes|poliza|polizas|cfdi|recibo|comprobante|documento|archivo|pdf)\b/.test(limpio) ||
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|20\d\d)\b/.test(limpio) ||
    /\b[a-z]{1,3}\d{3,}\b/.test(limpio)
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

/** ¿Hay una solicitud a medias: tipo, mes o folio ya dichos? */
function tieneDatos(slots: unknown): boolean {
  const raw = (typeof slots === 'object' && slots !== null
    ? slots
    : {}) as Record<string, unknown>;

  return (
    (typeof raw.category === 'string' && raw.category !== 'OTRO') ||
    typeof raw.period === 'string' ||
    typeof raw.folio === 'string'
  );
}
