import { Injectable } from '@nestjs/common';
import type { Awaiting, DocCategory, Document } from '@prisma/client';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { AccessScopeService, type OrgScope } from './access-scope.service';
import {
  ConversationHistoryService,
  type HistoryTurn,
} from './conversation-history.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService, type InventoryLine } from './document-search.service';
import type { SearchQuery } from './document-search.service';
import { ReplyWriterService } from './reply-writer.service';
import { parseQuery } from './query-parser';
import { SlotExtractorService, type SlotPendiente } from './slot-extractor.service';
import { TicketService } from './ticket.service';
import * as voz from './voz';

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
        text: voz.archivoNoLeible(),
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

    // "Sí", "esa", "mándala": cuando se ofreció UNA sola opción ("lo más
    // parecido que tengo: 1. ..."), afirmar es elegirla.
    if (esAfirmacion(message.body)) {
      const conLista = await this.tickets.ticketConOpciones(ctx.conversationId);
      const opciones = (conLista?.slots as { opciones?: unknown } | null)?.opciones;
      if (Array.isArray(opciones) && opciones.length === 1) {
        const resuelto = await this.resolverOpcion(1, turn, ctx);
        if (resuelto) return resuelto;
      }
    }

    /**
     * "¿Qué documentos tienes?", "dame las opciones", "¿qué hay de este
     * mes?": se contesta con lo que hay, sin modelo y sin abrir ticket.
     * Antes esto caía en el modelo como charla ("puedo buscar facturas,
     * contratos...") o, peor, heredaba el tipo de la solicitud anterior y
     * buscaba "cotización de septiembre" cuando preguntaban por todo.
     */
    if (esInventario(message.body)) {
      return this.inventario(turn, ctx);
    }

    /**
     * "Pásame con un agente", "quiero hablar con una persona". Se escala
     * directo, sin preguntar nada más: pedir humano es una instrucción, no
     * una duda. Y se le dice quién lo va a atender, si hay alguien.
     */
    if (pideHumano(message.body)) {
      return this.pasarAHumano(turn, ctx);
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

    // Otro tipo de documento es otra solicitud: los fallos de la anterior
    // no cuentan, o el segundo "no encontré" escalaría por acumulación.
    const tipoGuardado = (ticket.slots as { category?: unknown }).category;
    if (extraction.query.category && extraction.query.category !== tipoGuardado) {
      guardar.fallos = 0;
    }

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
        voz.preguntaEmpresa(),
        lista,
      );
    }

    /**
     * Con nombre de archivo se busca por nombre y nada más: ni tipo ni
     * mes. "La cotización BrandoCelSanchez_2026" tiene que encontrar ese
     * archivo aunque esté clasificado como factura o sea de otro mes.
     */
    if (query.text) {
      const porNombre = await this.search.search(scopes, {
        category: null,
        period: null,
        folio: null,
        text: query.text,
        organizationId,
      });

      return this.resolverResultados(turn, ticket, query, porNombre, slots);
    }

    /**
     * Con un solo dato (tipo o mes) se mira cuántos hay antes de preguntar.
     *
     * Preguntar "¿de qué mes?" cuando solo existe una cotización, o "¿qué
     * documento?" cuando de febrero hay dos, es hacer dar una vuelta de
     * más; enseñar dos o tres para que señale una es lo que haría alguien
     * del equipo. Solo si hay demasiados se pregunta lo que falta.
     */
    if (!query.folio && (!query.category || !query.period)) {
      const candidatos = await this.search.search(
        scopes,
        { ...query, organizationId },
        MAX_OPCIONES + 1,
      );

      if (candidatos.length > MAX_OPCIONES) {
        if (query.category) {
          return this.ask(ticket, asked, 'periodo', voz.preguntaMes(nombre(query.category)));
        }
        return this.ask(
          ticket,
          asked,
          'categoria',
          query.period ? voz.preguntaTipoConMes(mesEnPalabras(query.period)) : voz.preguntaTipo(),
        );
      }

      if (candidatos.length === 0 && !query.category) {
        return this.ask(
          ticket,
          asked,
          'categoria',
          voz.preguntaTipo(),
        );
      }

      return this.resolverResultados(turn, ticket, query, candidatos, slots);
    }

    const results = await this.search.search(scopes, {
      ...query,
      organizationId,
    });

    return this.resolverResultados(turn, ticket, query, results, slots);
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
    slots: unknown,
  ): Promise<StrategyReply> {
    if (results.length === 0) {
      return this.sinResultados(turn, ticket, query, slots);
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
          voz.encabezadoLista(results.length, que),
          ...results.map((doc, i) => `${i + 1}. ${describe(doc)}`),
          '',
          voz.pieLista(),
        ].join('\n'),
        awaiting: 'CLIENTE',
        topic: query.category,
      };
    }

    return this.entregar(turn, ticket, results[0]!);
  }

  /**
   * No se encontró lo pedido. Primero se ofrece lo más parecido; escalar
   * es el segundo intento, no el primero.
   *
   * Antes cada búsqueda vacía abría un escalado, y una persona explorando
   * ("¿y la cotización?", "¿y de este mes?") dejaba cinco tickets en cinco
   * minutos para que alguien revisara nada. Ahora:
   *
   *  1. Si pidió un mes o un nombre, se busca sin eso: la cotización existe,
   *     solo que es de otro mes. Se enseña numerada.
   *  2. Si aun así no hay, se le dice qué SÍ hay de su empresa, por tipo.
   *  3. Solo al segundo fallo en la misma solicitud se escala.
   *
   * Sin permiso y sin resultados siguen dando lo mismo: lo "parecido" y el
   * inventario salen del alcance de quien pregunta, así que no revelan
   * nada que la búsqueda normal no revelaría.
   */
  private async sinResultados(
    turn: Turn,
    ticket: { id: string; number: number },
    query: SearchQuery,
    slots: unknown,
  ): Promise<StrategyReply> {
    const { scopes } = turn;
    const organizationId =
      scopes.length === 1
        ? scopes[0]!.organizationId
        : empresaGuardada(slots, scopes);

    const fallos = readFallos(slots) + 1;
    await this.tickets.updateSlots(ticket.id, { fallos });

    const pedido = describirPedido(query);

    if (fallos < 2) {
      // 1. Sin el mes: lo más parecido. (Con nombre de archivo no hay
      // "parecido" que valga: se pasa directo a qué sí hay.)
      if (query.period && !query.text) {
        const parecidos = await this.search.search(
          scopes,
          {
            category: query.category,
            period: null,
            folio: query.folio,
            text: null,
            organizationId,
          },
          MAX_OPCIONES,
        );

        if (parecidos.length > 0) {
          await this.tickets.updateSlots(ticket.id, {
            opciones: parecidos.map((doc, i) => ({
              n: i + 1,
              tipo: 'documento',
              id: doc.id,
              nombre: doc.name,
            })),
            opcionesAt: new Date().toISOString(),
          });

          return {
            text: [
              voz.noEncontreParecidos(pedido),
              ...parecidos.map((doc, i) => `${i + 1}. ${describe(doc)}`),
              '',
              voz.pieParecidos(),
            ].join('\n'),
            awaiting: 'CLIENTE',
            topic: query.category,
          };
        }
      }

      // 2. Qué sí hay. Si son pocos, numerados para que pueda pedir uno con
      // "la 2" en vez de tener que describirlo otra vez.
      const todos = await this.search.search(
        scopes,
        { category: null, period: null, folio: null, text: null, organizationId },
        MAX_OPCIONES + 1,
      );

      if (todos.length > 0 && todos.length <= MAX_OPCIONES) {
        await this.tickets.updateSlots(ticket.id, {
          opciones: todos.map((doc, i) => ({
            n: i + 1,
            tipo: 'documento',
            id: doc.id,
            nombre: doc.name,
          })),
          opcionesAt: new Date().toISOString(),
        });

        return {
          text: [
            voz.noEncontreListaTodo(pedido, nombreEmpresa(scopes, organizationId)),
            ...todos.map((doc, i) => `${i + 1}. ${describe(doc)}`),
            '',
            voz.pieParecidos(),
          ].join('\n'),
          awaiting: 'CLIENTE',
          topic: query.category,
        };
      }

      const inventario = await this.search.inventario(scopes, organizationId);
      if (inventario.length > 0) {
        return {
          text: [
            `No encontré ${pedido}.`,
            `${describirInventario(inventario, nombreEmpresa(scopes, organizationId))} ¿Te sirve alguno?`,
          ].join('\n'),
          awaiting: 'CLIENTE',
          topic: query.category,
        };
      }
    }

    // 3. Escalar.
    const denial = query.category
      ? this.scope.denialFor(scopes, query.category, query.period)
      : null;

    const { agente } = await this.tickets.escalate(
      ticket.id,
      denial ? 'sin_permiso' : 'sin_resultados',
      null,
    );

    return {
      text: [
        `No encontré ${pedido}.`,
        agente
          ? `Se lo pasé a ${agente.name} con el folio #${ticket.number}; te escribe por aquí.`
          : `Lo dejé anotado con el folio #${ticket.number} para que alguien del equipo lo revise.`,
      ].join('\n'),
      awaiting: 'AGENTE',
      topic: query.category,
    };
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
    const caption = voz.entrega(que, folio, yaEntregoAlgo);

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
      const { agente } = await this.tickets.escalate(ticket.id, 'sin_resultados', null);
      return {
        text: voz.entregaFallida(folio, agente),
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

    // Una lista de UNA opción se consume al usarla: no queda nada más que
    // elegir, y si siguiera viva, el "ok" de después la volvería a entregar.
    if ((slots.opciones as Opcion[]).length === 1) {
      await this.tickets.updateSlots(ticket.id, { opciones: null });
    }

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
      voz.reenvio(documento.name, `#${entrega.ticketNumber}`),
      voz.reenvioFallido(documento.name, `#${entrega.ticketNumber}`),
    );

    // La disculpa va como leyenda del archivo, por la misma razón que en
    // la entrega normal: no prometer nada que después pueda no salir.
    if (sent.ok) {
      return { text: '', awaiting: 'NADIE', topic: documento.category };
    }

    await this.tickets.escalate(entrega.ticketId, 'sin_resultados', null);

    return {
      text: voz.reenvioFallido(documento.name, `#${entrega.ticketNumber}`),
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
        fallback: voz.charlaSinModelo(companies),
      },
      this.replyContext(turn, conocido),
    );
  }

  /**
   * Qué hay: por tipo y meses, o, si preguntó por un mes concreto, los
   * documentos de ese mes numerados para que pueda pedir uno.
   */
  private async inventario(turn: Turn, ctx: StrategyContext): Promise<StrategyReply> {
    const { scopes } = turn;
    const organizationId =
      scopes.length === 1
        ? scopes[0]!.organizationId
        : empresaGuardada(await this.tickets.slotsVigentes(ctx.conversationId), scopes);

    const empresa = nombreEmpresa(scopes, organizationId);
    const { period, category } = parseQuery(turn.message.body);

    // Un mes (o un tipo) concreto: se enseñan los documentos.
    if (period || category) {
      const docs = await this.search.search(
        scopes,
        { category, period, folio: null, text: null, organizationId },
        MAX_OPCIONES + 1,
      );

      if (docs.length === 0) {
        const que = category ? nombrePlural(category) : 'documentos';
        const cuando = period ? ` de ${mesEnPalabras(period)}` : '';
        const resto = await this.search.inventario(scopes, organizationId);
        return {
          text: [
            `No tengo ${que}${cuando}${empresa ? ` de ${empresa}` : ''}.`,
            ...(resto.length > 0 ? [describirInventario(resto, empresa)] : []),
          ].join('\n'),
          awaiting: 'NADIE',
        };
      }

      if (docs.length <= MAX_OPCIONES) {
        // Numerados y guardados en un ticket, para poder pedir "el 2".
        const ticket = await this.tickets.openOrReattach({
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          organizationId,
          subject: turn.message.body,
          priority: 'BAJA',
        });
        await this.tickets.updateSlots(ticket.id, {
          opciones: docs.map((doc, i) => ({
            n: i + 1,
            tipo: 'documento',
            id: doc.id,
            nombre: doc.name,
          })),
          opcionesAt: new Date().toISOString(),
        });

        return {
          text: [
            period ? voz.encabezadoInventarioMes(mesEnPalabras(period), docs.length) : voz.encabezadoLista(docs.length, 'documentos'),
            ...docs.map((doc, i) => `${i + 1}. ${describe(doc)}`),
            '',
            voz.pieInventario(),
          ].join('\n'),
          awaiting: 'CLIENTE',
        };
      }
    }

    const lineas = await this.search.inventario(scopes, organizationId);
    if (lineas.length === 0) {
      return {
        text: voz.sinNada(empresa),
        awaiting: 'NADIE',
      };
    }

    return {
      text: voz.inventarioGeneral(describirInventario(lineas, empresa)),
      awaiting: 'NADIE',
    };
  }

  /** Escala por petición explícita y dice quién lo atiende. */
  private async pasarAHumano(turn: Turn, ctx: StrategyContext): Promise<StrategyReply> {
    const { scopes } = turn;
    const ticket = await this.tickets.openOrReattach({
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      organizationId:
        scopes.length === 1
          ? scopes[0]!.organizationId
          : empresaGuardada(await this.tickets.slotsVigentes(ctx.conversationId), scopes),
      subject: turn.message.body,
      priority: 'ALTA',
    });

    const { agente } = await this.tickets.escalate(ticket.id, 'pidio_humano', null);

    return {
      text: voz.pasarAHumano(`#${ticket.number}`, agente),
      awaiting: 'AGENTE',
    };
  }

  /** Escalado por no entender, con el mismo texto venga de donde venga. */
  private async escalarPorNoEntender(ticket: { id: string; number: number }): Promise<StrategyReply> {
    const { agente } = await this.tickets.escalate(ticket.id, 'slots_incompletos', null);

    return {
      text: voz.noTeEntiendo(`#${ticket.number}`, agente),
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
      const { agente } = await this.tickets.escalate(ticket.id, 'slots_incompletos', null);
      return {
        text: voz.yaPregunte(`#${ticket.number}`, agente),
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
  // Un nombre de archivo identifica UN documento: no se hereda nada. El
  // mes que se dijo hace dos mensajes no tiene por qué ser el de este.
  if (fresh.text) return { ...fresh };

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

  /**
   * Un folio que ya falló no se hereda si el mensaje trae otra cosa.
   *
   * "No encontré DEL0901; tengo 2 facturas" → "la de febrero cuál es": la
   * persona ya cambió de estrategia, y arrastrar el folio fallido a la
   * búsqueda de febrero garantiza el segundo fallo y el escalado.
   */
  const fallo = typeof previous.fallos === 'number' && previous.fallos > 0;
  const traeAlgo =
    fresh.category !== null || fresh.period !== null || fresh.folio !== null;

  const storedFolio =
    typeof previous.folio === 'string' && !(fallo && traeAlgo)
      ? previous.folio
      : null;

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

  // Sin nombre de archivo, el texto libre no se usa como filtro: "de pollos
  // pirata" contestando a qué empresa no debe convertirse en un LIKE sobre
  // el nombre, que es justo lo que hacía que el folio guardado dos mensajes
  // atrás no encontrara nada.
  return { category, period, folio, text: null };
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
    /^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que tal|hey|que onda|como estas|como andas)( (buenas|que tal|como estas|como andas|buen dia|buenos dias|buenas tardes|brother|bro|amigo|amiga|jefe|jefa|compa|hermano|buenas buenas|que hay|todo bien))?$/;

  if (saludo.test(limpio)) {
    // Con una pregunta en el aire se repite, sin gastar presupuesto: la
    // persona volvió y no tiene por qué acordarse de dónde se quedó.
    if (pendiente) return voz.saludoConPendiente(voz.PREGUNTA_PENDIENTE[pendiente]);

    const yaSaludo = turn.history.some(
      (t) => t.role === 'bot' && /\bhola\b/i.test(t.text),
    );
    if (yaSaludo) return voz.saludoDeNuevo();

    return voz.saludoInicial(
      turn.scopes.length === 1 ? turn.scopes[0]!.organizationName : null,
    );
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
    return voz.deNada();
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

/** Cuántas búsquedas vacías lleva esta solicitud. */
function readFallos(slots: unknown): number {
  const raw = (slots as { fallos?: unknown } | null)?.fallos;
  return typeof raw === 'number' ? raw : 0;
}

/** El nombre de la empresa en juego, si se sabe. */
function nombreEmpresa(
  scopes: readonly OrgScope[],
  organizationId: string | null,
): string | null {
  if (scopes.length === 1) return scopes[0]!.organizationName;
  return scopes.find((s) => s.organizationId === organizationId)?.organizationName ?? null;
}

/**
 * "De Constructora Vega tengo: 2 facturas (enero–febrero 2026), 1 contrato
 * (marzo 2026)." Lo que hay, en una línea, sin listar archivo por archivo.
 */
function describirInventario(
  lineas: readonly InventoryLine[],
  empresa: string | null,
): string {
  const partes = lineas.map((l) => {
    const tipo = l.count === 1 ? nombre(l.category) : nombrePlural(l.category);
    return `${l.count} ${tipo}${rangoMeses(l.from, l.to)}`;
  });

  const quien = empresa ? `De ${empresa} tengo` : 'Tengo';
  return `${quien}: ${partes.join(', ')}.`;
}

function rangoMeses(from: Date | null, to: Date | null): string {
  if (!from) return '';
  const a = mesCorto(from);
  const b = to ? mesCorto(to) : a;
  return a === b ? ` (${a})` : ` (${a} a ${b})`;
}

function mesCorto(d: Date): string {
  return `${MESES[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCFullYear()}`;
}

/**
 * ¿Pregunta qué hay? "qué documentos tienes", "dame las opciones", "qué me
 * puedes entregar", "qué hay de este mes". Se contesta con el inventario,
 * sin modelo y sin abrir ticket.
 */
function esInventario(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 90) return false;

  return /\b((que|cuales|cual) (documentos|docs|archivos|opciones|cosas)\b|opciones de lo que tienes|que tienes\b|que hay\b|que( (doc|docs|documento|documentos|archivo|archivos))? me puedes (dar|entregar|mandar|pasar|enviar)|que puedes (darme|entregarme|mandarme|pasarme|enviarme)|lista(me)? (lo que|los documentos|todo)|catalogo|inventario|todo lo que (tienes|tengas|haya))/.test(
    limpio,
  );
}

/** "sí", "esa", "ese mismo", "dale": para cuando solo se ofreció una opción. */
function esAfirmacion(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /^(si|sip|simon|claro|dale|va|sale|ok|esa|ese|esa misma|ese mismo|esa esta bien|ese esta bien|si esa|si ese|si por favor|si porfa|si mandala|si mandalo|mandala|mandalo|pasala|pasalo|esa por favor|ese por favor|esa me sirve|ese me sirve|me sirve|si me sirve)$/.test(
    limpio,
  );
}

/** "Pásame con un agente", "quiero hablar con alguien", "una persona por favor". */
function pideHumano(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 120) return false;

  const alguien = /\b(agente|persona|humano|humana|alguien|asesor|asesora|ejecutivo|ejecutiva|encargado|encargada|operador|operadora|soporte|un ser humano)\b/;
  const accion = /\b(pasa|pasame|pasarme|comunica|comunicame|comunicarme|hablar|hable|atienda|atiendan|contacte|contacten|llame|llamen|quiero|necesito|me puede|me pueden|con un|con una|con el|con la)\b/;

  return alguien.test(limpio) && accion.test(limpio);
}

