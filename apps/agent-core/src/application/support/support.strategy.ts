import { Injectable } from '@nestjs/common';
import type { Awaiting, DocCategory, Document } from '@prisma/client';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { AccessScopeService, type OrgScope, type ScopeResult } from './access-scope.service';
import { tokensNombre } from '../../domain/contact/nombre';
import {
  ConversationHistoryService,
  type HistoryTurn,
} from './conversation-history.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService, type InventoryLine } from './document-search.service';
import type { SearchQuery } from './document-search.service';
import { ReplyWriterService } from './reply-writer.service';
import { nombreDeArchivo, palabrasClave, parseQuery } from './query-parser';
import { parseDocumentName } from './document-name.parser';
import { parseDocumentContent } from './document-content.parser';
import { SlotExtractorService, type SlotPendiente } from './slot-extractor.service';
import {
  SolicitudService,
  type Opcion,
  type Solicitud,
} from './solicitud.service';
import { TicketService, type EscalationReason } from './ticket.service';
import {
  ACUSE,
  esCierre,
  RECONOCE,
  SALUDO,
  clasificar,
  esAfirmacion,
  esInventario,
  esPausa,
  esQuejaDeNoRecibido,
  esRechazo,
  leerEleccion,
  leerNumero,
  numeroCasual,
  preguntaCuandoEntrega,
  mencionaRechazo,
  normalizar,
  parseQueryTieneDatos,
  separarPeticionMixta,
  pideHumano,
  preguntaMeses,
  preguntaNombreEntregado,
  preguntaSobreEntregado,
  quejaParaPersona,
  type Clasificacion,
} from './message-classifier';
import { dividirPedidos, leerVariasOpciones, type SeleccionOpciones, type VariosPedidos } from './pedidos';
import { documentIntent } from './document-intent';
import * as voz from './voz';

/**
 * La conversación de soporte en lenguaje normal.
 *
 * Corre el mismo camino que /buscar —alcance, slots, búsqueda, entrega—
 * pero sin obligar al cliente a aprender comandos. Y con las mismas reglas
 * duras, que son las que evitan que el bot se pierda:
 *
 *  - El modelo extrae slots y redacta. NUNCA decide permisos, ni qué
 *    documento entregar, ni cuándo escalar.
 *  - Presupuesto de 3 preguntas. A la cuarta, escala. Un bot que pregunta
 *    cinco veces ya perdió al cliente.
 *  - 0 resultados ofrece lo que hay, más de 1 pregunta, exactamente 1
 *    entrega. Nunca "creo que te refieres a...".
 *
 * Tres memorias distintas, a propósito:
 *  - La SOLICITUD en curso (qué, de qué mes, qué se preguntó) vive en la
 *    conversación y se cierra al resolverla. La escribe el código.
 *  - El TICKET existe solo cuando hace falta una persona. Es soporte, no
 *    bitácora de entregas.
 *  - El HISTORIAL de mensajes es contexto para el modelo: para entender
 *    "y la de marzo", para no saludar dos veces. El modelo lo lee; nunca
 *    decide nada con él.
 */

const MAX_QUESTIONS = 3;

/**
 * Sin mes, cuántos documentos del tipo pedido se enseñan antes de preguntar
 * el mes. "¿Tienes la cotización?" con dos cotizaciones en el Drive se
 * contesta enseñando las dos, no preguntando "¿de qué mes?".
 */
const MAX_OPCIONES = 5;

/**
 * Cuántos documentos se mandan de un solo mensaje ("todas las de Oxxo").
 * Más que eso satura el chat: se manda esto y se ofrece acotar.
 */
const MAX_ENTREGAS = 10;

/** Intentos de escribir el nombre completo antes de pasarlo al equipo. */
const MAX_INTENTOS_NOMBRE = 3;

/** Dentro de este tiempo, el mismo archivo no se vuelve a mandar sin que lo pidan. */
const REPETIDA_MS = 30 * 60 * 1000;

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
  /** Qué clase de mensaje era: se guarda en el mensaje entrante. */
  clasificacion?: Clasificacion;
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
 * el historial.
 */
interface Turn {
  message: IncomingMessage;
  scopes: readonly OrgScope[];
  history: readonly HistoryTurn[];
  ctx: StrategyContext;
}

@Injectable()
export class SupportStrategy {
  constructor(
    private readonly scope: AccessScopeService,
    private readonly slots: SlotExtractorService,
    private readonly search: DocumentSearchService,
    private readonly delivery: DocumentDeliveryService,
    private readonly tickets: TicketService,
    private readonly solicitudes: SolicitudService,
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
    // Qué clase de mensaje es se decide primero: cambia qué se hace con él.
    const clasificacion = clasificar(message.body);

    const reply = await this.atender(message, ctx, clasificacion);
    if (!reply) return null;

    /**
     * Si se nota molesto, la respuesta empieza reconociéndolo. No en las
     * quejas ni en los escalados (sus plantillas ya lo hacen), ni en la
     * cortesía, ni cuando no hay texto: la entrega va como leyenda del
     * archivo.
     */
    //
    // Solo cuando está molesto CON el bot o su trámite (pide, pregunta,
    // sigue un caso). "Qué pinche calor" trae una grosería pero no es con
    // nosotros: disculparse ahí suena raro.
    const reconocer =
      clasificacion.molesto &&
      reply.text !== '' &&
      reply.awaiting !== 'AGENTE' &&
      (clasificacion.tipo === 'SOLICITUD' ||
        clasificacion.tipo === 'CONSULTA' ||
        clasificacion.tipo === 'SEGUIMIENTO');

    const saludo = reply.text && saludoConSolicitud(message.body)
      ? `${voz.saludoBreve(normalizar(message.body), voz.nombreDePila(message.senderName))} `
      : '';

    return {
      ...reply,
      text: reconocer ? `${voz.empatia()}\n${saludo}${reply.text}` : `${saludo}${reply.text}`,
      clasificacion,
    };
  }

  private async atender(
    message: IncomingMessage,
    ctx: StrategyContext,
    clas: Clasificacion,
  ): Promise<StrategyReply | null> {
    // Con el chat: por la línea de una empresa, solo esa empresa.
    const scope = await this.scope.resolve(message.senderId, message.chatId);

    // Antes de cualquier documento, quién es: el nombre completo, una vez
    // por número. A un número que no está en el directorio solo se le
    // contesta si pide un documento.
    if (scope.decision === 'NEEDS_NAME' || scope.decision === 'DENY_NO_MEMBERSHIP') {
      return this.identificar(message, ctx, scope);
    }

    // Sin permisos no hay conversación de soporte.
    if (scope.decision !== 'ALLOW') return null;

    // Reiniciar abandona la solicitud entera, antes de interpretar opciones
    // o acumular reintentos. cerrar conserva la última entrega y el resto
    // del contexto de la conversación.
    if (pideReinicio(message.body)) {
      await this.solicitudes.cerrar(ctx.conversationId);
      return {
        text: 'Va, empezamos de nuevo. Dime qué documento necesitas.',
        awaiting: 'CLIENTE',
      };
    }

    // El mensaje actual ya está guardado (fase 1 del caso de uso); se
    // excluye para que no aparezca dos veces en el prompt.
    const turn: Turn = {
      message,
      scopes: scope.scopes,
      history: await this.history.recent(ctx.conversationId, {
        excludeId: message.id,
      }),
      ctx,
    };

    // Una foto o un audio sin texto no traen nada que extraer. Antes caían
    // en el flujo de documentos y provocaban un "¿qué documento necesitas?"
    // que no venía a cuento.
    if (message.kind !== 'TEXT' && message.body.trim() === '') {
      return { text: voz.archivoNoLeible(), awaiting: 'CLIENTE' };
    }

    let sol = await this.solicitudes.actual(ctx.conversationId);

    // "Olvida eso, dame otra factura" o "Es todo, ahora necesito un contrato"
    // abandonan la solicitud anterior, incluso si conservan la categoría,
    // pero conservan y procesan los datos nuevos del mismo mensaje. El cierre
    // de SolicitudService solo borra la petición; no toca última entrega,
    // conversación, identidad ni alcance autorizado.
    if (abandonaConNuevaSolicitud(message.body)) {
      await this.solicitudes.cerrar(ctx.conversationId);
      sol = await this.solicitudes.actual(ctx.conversationId);
    }

    // Un cierre explícito abandona solo la solicitud que sigue esperando
    // respuesta. SolicitudService.cerrar conserva el resto del contexto,
    // incluida la última entrega.
    if (
      sol.ultimaPregunta &&
      esCierre(message.body) &&
      !parseQueryTieneDatos(normalizar(message.body))
    ) {
      await this.solicitudes.cerrar(ctx.conversationId);
      return { text: voz.cierreSolicitud(), awaiting: 'NADIE' };
    }

    // Una pausa es una respuesta al flujo en curso, no un número de opción.
    // Va antes de leerNumero() para que "Dame un segundo" nunca elija la 2.
    if (esPausa(message.body) && (tieneDatos(sol) || (sol.opciones?.length ?? 0) > 0)) {
      return { text: voz.respuestaPausa(), awaiting: 'CLIENTE' };
    }

    /**
     * Respuesta a una lista numerada: "1", "la 2", "el número dos".
     *
     * Los botones de WhatsApp no funcionan de forma fiable fuera de la API
     * oficial —se rompieron con multidispositivo—, así que la lista
     * numerada es la forma que sí llega a todos los teléfonos.
     */
    // También "la 1, no la 3" y "todas menos la 2", antes de leerNumero().
    /**
     * Respuesta a "¿te mando la 1 y la 3?". Un "sí" manda lo entendido; un
     * "no" lo descarta y se vuelve a preguntar; cualquier otra cosa se
     * atiende como mensaje nuevo (la confirmación se olvida).
     */
    // "¿Me lo puedes entregar a las 2?" con la lista en pantalla: pregunta
    // cuándo, no elige ni pide una persona. Antes caía en la charla, que lo
    // escalaba, y el "O las 2?" de después elegía la opción 2.
    const hayListaDeDocumentos = sol.opciones?.some((o) => o.tipo === 'documento') ?? false;
    if (preguntaCuandoEntrega(message.body) && (hayListaDeDocumentos || (sol.porConfirmar?.length ?? 0) > 0)) {
      return { text: voz.entregaAlMomento(), awaiting: 'CLIENTE' };
    }

    if (sol.porConfirmar?.length) {
      const opciones = (sol.opciones ?? []).filter((o) => o.tipo === 'documento');
      // "Dame un segundo" no contesta la confirmación, pero tampoco la tira.
      if (esPausa(message.body)) return { text: voz.respuestaPausa(), awaiting: 'CLIENTE' };
      await this.solicitudes.guardar(ctx.conversationId, { porConfirmar: null });
      if (esAfirmacion(message.body)) {
        const elegidas = opciones.filter((o) => sol.porConfirmar!.includes(o.n));
        if (elegidas.length > 0) return this.mandarOpciones(turn, elegidas, opciones);
      } else if (esRechazo(message.body) || /^\s*no\b/i.test(message.body.trim()) && leerVariasOpciones(message.body) === null && leerNumero(message.body) === null) {
        return { text: voz.corregirSeleccion(), awaiting: 'CLIENTE' };
      }
      sol = await this.solicitudes.actual(ctx.conversationId);
    }

    // "a las 1 y 3 salgo" no es elegir la 1 y la 3.
    const varias = numeroCasual(message.body) ? null : leerVariasOpciones(message.body);
    if (varias !== null && hayListaDeDocumentos) {
      return this.entregarVariasOpciones(varias, turn, sol);
    }

    // Solo lo que no admite otra lectura se manda directo; "¿la 2?" u "o
    // las 2" se confirma, y "llego a las 2" ni siquiera cuenta.
    const eleccion = leerEleccion(message.body);
    if (eleccion !== null) {
      const opcion = sol.opciones?.find((o) => o.n === eleccion.n);
      if (!eleccion.clara && opcion?.tipo === 'documento') {
        return this.confirmarOpciones(turn, [opcion]);
      }
      const resuelto = await this.resolverOpcion(eleccion.n, turn, sol);
      if (resuelto) return resuelto;
    }

    // "Sí", "esa", "mándala": cuando se ofreció UNA sola opción, afirmar
    // es elegirla.
    if (esAfirmacion(message.body) && sol.opciones?.length === 1) {
      const resuelto = await this.resolverOpcion(1, turn, sol);
      if (resuelto) return resuelto;
    }

    /**
     * "¿Qué documentos tienes?", "dame las opciones", "¿qué hay de este
     * mes?": se contesta con lo que hay, sin modelo y sin tocar la
     * solicitud en curso.
     */
    /**
     * Quejas que el bot no puede resolver solo —una factura con el RFC
     * mal, alguien que lleva días esperando, "este bot no sirve"— y
     * preguntas por un caso que ya tiene una persona. Se atienden ANTES de
     * buscar nada: contestarle a una queja con otra búsqueda es lo que la
     * convierte en dos quejas.
     *
     * Y antes del inventario: "no me gustó el servicio; ¿qué facturas
     * tienes?" recibía la lista y la inconformidad se perdía.
     */
    const errorDocumentalExplicito = clas.motivo !== 'error_en_documento' ||
      /\b(?:factura|cfdi|documento|archivo|contrato|cotizacion|reporte|poliza|rfc|iva|subtotal|importe|monto|datos fiscales)\b/.test(normalizar(message.body));
    if ((quejaParaPersona(clas) && errorDocumentalExplicito) || clas.tipo === 'SEGUIMIENTO') {
      const atendida = await this.atenderQueja(turn, sol, clas);
      if (atendida) {
        // "Te voy a demandar, pero primero pásame mi factura": la queja va
        // con una persona Y la petición se atiende. Ninguna se pierde.
        const peticion = await this.peticionJuntoAQueja(message, ctx);
        return peticion ? juntarRespuestas(atendida, peticion) : atendida;
      }
    }

    if (esInventario(message.body)) {
      return this.inventario(turn, sol);
    }

    /**
     * Molesto, y el bot ya le preguntó, no encontró o le ofreció lo que no
     * era: no se hace una vuelta más. Pasa a una persona.
     */
    if (
      clas.molesto &&
      clas.tipo !== 'CORTESIA' &&
      (sol.preguntas > 0 || sol.fallos > 0 || sol.rechazados.length > 0)
    ) {
      return this.escalarPorMolestia(turn, sol);
    }

    /**
     * "Te equivocaste, eso no es lo que pedí", sin más datos: es un rechazo
     * dicho como reclamo, y se atiende igual que "no es esa".
     */
    const reclamaEquivocado =
      clas.motivo === 'documento_equivocado' &&
      !parseQueryTieneDatos(normalizar(message.body));

    /**
     * "Pásame con un agente", "quiero hablar con una persona". Se escala
     * directo: pedir humano es una instrucción, no una duda.
     */
    /**
     * "No es esa", "ninguna de esas", "tampoco": rechaza lo ofrecido o lo
     * entregado. Antes esto caía en el modelo, que sacaba el tipo del
     * contexto, y el bot volvía a enseñar la misma lista tres veces.
     */
    if (esRechazo(message.body) || reclamaEquivocado) {
      const rechazado = await this.rechazar(turn, sol);
      if (rechazado) return rechazado;
    }

    if (pideHumano(message.body)) {
      return this.pasarAHumano(turn, sol);
    }

    /**
     * "No veo el doc", "no me llegó", "mándala otra vez".
     *
     * Es una queja sobre lo último que se entregó, no una petición nueva.
     */
    if (esQuejaDeNoRecibido(message.body)) {
      const reenviado = await this.reenviarUltimo(turn, sol);
      if (reenviado) return reenviado;
    }

    /**
     * "¿Cómo sabes que es de este mes?", "¿de qué fecha es?", "¿seguro?".
     *
     * Es una pregunta sobre lo que se acaba de mandar, no una petición.
     * Se contesta con lo que el bot de verdad sabe del archivo —lo que
     * dice su nombre y lo que dice por dentro— y, si no lo sabe, lo dice.
     * Antes esto volvía a mandar el mismo archivo por cuarta vez.
     */
    if (preguntaSobreEntregado(message.body)) {
      const explicado = await this.explicarEntregado(turn, sol);
      if (explicado) return explicado;
    }

    /**
     * "Sí es la cotización, pero esa no es de este mes": un rechazo que
     * además trae datos. Lo rechazado se apunta para no volver a
     * ofrecerlo, y el mensaje sigue su camino con lo que trae. Antes,
     * como traía datos, no contaba como rechazo, y la búsqueda volvía a
     * dar con el mismo archivo.
     */
    if (mencionaRechazo(message.body) || clas.motivo === 'documento_equivocado') {
      const rechazado = await this.apuntarRechazo(turn, sol);
      if (rechazado) return rechazado;
    }

    /**
     * Si el bot acaba de hacer una pregunta, este mensaje es la respuesta.
     * Se decide ANTES de extraer nada, porque cambia cómo se lee el texto.
     */
    const pendiente = sol.ultimaPregunta;

    /**
     * Lo que la solicitud ya tiene resuelto, en palabras, para el modelo.
     *
     * Si no hay solicitud en curso pero se acaba de entregar algo, el tipo
     * de lo entregado sirve de contexto: "y la de marzo" después de una
     * factura es una factura. Es lo único que sobrevive al cierre.
     */
    const entregada = await this.solicitudes.ultimaEntrega(ctx.conversationId);
    const necesitaContextoEntregado = !tieneDatos(sol) && !parseQuery(message.body).category;
    const documentoEntregado = entregada && necesitaContextoEntregado
      ? await this.search.byId(entregada.documentId, turn.scopes)
      : null;
    const contexto: Solicitud =
      tieneDatos(sol) || !documentoEntregado
        ? sol
        : { ...sol, category: documentoEntregado.category };

    const conocido = describirSlots(contexto, scope.scopes);
    const enCurso = tieneDatos(contexto);

    /**
     * Saludos, gracias y "ok" se contestan sin modelo. Solo si no hay una
     * pregunta en el aire: "ok" contestando a "¿de qué mes?" sí tiene que
     * pasar por el flujo normal.
     */
    const rapida = respuestaRapida(message.body, turn, pendiente);
    if (rapida !== null) {
      return { text: rapida, awaiting: pendiente ? 'CLIENTE' : 'NADIE' };
    }

    // La empresa se busca primero en el texto crudo, por reglas: un nombre
    // con erratas también cuenta, y si se reconoce aquí el extractor puede
    // ahorrarse la llamada al modelo.
    const empresaEnTexto = this.resolveCompany(message.body, scope.scopes);
    const intent = documentIntent(message.body, {
      enCurso,
      pendiente,
      companyName: scope.scopes.find((s) => s.organizationId === empresaEnTexto)?.organizationName ?? null,
    });
    if (intent.kind === 'other') {
      if (clas.tipo === 'SOLICITUD') clas.tipo = 'OTRO';
      // El contexto puede describir la última entrega: antes de dárselo al
      // redactor se revalida contra el alcance actual. El historial ya va
      // sin nombres de archivo (formatHistory), así que se conserva entero
      // y la charla no pierde memoria por un permiso retirado.
      const vigente = !entregada || (necesitaContextoEntregado
        ? documentoEntregado !== null
        : await this.search.byId(entregada.documentId, turn.scopes) !== null);
      return { text: await this.smallTalk(turn, vigente ? conocido : [], clas), awaiting: 'NADIE' };
    }
    if (intent.kind === 'ambiguous') {
      const candidate = parseQuery(message.body);
      if (candidate.period && !contexto.category) {
        await this.solicitudes.guardar(ctx.conversationId, { period: candidate.period.toISOString() });
      }
      const slot = contexto.category ? 'detalle' : 'categoria';
      return this.ask(turn, readAsked(sol), slot, voz.PREGUNTA_PENDIENTE[slot]);
    }

    /**
     * Varios documentos en un mensaje: "la factura de octubre y noviembre
     * con la de septiembre", "todas las de Oxxo y McDonald's". Antes se
     * leía como una sola búsqueda y se entregaba solo una parte, callando
     * el resto. Va antes del modelo: partir la lista es por reglas.
     */
    const varios = dividirPedidos(intent.request);
    if (varios) {
      return this.atenderVarios(turn, sol, contexto, varios, empresaEnTexto, intent.request);
    }

    const extraction = await this.slots.extract(intent.request, {
      pendiente,
      history: turn.history,
      known: conocido,
      enCurso,
      companyKnown: empresaEnTexto !== null,
    });

    // “Pásame el documento de Juan Pérez” expresa un objeto documental y un
    // nombre aunque el modelo niegue la petición. La evidencia de intención
    // viene del verbo y del objeto, no del texto residual por sí mismo.
    if (!extraction.query.text && !extraction.query.category && !extraction.query.folio &&
        /\b(?:documento|archivo|pdf|papel|copia)\b/.test(normalizar(intent.request))) {
      const keys = palabrasClave(intent.request);
      if (keys.length > 0) extraction.query.text = keys.join(' ');
    }

    const empresaMencionada =
      empresaEnTexto ??
      this.resolveCompany(extraction.companyHint, scope.scopes);

    // El nombre de la empresa no es palabra clave: "la factura de Pollos
    // Pirata" busca facturas de esa empresa, no archivos que digan "pollos".
    extraction.query.text = sinNombresDeEmpresa(extraction.query.text, scope.scopes);

    const aporta =
      extraction.query.category !== null ||
      extraction.query.period !== null ||
      extraction.query.folio !== null ||
      extraction.query.text !== null ||
      empresaMencionada !== null;

    /**
     * Lo que las reglas no supieron clasificar: si aporta datos, es una
     * solicitud; si no, vale la etiqueta del modelo. Solo cambia la
     * etiqueta y el tono de la respuesta; lo que se hace lo decide el código.
     */
    if (clas.tipo === 'OTRO') {
      if (aporta) {
        clas.tipo = 'SOLICITUD';
      } else if (extraction.tipoMensaje) {
        clas.tipo = extraction.tipoMensaje;
        clas.fuente = 'modelo';
      }
    }

    /**
     * Sin ningún dato nuevo y sin pregunta en el aire, es charla — diga lo
     * que diga el modelo. Un mensaje que no aporta nada no puede cambiar
     * la búsqueda; lo único que haría es repetir la anterior.
     */
    if (!aporta) return this.ask(turn, readAsked(sol), 'categoria', voz.preguntaTipo());

    // Una descripción sin tipo puede ser útil, pero “lo de Roberto” aún no
    // identifica qué documento buscar. Un archivo con nombre o un pedido
    // explícito de “documento/archivo” sí autorizan buscar por texto.
    if (extraction.query.text && !extraction.query.category && !extraction.query.folio &&
        !contexto.category && !nombreDeArchivo(extraction.query.text) &&
        !/\b(?:documento|archivo|pdf|papel|copia)\b/.test(normalizar(intent.request))) {
      return this.ask(turn, readAsked(sol), 'categoria', voz.preguntaTipo());
    }

    /**
     * ESTO es lo que convierte mensajes sueltos en una conversación: lo
     * nuevo se funde con lo que la solicitud ya sabía. Un hueco nunca
     * borra lo que ya estaba; un dato que contradice abre otra solicitud.
     */
    const query = mergeSlots(contexto, extraction.query);

    // Como con el mes y el folio: dar el tipo por primera vez completa la
    // búsqueda en curso, no la cambia. Solo un tipo DISTINTO es otra.
    const cambioCategoria =
      extraction.query.category !== null &&
      sol.category !== null &&
      extraction.query.category !== sol.category;
    const cambioPeriodo =
      extraction.query.period !== null &&
      sol.period !== null &&
      extraction.query.period.toISOString() !== sol.period;
    const cambioFolio =
      extraction.query.folio !== null && sol.folio !== null && extraction.query.folio !== sol.folio;
    // "Mejor de Vega" después de "la factura de Acme": las opciones, los
    // rechazos y las preguntas eran de documentos de Acme.
    const cambioEmpresa =
      empresaMencionada !== null && sol.organizationId !== null && empresaMencionada !== sol.organizationId;
    const invalidaBusquedaAnterior = cambioCategoria || cambioPeriodo || cambioFolio || cambioEmpresa;

    const patch: Partial<Solicitud> = {
      category: query.category,
      period: query.period?.toISOString() ?? null,
      folio: query.folio,
    };
    if (empresaMencionada) patch.organizationId = empresaMencionada;

    // Una categoría, un periodo o un folio distintos identifican otra
    // búsqueda. No arrastres opciones, preguntas ni fallos de la anterior.
    if (invalidaBusquedaAnterior) {
      Object.assign(patch, {
        opciones: null,
        preguntas: 0,
        preguntado: {},
        ultimaPregunta: null,
        fallos: 0,
        rechazados: [],
      } satisfies Partial<Solicitud>);
    }

    // Otro tipo de documento es otra solicitud: los fallos de la anterior
    // no cuentan, o el segundo "no encontré" escalaría por acumulación.
    if (extraction.query.category && extraction.query.category !== sol.category) {
      patch.fallos = 0;
    }

    const actualizada = await this.solicitudes.guardar(ctx.conversationId, patch);

    return this.avanzar(turn, query, actualizada);
  }

  /**
   * Con lo que la solicitud ya sabe, da el siguiente paso: pregunta lo que
   * falta, busca, entrega o escala. Aquí no se lee el mensaje ni se llama
   * al modelo: solo se mira el estado.
   */
  private async avanzar(
    turn: Turn,
    query: SearchQuery,
    sol: Solicitud,
  ): Promise<StrategyReply> {
    const { scopes } = turn;
    const asked = readAsked(sol);

    // Presupuesto agotado: escala en vez de seguir preguntando.
    if (asked.total >= MAX_QUESTIONS) {
      return this.escalarPorNoEntender(turn, sol);
    }

    const organizationId =
      scopes.length === 1
        ? scopes[0]!.organizationId
        : empresaGuardada(sol, scopes);

    // Varias empresas y no dijo cuál: se pregunta. Elegir la primera es
    // exactamente cómo se entrega la factura de la empresa equivocada.
    if (scopes.length > 1 && !organizationId) {
      await this.solicitudes.guardar(turn.ctx.conversationId, {
        opciones: scopes.map((s, i) => ({
          n: i + 1,
          tipo: 'empresa' as const,
          id: s.organizationId,
          nombre: s.organizationName,
        })),
      });

      return this.ask(
        turn,
        asked,
        'empresa',
        voz.preguntaEmpresa(),
        scopes.map((s, i) => `*${i + 1}.* ${s.organizationName}`),
      );
    }

    // Un mes sin tipo ni folio no identifica un documento, aunque solo haya
    // una coincidencia visible. La aclaración va antes de consultar el índice.
    if (!query.category && !query.folio && query.period && !query.text) {
      return this.ask(turn, asked, 'categoria', voz.preguntaTipoConMes(mesEnPalabras(query.period)));
    }

    /**
     * Con nombre de archivo se busca por nombre y nada más: ni tipo ni
     * mes. "La cotización BrandoCelSanchez_2026" tiene que encontrar ese
     * archivo aunque esté clasificado como factura o sea de otro mes.
     */
    if (query.text && nombreDeArchivo(query.text)) {
      const porNombre = await this.search.search(scopes, {
        category: null,
        period: null,
        folio: null,
        text: query.text,
        organizationId,
        excludeIds: excluir(query, sol),
      });
      return this.resolverResultados(turn, query, porNombre, sol);
    }

    /**
     * Palabras clave ("Parcia Ima", "contable"): se buscan en el nombre y
     * DENTRO del documento, junto con el tipo y el mes. Si con todo no
     * hay nada, se prueba solo con las palabras: quizá el tipo o el mes
     * estaban mal dichos, pero el nombre del cliente no.
     */
    if (query.text) {
      const conTodo = await this.search.search(
        scopes,
        { ...query, organizationId, excludeIds: excluir(query, sol) },
        MAX_OPCIONES + 1,
      );
      if (conTodo.length > 0) {
        return this.resolverResultados(turn, query, conTodo, sol);
      }

      /**
       * Las palabras clave son una ayuda, no una condición. Si con tipo y
       * mes (o folio) sí hay algo y las palabras lo tiran, gana lo que
       * sí es un dato: "me ayudarías con la factura de marzo" no debe
       * fallar porque ningún archivo diga "ayudarías".
       */
      if (query.folio || (query.category && query.period)) {
        const sinPalabras = { ...query, text: null };
        const porDatos = await this.search.search(
          scopes,
          { ...sinPalabras, organizationId, excludeIds: excluir(sinPalabras, sol) },
          MAX_OPCIONES + 1,
        );
        if (porDatos.length > 0) {
          return this.resolverResultados(turn, sinPalabras, porDatos, sol);
        }
      }

      const soloPalabras = await this.search.search(
        scopes,
        { category: null, period: null, folio: null, text: query.text, organizationId, excludeIds: excluir(query, sol) },
        MAX_OPCIONES + 1,
      );
      return this.resolverResultados(turn, query, soloPalabras, sol);
    }

    /**
     * Con un solo dato (tipo o mes) se mira cuántos hay antes de preguntar.
     * Enseñar dos o tres para que señale una es lo que haría alguien del
     * equipo. Solo si hay demasiados se pregunta lo que falta.
     */
    if (!query.folio && (!query.category || !query.period)) {
      const candidatos = await this.search.search(
        scopes,
        { ...query, organizationId, excludeIds: excluir(query, sol) },
        MAX_OPCIONES + 1,
      );

      // Un mes solo no identifica qué documento pidió la persona. Incluso
      // con un único resultado visible se aclara el tipo antes de entregarlo.
      if (!query.category && !query.folio && query.period && !query.text) {
        return this.ask(turn, asked, 'categoria', voz.preguntaTipo());
      }

      if (candidatos.length > MAX_OPCIONES) {
        if (query.category) {
          return this.ask(turn, asked, 'periodo', voz.preguntaMes(nombreConArticulo(query.category)));
        }
        return this.ask(
          turn,
          asked,
          'categoria',
          query.period ? voz.preguntaTipoConMes(mesEnPalabras(query.period)) : voz.preguntaTipo(),
        );
      }

      if (candidatos.length === 0 && !query.category) {
        return this.ask(turn, asked, 'categoria', voz.preguntaTipo());
      }

      return this.resolverResultados(turn, query, candidatos, sol);
    }

    const results = await this.search.search(scopes, { ...query, organizationId, excludeIds: excluir(query, sol) });
    return this.resolverResultados(turn, query, results, sol);
  }

  /** 0 resultados ofrece alternativas, 1 entrega, varios se enseñan numerados. */
  private async resolverResultados(
    turn: Turn,
    query: SearchQuery,
    results: Document[],
    sol: Solicitud,
  ): Promise<StrategyReply> {
    if (results.length === 0) {
      return this.sinResultados(turn, query, sol);
    }

    // Demasiados para enseñarlos: se pide el dato que más recorta.
    if (results.length > MAX_OPCIONES) {
      const asked = readAsked(sol);
      if (!query.period) {
        return this.ask(turn, asked, 'periodo', voz.preguntaMes(nombreConArticulo(query.category)));
      }
      return this.ask(turn, asked, 'detalle', voz.faltaInformacion(describirPedido(query)));
    }

    if (results.length > 1) {
      await this.guardarOpciones(turn, results);

      const que = query.period
        ? `${nombrePlural(query.category)} de ${mesEnPalabras(query.period)}`
        : nombrePlural(query.category);
      const total = results.length === MAX_OPCIONES
        ? await this.search.count(turn.scopes, {
          ...query,
          organizationId: turn.scopes.length === 1
            ? turn.scopes[0]!.organizationId
            : empresaGuardada(sol, turn.scopes),
          excludeIds: excluir(query, sol),
        })
        : results.length;

      return {
        text: [
          total > results.length
            ? voz.encabezadoListaLimitada(total, results.length, que)
            : voz.encabezadoLista(results.length, que),
          ...results.map((doc, i) => `*${i + 1}.* ${describe(doc)}`),
          '',
          voz.pieLista(),
        ].join('\n'),
        awaiting: 'CLIENTE',
        topic: query.category,
      };
    }

    return this.entregarSiCoincide(turn, query, results[0]!);
  }

  /**
   * Antes de mandar UN documento, se comprueba que sea lo que pidió.
   *
   * La búsqueda exacta ya garantiza tipo y mes; pero las búsquedas de
   * respaldo (por nombre parecido, por palabras clave) pueden dar con un
   * archivo de otro mes, o de mes desconocido. Mandarlo sin decir nada es
   * exactamente lo que hacía que "la cotización de este mes" llegara
   * como una cotización de la que no se sabía el mes — y que la persona
   * preguntara "¿cómo sabes que es de este mes?".
   *
   * Si contradice, no se entrega: se ofrece diciendo de qué mes es. Si
   * no hay evidencia, se ofrece diciendo que no trae mes. Y con "sí"
   * se manda.
   */
  private async entregarSiCoincide(
    turn: Turn,
    query: SearchQuery,
    doc: Document,
  ): Promise<StrategyReply> {
    const pedido = describirPedido(query);

    // El tipo pedido manda: la búsqueda por folio no filtra por tipo y los
    // rescates por nombre o palabras pueden dar con otro. Puede ser un
    // archivo mal clasificado, así que se ofrece, pero no se manda solo.
    if (query.category && doc.category !== query.category) {
      await this.guardarOpciones(turn, [doc]);
      return {
        text: voz.unicaDeOtroTipo(pedido, doc.name, nombreConArticulo(doc.category)),
        awaiting: 'CLIENTE',
        topic: query.category,
      };
    }

    const veredicto = coincideMes(doc, query);
    if (veredicto === 'coincide') return this.entregar(turn, doc);

    await this.guardarOpciones(turn, [doc]);

    const text =
      veredicto === 'contradice'
        ? voz.unicaDeOtroMes(pedido, doc.name, mesEnPalabras(doc.period!))
        : voz.unicaSinMes(pedido, doc.name);

    return { text, awaiting: 'CLIENTE', topic: query.category ?? doc.category };
  }

  /**
   * No se encontró lo pedido. Nunca se contesta "no encontré" y una lista
   * de todo: eso no escala (con cien documentos sería un rollo) y suena a
   * que el bot se rindió. Se hace lo que haría alguien del equipo:
   *
   *  1. Buscar por parecido de nombre: "cotización" tiene que dar con
   *     "Cotizacion_Vega_2026.pdf" aunque esté mal clasificado.
   *  2. Si pidió un mes concreto y hay del mismo tipo en otros meses, se
   *     enseñan si son pocos; si son muchos, se pide folio o nombre.
   *  3. Si nada se parece, se pide un dato más concreto. Es una pregunta
   *     y cuenta como tal: a la segunda vez sin dar con nada, nace el
   *     ticket, porque con esa información no se puede resolver solo.
   *
   * Sin permiso y sin resultados siguen dando lo mismo: todo lo que se
   * ofrece sale del alcance de quien pregunta.
   */
  private async sinResultados(
    turn: Turn,
    query: SearchQuery,
    sol: Solicitud,
  ): Promise<StrategyReply> {
    const { scopes } = turn;
    const organizationId =
      scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(sol, scopes);

    const fallos = readFallos(sol) + 1;
    await this.solicitudes.guardar(turn.ctx.conversationId, { fallos });

    const pedido = describirPedido(query);
    const conocidos = {
      folio: Boolean(query.folio), periodo: Boolean(query.period), nombre: Boolean(query.text),
    };

    // 1. Parecidos por nombre, sin importar cómo estén clasificados.
    if (query.category && !query.folio) {
      const porNombre = await this.search.search(
        scopes,
        { category: null, period: null, folio: null, text: raizNombre(query.category), organizationId, excludeIds: excluir(query, sol) },
        MAX_OPCIONES + 1,
      );

      if (porNombre.length === 1) {
        const unica = porNombre[0]!;
        // Del mes pedido (o sin mes que lo contradiga): se manda. De otro
        // mes: se ofrece diciendo cuál es, que para eso está el paso 2.
        if (coincideMes(unica, query) !== 'contradice') {
          return this.entregarSiCoincide(turn, query, unica);
        }
      }
      if (porNombre.length > 1 && porNombre.length <= MAX_OPCIONES) {
        await this.guardarOpciones(turn, porNombre);
        return {
          text: [
            voz.seParecen(pedido),
            ...porNombre.map((doc, i) => `*${i + 1}.* ${describe(doc)}`),
            '',
            voz.pieParecidos(),
          ].join('\n'),
          awaiting: 'CLIENTE',
          topic: query.category,
        };
      }
    }

    // 2. Con mes: del mismo tipo en otros meses.
    if (query.period && query.category && !query.text) {
      const otrosMeses = await this.search.search(
        scopes,
        { category: query.category, period: null, folio: query.folio, text: null, organizationId, excludeIds: excluir(query, sol) },
        MAX_OPCIONES + 1,
      );

      // Una sola de otro mes: se ofrece diciendo de qué mes es, sin lista.
      if (otrosMeses.length === 1) {
        return this.entregarSiCoincide(turn, query, otrosMeses[0]!);
      }

      if (otrosMeses.length > 1 && otrosMeses.length <= MAX_OPCIONES) {
        await this.guardarOpciones(turn, otrosMeses);
        return {
          text: [
            voz.noEncontreParecidos(pedido),
            ...otrosMeses.map((doc, i) => `*${i + 1}.* ${describe(doc)}`),
            '',
            voz.pieParecidos(),
          ].join('\n'),
          awaiting: 'CLIENTE',
          topic: query.category,
        };
      }

      if (otrosMeses.length > MAX_OPCIONES) {
        const total = await this.search.count(scopes, {
          category: query.category,
          period: null,
          folio: query.folio,
          text: null,
          organizationId,
          excludeIds: excluir(query, sol),
        });
        return this.ask(
          turn,
          readAsked(sol),
          'detalle',
          voz.muchosSinMes(total, nombrePlural(query.category), mesEnPalabras(query.period)),
        );
      }
    }

    // 3. Falta información. Es una pregunta; repetirla es escalar.
    const asked = readAsked(sol);
    if (!asked.slots.detalle) {
      // Si ya rechazó lo único que había, decirlo así: "solo tenía esa".
      const pregunta =
        sol.rechazados.length > 0
          ? voz.soloTeniaEsa(pedido, sol.rechazados.length, conocidos)
          : voz.sinCoincidencias(pedido, conocidos);
      return this.ask(turn, asked, 'detalle', pregunta);
    }

    const denial = query.category
      ? this.scope.denialFor(scopes, query.category, query.period)
      : null;

    await this.scope.audit({
      waId: turn.message.senderId,
      query: turn.message.body,
      documentId: null,
      decision: denial ?? 'NOT_FOUND',
      decidedBy: denial ? 'fuera del alcance' : 'sin coincidencias en el índice',
    });

    const { ticket, agente } = await this.escalar(
      turn,
      sol,
      denial ? 'sin_permiso' : 'sin_resultados',
      organizationId,
    );

    return {
      text: voz.sinInformacionEscalado(pedido, `#${ticket.number}`, agente),
      awaiting: 'AGENTE',
      topic: query.category,
    };
  }

  /**
   * Encola el documento y cierra la solicitud.
   *
   * El texto va como leyenda DEL archivo, no como mensaje aparte: un
   * "aquí está" separado salía aunque el archivo fallara después. Sin
   * folio: entregar no es un caso de soporte. Y al entregar se cierra la
   * solicitud: lo siguiente que pida empieza limpio.
   */
  private async entregar(
    turn: Turn,
    doc: Document,
    /** Cómo nombrarlo en la leyenda; por defecto, tipo y mes. */
    comoLlamarlo?: string,
    /** true = la persona lo pidió a propósito ("sí, esa"): se manda aunque sea repetido. */
    forzar = false,
    /** true = va detrás de otro en el mismo lote: la leyenda dice "también". */
    otraMas?: boolean,
  ): Promise<StrategyReply> {
    const { conversationId } = turn.ctx;

    /**
     * El mismo archivo que se acaba de mandar no se manda otra vez a
     * menos que lo pidan. Una búsqueda distinta que cae en el mismo
     * documento ("del mes de septiembre" justo después de recibir la de
     * septiembre) se contesta señalándolo, no repitiéndolo: nadie del
     * equipo mandaría el mismo PDF cuatro veces seguidas.
     */
    if (!forzar) {
      const entregada = await this.solicitudes.ultimaEntrega(conversationId);
      const haceNada =
        entregada !== null &&
        entregada.documentId === doc.id &&
        Date.now() - new Date(entregada.at).getTime() < REPETIDA_MS;

      if (haceNada) {
        await this.guardarOpciones(turn, [doc]);
        return { text: voz.esLaMisma(doc.name), awaiting: 'CLIENTE', topic: doc.category };
      }
    }

    await this.scope.audit({
      waId: turn.message.senderId,
      query: turn.message.body,
      documentId: doc.id,
      decision: 'ALLOW',
      decidedBy: 'dentro del alcance',
    });

    // "También te mando" solo cuando sigue a otra entrega y lo pidió como
    // una más ("y también la de marzo"); una petición nueva no es "también".
    const ultimoDelBot = [...turn.history].reverse().find((t) => t.role === 'bot');
    const yaEntregoAlgo =
      otraMas ??
      ((ultimoDelBot?.text.startsWith('[documento]') ?? false) &&
        /\b(?:tambien|ademas|otra|otro|y la|y el)\b/.test(normalizar(turn.message.body)));
    const que =
      comoLlamarlo ??
      `${nombreConArticulo(doc.category)}${doc.period ? ` de ${mesEnPalabras(doc.period)}` : ''}`;

    const sent = await this.delivery.deliver(
      { chatId: turn.message.chatId, waId: turn.message.senderId, origen: turn.message.id },
      doc,
      voz.entrega(
        que,
        yaEntregoAlgo,
        otraMas === true || !saludoConSolicitud(turn.message.body)
          ? ''
          : voz.saludoBreve(normalizar(turn.message.body), voz.nombreDePila(turn.message.senderName)),
        otraMas === true ? doc.name : null,
      ),
      'Si tampoco lo ves, escríbeme "no me llegó" y te lo vuelvo a mandar.',
    );

    if (!sent.ok) {
      const sol = await this.solicitudes.actual(conversationId);
      const { ticket, agente } = await this.escalar(turn, sol, 'sin_resultados', doc.organizationId);
      return {
        text: voz.entregaFallida(`#${ticket.number}`, agente),
        awaiting: 'AGENTE',
        topic: doc.category,
      };
    }

    await this.solicitudes.registrarEntrega(conversationId, doc);
    await this.solicitudes.cerrar(conversationId);

    // Sin texto aparte: la leyenda del archivo ya lo dice todo.
    return { text: '', awaiting: 'NADIE', topic: doc.category };
  }

  /**
   * Confirmar quién escribe, por su nombre completo.
   *
   *  - Con membresía (NEEDS_NAME): el nombre se compara con el que registró
   *    el equipo. Si coincide, queda confirmado para este número y se
   *    atiende lo que había pedido. Tras MAX_INTENTOS_NOMBRE fallos, o si
   *    el equipo no registró ningún nombre, pasa a una persona.
   *  - Sin membresía: el nombre NO da acceso (cualquiera puede escribir un
   *    nombre). Si coincide con alguien registrado, se avisa al equipo para
   *    que confirme y asocie el número. La respuesta es la misma coincida o
   *    no: a un desconocido no se le dice quién está registrado.
   *
   * El nombre escrito no va a la auditoría: es un dato personal y ahí no
   * hace falta. Sí va al ticket, que es donde una persona lo compara.
   */
  private async identificar(
    message: IncomingMessage,
    ctx: StrategyContext,
    scope: ScopeResult,
  ): Promise<StrategyReply | null> {
    const conocido = scope.decision === 'NEEDS_NAME';
    const texto = message.body.trim();
    if (texto === '') return null;

    const sol = await this.solicitudes.actual(ctx.conversationId);
    const espera = sol.pideNombre ?? null;
    const pide =
      documentIntent(texto, { enCurso: false, pendiente: null, companyName: null }).kind === 'document';

    if (espera?.escalado) {
      return conocido || pide ? { text: voz.nombreEnRevision(), awaiting: 'AGENTE' } : null;
    }

    if (!espera) {
      if (!conocido && !pide) return null;
      await this.solicitudes.guardar(ctx.conversationId, {
        pideNombre: { intentos: 0, pedido: pide ? texto : null, escalado: false },
      });
      return { text: voz.pedirNombre(), awaiting: 'CLIENTE' };
    }

    if (esCierre(texto) || pideReinicio(texto)) {
      await this.solicitudes.cerrar(ctx.conversationId);
      return { text: voz.cierreSolicitud(), awaiting: 'NADIE' };
    }

    // Pidió otra cosa en vez de dar el nombre: se guarda y se repite la pregunta.
    if (pide) {
      await this.solicitudes.guardar(ctx.conversationId, { pideNombre: { ...espera, pedido: texto } });
      return { text: voz.pedirNombre(), awaiting: 'CLIENTE' };
    }

    // "Hola", "Juan": no es un nombre completo, y no cuenta como intento.
    if (tokensNombre(texto).length < 2) {
      return { text: voz.nombreIncompleto(), awaiting: 'CLIENTE' };
    }

    const intentos = espera.intentos + 1;

    if (!conocido) {
      const registrados = await this.scope.registradosConNombre(texto, message.chatId);
      if (registrados.length > 0) {
        await this.escalarIdentidad(ctx, texto, 'número nuevo; el nombre coincide con alguien registrado', registrados);
      }
      await this.solicitudes.guardar(ctx.conversationId, {
        pideNombre: { ...espera, intentos, escalado: true },
      });
      return { text: voz.nombreEnRevision(), awaiting: registrados.length > 0 ? 'AGENTE' : 'NADIE' };
    }

    const pendientes = scope.pendientesNombre ?? [];
    const confirmadas = await this.scope.confirmarNombre(pendientes, texto);

    if (confirmadas.length > 0) {
      await this.scope.audit({
        waId: message.senderId,
        query: '(nombre completo)',
        documentId: null,
        decision: 'NAME_CONFIRMED',
        decidedBy: `nombre confirmado en ${confirmadas.map((c) => c.organizationName).join(', ')}`,
      });
      await this.solicitudes.guardar(ctx.conversationId, { pideNombre: null });

      const gracias = voz.nombreConfirmado(voz.nombreDePila(confirmadas[0]!.fullName), espera.pedido !== null);
      if (!espera.pedido) return { text: gracias, awaiting: 'CLIENTE' };

      // Lo que había pedido, como si lo acabara de escribir.
      const reply = await this.atender({ ...message, body: espera.pedido }, ctx, clasificar(espera.pedido));
      if (!reply) return { text: gracias, awaiting: 'CLIENTE' };
      return { ...reply, text: reply.text ? `${gracias}
${reply.text}` : gracias };
    }

    await this.scope.audit({
      waId: message.senderId,
      query: '(nombre completo)',
      documentId: null,
      decision: 'NAME_MISMATCH',
      decidedBy: `intento ${intentos} de ${MAX_INTENTOS_NOMBRE}`,
    });

    const sinRegistro = pendientes.every((p) => p.fullName === null);
    if (sinRegistro || intentos >= MAX_INTENTOS_NOMBRE) {
      await this.escalarIdentidad(
        ctx,
        texto,
        sinRegistro ? 'el equipo no ha registrado su nombre completo' : `el nombre no coincide tras ${intentos} intentos`,
        pendientes,
      );
      await this.solicitudes.guardar(ctx.conversationId, {
        pideNombre: { ...espera, intentos, escalado: true },
      });
      return { text: voz.nombreEnRevision(), awaiting: 'AGENTE' };
    }

    await this.solicitudes.guardar(ctx.conversationId, { pideNombre: { ...espera, intentos } });
    return { text: voz.nombreNoCoincide(), awaiting: 'CLIENTE' };
  }

  /** Un caso para que una persona confirme quién es y, si toca, asocie el número. */
  private async escalarIdentidad(
    ctx: StrategyContext,
    escrito: string,
    motivo: string,
    membresias: readonly { organizationId: string; organizationName: string; fullName: string | null }[],
  ): Promise<void> {
    await this.tickets.abrirEscalado({
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      organizationId: membresias.length === 1 ? membresias[0]!.organizationId : null,
      subject: `Confirmar identidad: escribió "${escrito}"`,
      slots: {
        nombreEscrito: escrito,
        motivo,
        membresias: membresias.map((m) => ({
          empresa: m.organizationName,
          nombreRegistrado: m.fullName,
        })),
      },
      reason: 'sin_permiso',
    });
  }

  /**
   * Varios pedidos de un solo mensaje. Cada uno se busca por su cuenta:
   *
   *  - Uno exacto (o "todas"): se entrega, en el orden del pedido.
   *  - Varios candidatos: van a UNA lista numerada común, para elegir
   *    con "la 2" o "la 1 y la 3".
   *  - Nada: se dice al final cuál faltó, en vez de callarlo.
   *
   * Con varias empresas y sin decir de cuál, se pregunta una vez y el lote
   * se retoma al contestar.
   */
  private async atenderVarios(
    turn: Turn,
    sol: Solicitud,
    contexto: Solicitud,
    varios: VariosPedidos,
    empresaEnTexto: string | null,
    requestText: string,
  ): Promise<StrategyReply> {
    const { scopes } = turn;
    const comun =
      empresaEnTexto ??
      (scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(sol, scopes));

    const pedidos = varios.pedidos.map((p) => {
      // "Las de Oxxo y McDonald's": si el nombre es una empresa de su
      // alcance, se busca en esa empresa; si no, es palabra clave.
      const empresa = p.text ? this.resolveCompany(p.text, scopes) : null;
      return {
        ...p,
        // "y la de octubre y noviembre" después de una factura: facturas.
        category: p.category ?? (p.folio || p.text ? null : contexto.category),
        text: empresa ? sinNombresDeEmpresa(p.text, scopes) : p.text,
        organizationId: empresa ?? comun,
      };
    });

    if (scopes.length > 1 && pedidos.some((p) => !p.organizationId)) {
      await this.solicitudes.guardar(turn.ctx.conversationId, {
        lote: requestText,
        opciones: scopes.map((s, i) => ({
          n: i + 1,
          tipo: 'empresa' as const,
          id: s.organizationId,
          nombre: s.organizationName,
        })),
      });
      return this.ask(
        turn,
        readAsked(sol),
        'empresa',
        voz.preguntaEmpresa(),
        scopes.map((s, i) => `*${i + 1}.* ${s.organizationName}`),
      );
    }

    const limite = varios.todas ? MAX_ENTREGAS + 1 : MAX_OPCIONES + 1;
    const aEntregar: Document[] = [];
    const listas: { que: string; docs: Document[]; dudosas?: boolean }[] = [];
    const faltan: string[] = [];

    for (const p of pedidos) {
      const docs = await this.search.search(
        scopes,
        { ...p, excludeIds: sol.rechazados },
        limite,
      );

      if (docs.length === 0) {
        faltan.push(describirPedidoVarios(p));
        await this.scope.audit({
          waId: turn.message.senderId,
          query: turn.message.body,
          documentId: null,
          decision: 'NOT_FOUND',
          decidedBy: 'sin coincidencias en el índice (pedido múltiple)',
        });
        continue;
      }

      if (docs.length === 1 || varios.todas) {
        // Lo mismo que en el pedido de uno (entregarSiCoincide): con folio
        // la búsqueda no filtra por tipo, así que "factura folio C3001" puede
        // dar con un contrato C3001. Eso se ofrece en la lista, no se manda.
        const exactos = docs.filter((d) => coincidePedido(d, p));
        const dudosos = docs.filter((d) => !coincidePedido(d, p));

        // "Todas", del mes más viejo al más nuevo.
        aEntregar.push(...exactos.sort(porMes));
        if (dudosos.length > 0) {
          listas.push({
            que: describirPedidoVarios(p),
            docs: dudosos.slice(0, MAX_OPCIONES),
            dudosas: true,
          });
        }
        continue;
      }

      listas.push({ que: describirPedidoVarios(p), docs: docs.slice(0, MAX_OPCIONES) });
    }

    // Un mismo archivo puede casar con dos pedidos: se manda una vez.
    const unicos = [...new Map(aEntregar.map((d) => [d.id, d])).values()];
    return this.entregarLote(turn, unicos, { faltan, listas, forzar: false });
  }

  /** Selección de la última lista, restando exclusiones antes de buscar o entregar. */
  private async entregarVariasOpciones(
    varias: SeleccionOpciones,
    turn: Turn,
    sol: Solicitud,
  ): Promise<StrategyReply> {
    const opciones = (sol.opciones ?? []).filter((o) => o.tipo === 'documento');
    const conExclusiones = typeof varias === 'object' && !Array.isArray(varias);
    const incluir = conExclusiones ? varias.incluir : varias;
    const excluir = conExclusiones ? varias.excluir : [];

    if (conExclusiones) {
      const mencionadas = [...(incluir === 'todas' ? [] : incluir), ...excluir];
      if (mencionadas.some((n) => !opciones.some((o) => o.n === n))) {
        return { text: voz.numerosFueraDeLista(opciones.length), awaiting: 'CLIENTE' };
      }
    }

    const elegidas = opciones.filter((o) =>
      (incluir === 'todas' || incluir.includes(o.n)) && !excluir.includes(o.n));

    if (elegidas.length === 0) {
      return {
        text: conExclusiones
          ? 'No quedó ninguna opción seleccionada. Dime cuáles de la lista quieres que te mande.'
          : voz.numerosFueraDeLista(opciones.length),
        awaiting: 'CLIENTE',
      };
    }

    // Con negaciones ("la 2 no, la 3", "todas menos la 2") se confirma
    // antes de mandar: son las frases que, mal escritas, se leen al revés.
    if (conExclusiones) return this.confirmarOpciones(turn, elegidas);

    return this.mandarOpciones(turn, elegidas, opciones);
  }

  /**
   * "Para confirmar, te mando: ..." y se espera el sí. Los ids se
   * revalidan antes de nombrarlos: la lista pudo quedar vieja.
   */
  private async confirmarOpciones(turn: Turn, elegidas: readonly Opcion[]): Promise<StrategyReply> {
    const docs: Document[] = [];
    const unavailable: string[] = [];
    for (const opcion of elegidas) {
      const doc = await this.search.byId(opcion.id, turn.scopes);
      if (doc) docs.push(doc);
      else unavailable.push(opcion.id);
    }
    if (unavailable.length > 0) return this.savedIdUnavailable(turn, unavailable);

    await this.solicitudes.guardar(turn.ctx.conversationId, {
      porConfirmar: elegidas.map((o) => o.n),
    });
    return {
      text: voz.confirmarSeleccion(elegidas.map((o, index) => `*${o.n}.* ${docs[index]!.name}`)),
      awaiting: 'CLIENTE',
    };
  }

  /** Entrega opciones ya decididas de la lista, conservándola en pantalla. */
  private async mandarOpciones(
    turn: Turn,
    elegidas: readonly Opcion[],
    opciones: Opcion[],
  ): Promise<StrategyReply> {
    const docs: Document[] = [];
    const unavailable: string[] = [];
    for (const o of elegidas) {
      const doc = await this.search.byId(o.id, turn.scopes);
      if (doc) docs.push(doc);
      else unavailable.push(o.id);
    }
    if (unavailable.length > 0) return this.savedIdUnavailable(turn, unavailable);

    // La lista sigue en su pantalla: se conserva para "y también la 4".
    return this.entregarLote(turn, docs, { faltan: [], listas: [], forzar: true, conservar: opciones });
  }

  /**
   * Manda un lote de documentos y arma UN mensaje con lo que quedó
   * pendiente: lo repetido, lo que sobró, lo que no apareció y lo que hay
   * que elegir. Las leyendas de cada archivo ya dicen qué es cada uno.
   */
  private async entregarLote(
    turn: Turn,
    docs: readonly Document[],
    opts: {
      faltan: readonly string[];
      listas: readonly { que: string; docs: Document[]; dudosas?: boolean }[];
      forzar: boolean;
      conservar?: Opcion[];
    },
  ): Promise<StrategyReply> {
    const repetidos: Document[] = [];
    let enviados = 0;

    for (const doc of docs.slice(0, MAX_ENTREGAS)) {
      const reply = await this.entregar(turn, doc, undefined, opts.forzar, enviados > 0 ? true : undefined);
      // La entrega falló y ya se escaló a una persona: eso es lo que se dice.
      if (reply.awaiting === 'AGENTE') return reply;
      if (reply.text) repetidos.push(doc);
      else enviados += 1;
    }

    const partes: string[] = [];
    if (repetidos.length > 0) partes.push(voz.yaEstabanArriba(repetidos.map((d) => d.name)));
    if (docs.length > MAX_ENTREGAS) partes.push(voz.hayMasDeLasEnviadas(docs.length - MAX_ENTREGAS));
    if (opts.faltan.length > 0) partes.push(voz.noEncontreVarios(opts.faltan));

    // Lo que hay que elegir, numerado de corrido aunque venga de varios pedidos.
    const paraElegir: Document[] = [];
    for (const lista of opts.listas) {
      const inicio = paraElegir.length;
      paraElegir.push(...lista.docs);
      partes.push(
        [
          lista.dudosas ? voz.encabezadoParecidasA(lista.que) : voz.encabezadoVariasDe(lista.que),
          ...lista.docs.map((doc, i) =>
            `*${inicio + i + 1}.* ${lista.dudosas ? describeConTipo(doc) : describe(doc)}`),
        ].join('\n'),
      );
    }

    if (paraElegir.length > 0) {
      partes.push(voz.pieLista());
      await this.guardarOpciones(turn, paraElegir);
    } else if (opts.conservar && opts.conservar.length > 1) {
      await this.solicitudes.guardar(turn.ctx.conversationId, { opciones: opts.conservar });
    } else if (enviados === 0 && repetidos.length === 0) {
      // Nada que mandar ni que elegir: se ofrece cómo ubicarlo.
      partes.push(voz.comoUbicarVarios());
    }

    const pendiente = paraElegir.length > 0 || opts.faltan.length > 0;
    return {
      text: partes.join('\n\n'),
      awaiting: pendiente ? 'CLIENTE' : 'NADIE',
      topic: docs[0]?.category ?? opts.listas[0]?.docs[0]?.category ?? null,
    };
  }

  /**
   * Aplica la opción elegida de la última lista ofrecida.
   *
   * Devuelve null si no había lista o el número no corresponde: ahí el
   * mensaje sigue su camino normal, porque un "2" suelto también puede ser
   * parte de una frase que no tiene nada que ver.
   *
   * La lista NO se consume al elegir un documento: "la 2" y luego "¿y me
   * das la 1?" es una conversación normal. Se retira con la solicitud, o
   * al elegir de una lista de uno.
   */
  private async resolverOpcion(
    numero: number,
    turn: Turn,
    sol: Solicitud,
  ): Promise<StrategyReply | null> {
    const opciones = sol.opciones;
    if (!opciones || opciones.length === 0) return null;

    const elegida = opciones.find((o: Opcion) => o.n === numero);
    if (!elegida) return null;

    if (elegida.tipo === 'empresa') {
      // La lista de empresas sí se consume: ya cumplió.
      const actualizada = await this.solicitudes.guardar(turn.ctx.conversationId, {
        opciones: null,
        organizationId: elegida.id,
        lote: null,
      });

      // Se preguntó la empresa por un pedido de varios documentos: con la
      // empresa ya elegida, el lote sigue donde se quedó.
      const lote = sol.lote ? dividirPedidos(sol.lote) : null;
      if (lote) {
        return this.atenderVarios(turn, actualizada, actualizada, lote, elegida.id, sol.lote!);
      }

      return this.avanzar(turn, mergeSlots(actualizada, VACIA), actualizada);
    }

    const documento = await this.search.byId(elegida.id, turn.scopes);
    if (!documento) return this.savedIdUnavailable(turn, [elegida.id]);

    // Una lista de UNA opción se consume al usarla: si siguiera viva, el
    // "ok" de después la volvería a entregar.
    if (opciones.length === 1) {
      await this.solicitudes.guardar(turn.ctx.conversationId, { opciones: null });
    }

    const reply = await this.entregar(turn, documento, undefined, true);

    // Entregar cierra la solicitud, pero la lista sigue en la pantalla de
    // la persona: se conserva sola, para "también la 1".
    if (opciones.length > 1) {
      await this.solicitudes.guardar(turn.ctx.conversationId, { opciones });
    }

    return reply;
  }

  /**
   * Reintenta la última entrega de esta conversación. Si vuelve a fallar,
   * escala: dos fallos seguidos ya no son mala suerte.
   */
  private async reenviarUltimo(turn: Turn, sol: Solicitud): Promise<StrategyReply | null> {
    const entrega = await this.solicitudes.ultimaEntrega(turn.ctx.conversationId);
    if (!entrega) return null;

    const documento = await this.search.byId(entrega.documentId, turn.scopes);
    if (!documento) return this.savedIdUnavailable(turn, [entrega.documentId]);

    await this.scope.audit({
      waId: turn.message.senderId,
      query: turn.message.body,
      documentId: documento.id,
      decision: 'ALLOW',
      decidedBy: 'ID guardado dentro del alcance vigente',
    });

    const sent = await this.delivery.deliver(
      { chatId: turn.message.chatId, waId: turn.message.senderId, origen: turn.message.id },
      documento,
      voz.reenvio(documento.name, nombreConArticulo(documento.category)),
      'Si tampoco lo ves, escríbeme y lo pasamos con una persona del equipo.',
    );

    if (sent.ok) {
      return { text: '', awaiting: 'NADIE', topic: documento.category };
    }

    const { ticket } = await this.escalar(turn, sol, 'sin_resultados', documento.organizationId);
    return {
      text: voz.reenvioFallido(documento.name, `#${ticket.number}`),
      awaiting: 'AGENTE',
      topic: documento.category,
    };
  }

  /** Un ID guardado ya no es prueba de acceso; no revela cuál regla cambió. */
  private async savedIdUnavailable(turn: Turn, ids: readonly string[]): Promise<StrategyReply> {
    for (const documentId of ids) {
      await this.scope.audit({
        waId: turn.message.senderId,
        query: turn.message.body,
        documentId,
        decision: 'DENY_SAVED_ID',
        decidedBy: 'ID guardado sin coincidencia en el alcance vigente o el índice',
      });
    }
    return {
      text: 'Ya no puedo recuperar ese archivo de forma segura. Si todavía lo necesitas, dime cuál buscas.',
      awaiting: 'CLIENTE',
    };
  }

  /**
   * Saludos, preguntas generales e inconformidades que las reglas no
   * ubicaron. El modelo redacta viendo la conversación, con el tono que
   * pide la clase de mensaje; sin modelo, sale una plantilla.
   */
  private async smallTalk(
    turn: Turn,
    conocido: readonly string[],
    clas: Clasificacion,
  ): Promise<string> {
    const companies = turn.scopes.map((s) => s.organizationName).join(', ');

    const brief =
      clas.tipo === 'QUEJA'
        ? {
            intent: 'queja' as const,
            facts: [
              'La persona expresa una inconformidad que no es sobre un documento concreto.',
              'Ofrece buscar el documento que necesite, o pasarla con alguien del equipo si escribe "quiero hablar con una persona".',
            ],
            fallback: voz.quejaSinModelo(),
          }
        : clas.tipo === 'CONSULTA'
          ? {
              intent: 'consulta' as const,
              facts: [
                'Es una pregunta que no pide ningún documento.',
                'No inventes horarios, precios, trámites ni políticas. Si la respuesta no está en la conversación, di que eso no lo resuelves por aquí y ofrece pasarlo con alguien del equipo.',
              ],
              fallback: voz.consultaSinModelo(companies),
            }
          : {
              intent: 'charla' as const,
              facts: [
                'El mensaje no pide ningún documento.',
                'Si te preguntan algo que no sea sobre documentos, dilo y ofrece buscar uno.',
              ],
              fallback: voz.charlaSinModelo(companies),
            };

    return this.writer.write(
      brief,
      {
        history: turn.history,
        incoming: turn.message.body,
        scopes: turn.scopes,
        known: conocido,
      },
    );
  }

  /**
   * Qué hay: por tipo y meses, o, si preguntó por un mes o tipo concreto,
   * los documentos numerados para que pueda pedir uno.
   */
  private async inventario(turn: Turn, sol: Solicitud): Promise<StrategyReply> {
    const { scopes } = turn;
    const organizationId =
      scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(sol, scopes);

    const empresa = nombreEmpresa(scopes, organizationId);
    const { period, category: categoriaDicha } = parseQuery(turn.message.body);

    /**
     * "¿De qué meses hay?": meses del tipo en juego, con cuántos en cada
     * uno. El tipo sale del mensaje o de la solicitud en curso ("la de
     * agosto?" → "no hay" → "¿de qué meses hay?" es de facturas).
     */
    const entregada = await this.solicitudes.ultimaEntrega(turn.ctx.conversationId);
    // La categoría de la solicitud pudo copiarse de una entrega anterior.
    // Sin categoría explícita en este turno, revalidar también ese contexto.
    const usaUltima = preguntaMeses(turn.message.body) && !categoriaDicha && entregada;
    const documentoEntregado = usaUltima
      ? await this.search.byId(entregada.documentId, turn.scopes)
      : null;
    if (usaUltima && !documentoEntregado) {
      return this.savedIdUnavailable(turn, [entregada.documentId]);
    }
    const tipoEnJuego = categoriaDicha ?? sol.category ?? documentoEntregado?.category ?? null;

    if (preguntaMeses(turn.message.body) && tipoEnJuego) {
      const meses = await this.search.mesesDe(scopes, tipoEnJuego, organizationId);
      if (meses.length === 0) {
        return { text: voz.sinDocumentosDe(nombrePlural(tipoEnJuego), null, empresa, null), awaiting: 'NADIE' };
      }
      const masDeUna = /\bmas de una\b/.test(normalizar(turn.message.body));
      const visibles = masDeUna ? meses.filter((m) => m.period !== null && m.count > 1) : meses;
      if (visibles.length === 0) {
        return { text: `No tengo meses con más de una ${nombre(tipoEnJuego)}.`, awaiting: 'NADIE' };
      }
      // Los que tienen mes primero; los que no, al final como "y 2 sin mes".
      const conMes = visibles.filter((m) => m.period !== null);
      const sinMes = visibles.filter((m) => m.period === null).reduce((n, m) => n + m.count, 0);
      const partes = conMes.map((m) =>
        mesEnPalabras(m.period!) + (m.count > 1 ? ` (${m.count})` : ''),
      );
      if (sinMes > 0) partes.push(`${sinMes} sin mes en el nombre`);
      return {
        text: voz.mesesDisponibles(nombrePlural(tipoEnJuego), partes),
        awaiting: 'NADIE',
      };
    }

    const category = categoriaDicha;

    if (period || category) {
      const docs = await this.search.search(
        scopes,
        { category, period, folio: null, text: null, organizationId },
        MAX_OPCIONES + 1,
      );

      if (docs.length === 0) {
        const que = category ? nombrePlural(category) : 'documentos';
        const cuando = period ? mesEnPalabras(period) : null;
        const resto = await this.search.inventario(scopes, organizationId);
        return {
          text: voz.sinDocumentosDe(
            que,
            cuando,
            empresa,
            resto.length > 0 ? describirInventario(resto, empresa) : null,
          ),
          awaiting: 'NADIE',
        };
      }

      if (period || docs.length <= MAX_OPCIONES) {
        const mostrados = docs.slice(0, MAX_OPCIONES);
        const total = docs.length > MAX_OPCIONES
          ? await this.search.count(scopes, { category, period, folio: null, text: null, organizationId })
          : docs.length;
        await this.guardarOpciones(turn, mostrados);
        return {
          text: [
            total > mostrados.length
              ? voz.encabezadoListaLimitada(
                total, mostrados.length,
                `${nombrePlural(category)}${period ? ` de ${mesEnPalabras(period)}` : ''}`,
              )
              : period
                ? voz.encabezadoInventarioMes(mesEnPalabras(period), docs.length)
                : voz.encabezadoLista(docs.length, nombrePlural(category)),
            ...mostrados.map((doc, i) => `*${i + 1}.* ${describe(doc)}`),
            '',
            voz.pieInventario(),
          ].join('\n'),
          awaiting: 'CLIENTE',
        };
      }
    }

    const lineas = await this.search.inventario(scopes, organizationId);
    if (lineas.length === 0) {
      return { text: voz.sinNada(empresa), awaiting: 'NADIE' };
    }

    return {
      text: voz.inventarioGeneral(describirInventario(lineas, empresa)),
      awaiting: 'NADIE',
    };
  }

  /**
   * La persona dice que no es lo que se le ofreció o entregó.
   *
   * Lo rechazado se apunta y no se vuelve a ofrecer; se pide un dato que
   * distinga (folio, nombre, mes exacto). Al segundo rechazo sin dar con
   * nada, nace el ticket: con lo que hay, no se puede resolver solo.
   * Devuelve null si no había nada que rechazar.
   */
  private async rechazar(turn: Turn, sol: Solicitud): Promise<StrategyReply | null> {
    const entregada = await this.solicitudes.ultimaEntrega(turn.ctx.conversationId);
    const tieneOpciones = (sol.opciones?.length ?? 0) > 0;
    const documentoEntregado = entregada && (!tieneOpciones || !sol.category)
      ? await this.search.byId(entregada.documentId, turn.scopes)
      : null;
    if (!tieneOpciones && entregada && !documentoEntregado) {
      return this.savedIdUnavailable(turn, [entregada.documentId]);
    }

    const ids = idsRechazados(sol, entregada, documentoEntregado);

    if (ids.length === 0) return null;

    const rechazados = [...new Set([...sol.rechazados, ...ids])];
    const category = sol.category ?? documentoEntregado?.category ?? null;
    const fallos = readFallos(sol) + 1;

    const actualizada = await this.solicitudes.guardar(turn.ctx.conversationId, {
      rechazados,
      opciones: null,
      category,
      fallos,
    });

    const pedido = describirPedido({
      category,
      period: actualizada.period ? new Date(actualizada.period) : null,
      folio: actualizada.folio,
      text: null,
    });

    const asked = readAsked(actualizada);
    if (!asked.slots.detalle) {
      return this.ask(turn, asked, 'detalle', voz.rechazoPideDetalle(pedido));
    }

    const { scopes } = turn;
    const organizationId =
      scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(actualizada, scopes);
    const { ticket, agente } = await this.escalar(turn, actualizada, 'sin_resultados', organizationId);

    return {
      text: voz.sinInformacionEscalado(pedido, `#${ticket.number}`, agente),
      awaiting: 'AGENTE',
      topic: category,
    };
  }

  /**
   * Apunta como rechazado lo último ofrecido o entregado, sin contestar
   * nada: el mensaje trae datos y sigue su camino con ellos.
   */
  private async apuntarRechazo(turn: Turn, sol: Solicitud): Promise<StrategyReply | null> {
    const entregada = await this.solicitudes.ultimaEntrega(turn.ctx.conversationId);
    const tieneOpciones = (sol.opciones?.length ?? 0) > 0;
    const documentoEntregado = entregada && (!tieneOpciones || !sol.category)
      ? await this.search.byId(entregada.documentId, turn.scopes)
      : null;
    if (!tieneOpciones && entregada && !documentoEntregado) {
      return this.savedIdUnavailable(turn, [entregada.documentId]);
    }

    const ids = idsRechazados(sol, entregada, documentoEntregado);
    if (ids.length === 0) return null;

    await this.solicitudes.guardar(turn.ctx.conversationId, {
      rechazados: [...new Set([...sol.rechazados, ...ids])],
      opciones: null,
      category: sol.category ?? documentoEntregado?.category ?? null,
    });
    return null;
  }

  /**
   * Contesta de dónde salió el mes (o el tipo) de lo último entregado.
   *
   * Con la verdad: el nombre del archivo, la fecha que trae por dentro,
   * o "no lo sé". Y se deja el archivo como opción para que un "no, otra"
   * lo rechace o un "sí" lo confirme, sin volverlo a mandar.
   */
  private async explicarEntregado(turn: Turn, sol: Solicitud): Promise<StrategyReply | null> {
    const entregada = await this.solicitudes.ultimaEntrega(turn.ctx.conversationId);
    if (!entregada) return null;

    const doc = await this.search.byId(entregada.documentId, turn.scopes);
    if (!doc) return this.savedIdUnavailable(turn, [entregada.documentId]);

    if (preguntaNombreEntregado(turn.message.body)) {
      // Sin guardarlo como opción: un "ok" después no debe reenviarlo.
      return { text: `El archivo que te mandé es *${doc.name}*.`, awaiting: 'CLIENTE', topic: doc.category };
    }

    const porNombre = parseDocumentName(doc.name);
    const porDentro = parseDocumentContent(doc.extractedText);

    /**
     * De dónde sale el mes que el índice le tiene al documento. La regla es
     * la misma del sincronizador: el nombre manda, salvo que su "mes" sea
     * una marca de tiempo de descarga, en cuyo caso gana lo que dice el
     * texto por dentro. Se explica exactamente eso, porque es lo que pasó.
     */
    const mesDentro = porDentro.period ? mesEnPalabras(porDentro.period) : null;
    const mesNombre = porNombre.period ? mesEnPalabras(porNombre.period) : null;
    const mesIndice = doc.period ? mesEnPalabras(doc.period) : null;

    // Con qué mes se le mandó: si el índice ya lo corrigió después de
    // leerlo por dentro, hay que decirlo, no fingir que siempre fue así.
    const mesEntregado = entregada.period ? mesEnPalabras(new Date(entregada.period)) : null;

    let text: string;
    if (mesDentro && porNombre.periodoDebil && mesNombre && mesNombre !== mesDentro) {
      text = voz.mesPorContenidoCorrigiendo(doc.name, mesDentro, mesNombre);
    } else if (mesNombre && !porNombre.periodoDebil) {
      text = voz.mesPorNombre(doc.name, mesNombre);
    } else if (mesDentro) {
      text = voz.mesPorContenido(doc.name, mesDentro);
    } else if (mesIndice) {
      text = voz.mesPorIndice(doc.name, mesIndice);
    } else {
      text = voz.mesDesconocido(doc.name);
    }

    const mesReal = mesDentro && porNombre.periodoDebil ? mesDentro : (mesIndice ?? mesNombre ?? mesDentro);
    if (mesReal && mesEntregado && mesEntregado !== mesReal) {
      text = `${voz.perdonMesEquivocado(mesEntregado)}\n${text}`;
    }

    /**
     * Si en la pregunta viene un mes ("¿es de abril o de mayo?", "yo te
     * pedí la de mayo"), se contesta también eso: si es el mismo, se
     * confirma; si es otro, se busca ese y se dice si hay o no.
     */
    const mesPreguntado = mesReclamado(turn.message.body);
    if (mesPreguntado && mesReal) {
      const pedido = mesEnPalabras(mesPreguntado);
      if (pedido !== mesReal) {
        const organizationId =
          turn.scopes.length === 1 ? turn.scopes[0]!.organizationId : empresaGuardada(sol, turn.scopes);
        const deEseMes = await this.search.search(
          turn.scopes,
          { category: doc.category, period: mesPreguntado, folio: null, text: null, organizationId, excludeIds: [doc.id] },
          MAX_OPCIONES + 1,
        );
        if (deEseMes.length === 1) {
          // Discutía lo que recibió; mandar otro archivo sin preguntar es
          // adivinar. Se ofrece y se espera el sí.
          await this.solicitudes.guardar(turn.ctx.conversationId, { category: doc.category, period: mesPreguntado.toISOString() });
          await this.guardarOpciones(turn, [deEseMes[0]!]);
          return {
            text: `${text}\n${voz.ofrecerDeEseMes(deEseMes[0]!.name, pedido)}`,
            awaiting: 'CLIENTE',
            topic: doc.category,
          };
        }
        if (deEseMes.length > 1 && deEseMes.length <= MAX_OPCIONES) {
          await this.guardarOpciones(turn, deEseMes);
          return {
            text: [
              text,
              voz.siHayDeEseMes(nombrePlural(doc.category), pedido),
              ...deEseMes.map((d, i) => `*${i + 1}.* ${describe(d)}`),
            ].join('\n'),
            awaiting: 'CLIENTE',
            topic: doc.category,
          };
        }
        text = `${text}\n\n${voz.noHayDeEseMes(nombrePlural(doc.category), pedido)}`;
        await this.guardarOpciones(turn, [doc]);
        return { text, awaiting: 'CLIENTE', topic: doc.category };
      }
    }

    await this.guardarOpciones(turn, [doc]);
    return { text, awaiting: 'CLIENTE', topic: doc.category };
  }

  /** Escala por petición explícita y dice quién atiende. */
  private async pasarAHumano(turn: Turn, sol: Solicitud): Promise<StrategyReply> {
    const { scopes } = turn;
    const organizationId =
      scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(sol, scopes);

    const { ticket, agente } = await this.escalar(turn, sol, 'pidio_humano', organizationId);

    return { text: voz.pasarAHumano(`#${ticket.number}`, agente), awaiting: 'AGENTE' };
  }

  /** Escalado por no entender. */
  private async escalarPorNoEntender(turn: Turn, sol: Solicitud): Promise<StrategyReply> {
    const { scopes } = turn;
    const organizationId =
      scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(sol, scopes);

    const { ticket, agente } = await this.escalar(turn, sol, 'slots_incompletos', organizationId);

    return { text: voz.noTeEntiendo(`#${ticket.number}`, agente), awaiting: 'AGENTE' };
  }

  /**
   * Una queja que necesita a una persona, o una pregunta por un caso.
   *
   * Si una persona ya tiene un caso de esta conversación, no se abre otro
   * folio: se anota, se sube la prioridad y se le recuerda al agente. Si no
   * lo hay, la queja nace como ticket de prioridad alta. Preguntar por un
   * caso que no existe no es una queja: devuelve null y el mensaje sigue su
   * camino normal.
   */
  private async atenderQueja(
    turn: Turn,
    sol: Solicitud,
    clas: Clasificacion,
  ): Promise<StrategyReply | null> {
    const esSeguimiento = clas.tipo === 'SEGUIMIENTO';
    const caso = await this.tickets.casoEnRevision(turn.ctx.conversationId);

    if (caso) {
      const agente = await this.tickets.insistir(
        caso.id,
        esSeguimiento ? 'seguimiento' : 'queja',
        turn.message.body,
      );
      const folio = `#${caso.number}`;
      return {
        text: esSeguimiento
          ? voz.seguimientoCaso(folio, agente)
          : voz.quejaConCasoAbierto(folio, agente),
        awaiting: 'AGENTE',
      };
    }

    if (esSeguimiento) return null;

    const { scopes } = turn;
    const organizationId =
      scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(sol, scopes);

    const { ticket, agente } = await this.escalar(turn, sol, 'queja', organizationId);

    return {
      text: voz.quejaEscalada(clas.motivo, `#${ticket.number}`, agente),
      awaiting: 'AGENTE',
      topic: sol.category,
    };
  }

  /**
   * La petición que venía junto a una queja: "¿qué facturas tienes?" o
   * "pásame la de abril". Se atiende como mensaje propio, ya sin la queja,
   * después de que la queja quedó con una persona.
   */
  private async peticionJuntoAQueja(
    message: IncomingMessage,
    ctx: StrategyContext,
  ): Promise<StrategyReply | null> {
    const intent = documentIntent(message.body, { enCurso: false, pendiente: null, companyName: null });
    const texto = intent.kind === 'document'
      ? intent.request
      : message.body
          .split(/(?<=[.;!?])\s+|;|,\s*(?=(?:pero|y|ahora)\b)/i)
          .map((parte) => parte.trim())
          .find((parte) => parte && esInventario(parte) && !quejaParaPersona(clasificar(parte))) ?? null;
    if (!texto || normalizar(texto) === normalizar(message.body)) return null;

    const sinQueja = clasificar(texto);
    if (quejaParaPersona(sinQueja)) return null;
    return this.atender({ ...message, body: texto }, ctx, sinQueja);
  }

  /** Molesto y con vueltas encima: a una persona, sin otra pregunta. */
  private async escalarPorMolestia(turn: Turn, sol: Solicitud): Promise<StrategyReply> {
    const caso = await this.tickets.casoEnRevision(turn.ctx.conversationId);
    if (caso) {
      const agente = await this.tickets.insistir(caso.id, 'molesto', turn.message.body);
      return { text: voz.quejaConCasoAbierto(`#${caso.number}`, agente), awaiting: 'AGENTE' };
    }

    const { scopes } = turn;
    const organizationId =
      scopes.length === 1 ? scopes[0]!.organizationId : empresaGuardada(sol, scopes);

    const { ticket, agente } = await this.escalar(turn, sol, 'molesto', organizationId);

    return {
      text: voz.molestoEscalado(`#${ticket.number}`, agente),
      awaiting: 'AGENTE',
      topic: sol.category,
    };
  }

  /**
   * Aquí, y solo aquí, nace un ticket: cuando hace falta una persona.
   *
   * Se lleva lo que la solicitud sabía (para que el agente vea qué se
   * pedía) y la solicitud se cierra: a partir de aquí la atiende alguien,
   * y lo que la persona escriba después ya no es para el bot.
   */
  private async escalar(
    turn: Turn,
    sol: Solicitud,
    reason: EscalationReason,
    organizationId: string | null,
  ) {
    const resultado = await this.tickets.abrirEscalado({
      conversationId: turn.ctx.conversationId,
      contactId: turn.ctx.contactId,
      organizationId,
      subject: turn.message.body,
      slots: {
        category: sol.category,
        period: sol.period,
        folio: sol.folio,
        organizationId: sol.organizationId ?? organizationId,
      },
      reason,
    });

    await this.solicitudes.cerrar(turn.ctx.conversationId);
    return resultado;
  }

  private async guardarOpciones(turn: Turn, docs: readonly Document[]): Promise<void> {
    await this.solicitudes.guardar(turn.ctx.conversationId, {
      opciones: docs.map((doc, i) => ({
        n: i + 1,
        tipo: 'documento' as const,
        id: doc.id,
        nombre: doc.name,
      })),
    });
  }

  /**
   * Empresa mencionada en un texto, si coincide con exactamente una del
   * alcance. Se compara por palabras y sin acentos, tolerando erratas.
   */
  private resolveCompany(
    text: string | null,
    scopes: readonly OrgScope[],
  ): string | null {
    if (!text) return null;

    const palabras = tokens(text);
    if (palabras.length === 0) return null;

    const candidatas = scopes.filter((s) => {
      const nombreEmpresa = tokens(s.organizationName);
      return nombreEmpresa.some((n) => palabras.some((p) => parecidas(p, n)));
    });

    return candidatas.length === 1 ? candidatas[0]!.organizationId : null;
  }

  /**
   * Hace una pregunta, pero solo si no se hizo ya.
   *
   * Repetir una pregunta que la persona ya contestó es la forma más rápida
   * de que abandone. Si un dato sigue faltando DESPUÉS de haberlo pedido,
   * no nos estamos entendiendo, y eso lo resuelve una persona.
   */
  private async ask(
    turn: Turn,
    asked: AskedState,
    slot: AskableSlot,
    question: string,
    lista: readonly string[] = [],
  ): Promise<StrategyReply> {
    if (asked.slots[slot]) {
      const sol = await this.solicitudes.actual(turn.ctx.conversationId);
      const organizationId =
        turn.scopes.length === 1 ? turn.scopes[0]!.organizationId : empresaGuardada(sol, turn.scopes);
      const { ticket, agente } = await this.escalar(turn, sol, 'slots_incompletos', organizationId);
      return { text: voz.yaPregunte(`#${ticket.number}`, agente), awaiting: 'AGENTE' };
    }

    await this.solicitudes.guardar(turn.ctx.conversationId, {
      preguntas: asked.total + 1,
      preguntado: { ...asked.slots, [slot]: true },
      ultimaPregunta: slot,
    });

    const text =
      lista.length > 0
        ? [question, ...lista, '', voz.pieLista()].join('\n')
        : question;

    return { text, awaiting: 'CLIENTE' };
  }
}

/** Solo instrucciones explícitas de reinicio; "mándamela de nuevo" no lo es. */
function pideReinicio(texto: string): boolean {
  const limpio = normalizar(texto);
  return /^(?:por favor )?(?:(?:empecemos|comencemos|(?:quiero|vamos a) (?:empezar|comenzar)) (?:de nuevo|desde cero)|(?:reinicia|reiniciemos) (?:la|mi|esta) solicitud|(?:ignora|olvida) (?:todo )?lo anterior)(?: (?:y )?(?:ignora|olvida) (?:todo )?lo anterior)?(?: por favor)?$/.test(limpio);
}

/** Un abandono seguido de slots explícitos no debe descartar el nuevo pedido. */
function abandonaConNuevaSolicitud(texto: string): boolean {
  const limpio = normalizar(texto);
  const abandona = /\b(?:olvida|ignora)\s+(?:eso|lo anterior)\b/.test(limpio) ||
    separarPeticionMixta(texto)?.marcador === 'CIERRE';
  if (!abandona) return false;
  const nuevos = parseQuery(texto);
  return nuevos.category !== null || nuevos.period !== null || nuevos.folio !== null;
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
  if (fresh.text && nombreDeArchivo(fresh.text)) return { ...fresh };

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
  if (fresh.folio !== null && storedFolio !== null && fresh.folio !== storedFolio) {
    category = fresh.category;
    period = fresh.period;
  }

  // Las palabras clave son de ESTE mensaje: no se heredan. "La de Parcia"
  // y luego "y la de marzo" no significa "la de Parcia de marzo".
  return { category, period, folio, text: fresh.text };
}

/** Una consulta sin nada: para reanudar desde lo que el ticket ya guarda. */
const VACIA: SearchQuery = { category: null, period: null, folio: null, text: null };

/** Cómo se llama cada tipo de documento cuando se le habla a una persona. */
const NOMBRES: Record<DocCategory, [string, string, 'el' | 'la']> = {
  FACTURA: ['factura', 'facturas', 'la'],
  CONTRATO: ['contrato', 'contratos', 'el'],
  COTIZACION: ['cotización', 'cotizaciones', 'la'],
  REPORTE: ['reporte', 'reportes', 'el'],
  POLIZA: ['póliza', 'pólizas', 'la'],
  ESTADO_CUENTA: ['estado de cuenta', 'estados de cuenta', 'el'],
  CONTABLE: ['documento contable', 'documentos contables', 'el'],
  OTRO: ['documento', 'documentos', 'el'],
};

function nombre(category: DocCategory | null): string {
  return category ? NOMBRES[category][0] : 'documento';
}

function nombrePlural(category: DocCategory | null): string {
  return category ? NOMBRES[category][1] : 'documentos';
}

function nombreConArticulo(category: DocCategory | null): string {
  return category ? `${NOMBRES[category][2]} ${nombre(category)}` : 'el documento';
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function mesEnPalabras(period: Date): string {
  return `${MESES[period.getUTCMonth()]} de ${period.getUTCFullYear()}`;
}

/** "la factura de febrero de 2026", "el documento con folio V3001". */
/**
 * Un pedido de un lote, en palabras: "la factura de octubre de 2026", "lo
 * de Oxxo", "el folio A100". Corto, porque va en una lista.
 */
function describirPedidoVarios(query: SearchQuery): string {
  if (query.folio) return `el folio ${query.folio}`;
  const que = query.category ? nombreConArticulo(query.category) : 'lo';
  const de = query.text && !nombreDeArchivo(query.text) ? ` de ${capitalizar(query.text)}` : '';
  const mes = query.period ? ` de ${mesEnPalabras(query.period)}` : '';
  return `${que}${de}${mes}`;
}

function capitalizar(texto: string): string {
  return texto.replace(/(^|\s)\p{L}/gu, (l) => l.toUpperCase());
}

/** Del mes más viejo al más nuevo; lo que no trae mes, al final. */
function porMes(a: Document, b: Document): number {
  if (!a.period) return b.period ? 1 : 0;
  if (!b.period) return -1;
  return a.period.getTime() - b.period.getTime();
}

function describirPedido(query: SearchQuery): string {
  let base = nombreConArticulo(query.category);
  if (query.text && !nombreDeArchivo(query.text)) base += ` de "${query.text}"`;
  if (query.period) base += ` de ${mesEnPalabras(query.period)}`;
  if (query.folio) base += ` con folio ${query.folio}`;
  return base;
}

/**
 * ¿El documento es del mes que se pidió?
 *
 *  - coincide: no se pidió mes, o el documento es de ese mes.
 *  - contradice: el documento es de otro mes.
 *  - sin_evidencia: el documento no trae mes ni en el nombre ni por
 *    dentro. Se ofrece, pero diciendo eso.
 */
function coincideMes(
  doc: Document,
  query: SearchQuery,
): 'coincide' | 'contradice' | 'sin_evidencia' {
  if (!query.period) return 'coincide';
  if (!doc.period) return 'sin_evidencia';
  return doc.period.getTime() === query.period.getTime() ? 'coincide' : 'contradice';
}

/** ¿Es del tipo y del mes pedidos? Solo así sale en un lote sin preguntar. */
function coincidePedido(doc: Document, query: SearchQuery): boolean {
  if (query.category && doc.category !== query.category) return false;
  return coincideMes(doc, query) === 'coincide';
}

/**
 * Quita de las palabras clave las que son nombre de alguna empresa del
 * alcance. Devuelve null si no queda nada.
 */
function sinNombresDeEmpresa(
  text: string | null,
  scopes: readonly OrgScope[],
): string | null {
  if (!text || nombreDeArchivo(text)) return text;

  const empresas = scopes.flatMap((s) => tokens(s.organizationName));
  const restantes = text
    .split(/\s+/)
    .filter((p) => !empresas.some((e) => parecidas(p, e)));

  return restantes.length > 0 ? restantes.join(' ') : null;
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

/**
 * Qué descarta un "no es esa".
 *
 * Si de la lista ya se eligió y se mandó una, "no es esa" habla de la que
 * recibió, no de toda la lista: antes se descartaban todas y la correcta
 * ya no se volvía a ofrecer.
 */
function idsRechazados(
  sol: Solicitud,
  entregada: { documentId: string } | null,
  documentoEntregado: Document | null,
): string[] {
  const opciones = (sol.opciones ?? []).filter((o) => o.tipo === 'documento');
  if (opciones.length > 0) {
    if (entregada && opciones.some((o) => o.id === entregada.documentId)) return [entregada.documentId];
    return opciones.map((o) => o.id);
  }
  return documentoEntregado ? [documentoEntregado.id] : [];
}

/**
 * Queja y petición en un mismo mensaje: un solo texto, la queja primero
 * (ya está con una persona) y luego lo de la petición. El documento, si
 * salió, ya va como archivo aparte.
 */
function juntarRespuestas(queja: StrategyReply, peticion: StrategyReply): StrategyReply {
  return {
    ...peticion,
    text: [queja.text, peticion.text].filter(Boolean).join('\n\n'),
    awaiting: peticion.awaiting === 'CLIENTE' ? 'CLIENTE' : queja.awaiting,
  };
}

/** Un saludo al inicio que además trae datos documentales no detiene la solicitud. */
function saludoConSolicitud(texto: string): boolean {
  const limpio = normalizar(texto);
  return /^(hola|buenos dias|buen dia|buenas tardes|buenas noches)\b/.test(limpio)
    && parseQueryTieneDatos(limpio);
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

  if (SALUDO.test(limpio)) {
    // La cortesía responde al saludo; la solicitud queda en memoria para que
    // la persona la continúe cuando esté lista.
    if (pendiente) return voz.respuestaSocial(limpio);

    const yaConversaron = turn.history.some((t) => t.role === 'bot');
    if (yaConversaron) return voz.saludoDeNuevo(limpio, voz.nombreDePila(turn.message.senderName));

    return voz.saludoInicial(
      turn.scopes.length === 1 ? turn.scopes[0]!.organizationName : null,
      voz.nombreDePila(turn.message.senderName),
      limpio,
    );
  }

  /**
   * Gracias y cierres: "gracias", "va con eso está bien gracias", "es
   * todo", "con eso basta". Se puede responder aunque haya una pregunta
   * pendiente: no aporta slots y no debe consumir un intento de respuesta.
   */
  const palabras = limpio.split(' ').length;
  if (palabras <= 8 && /\bgracias\b/.test(limpio)) {
    return voz.deNada();
  }

  // Un acuse simple no aporta datos. Se reconoce incluso con una pregunta
  // pendiente; la confirmación de una opción única ya se resolvió antes aquí.
  if (ACUSE.test(limpio)) return '';

  // Lo de abajo solo sin pregunta pendiente: "ok" contestando a "¿de qué
  // mes?" tiene que pasar por el flujo normal.
  if (pendiente) return null;

  // Un "ok" no se contesta: ya quedó marcado como leído, y responderle a
  // cada acuse es justo lo que hace que un bot se sienta como bot.
  if (esCierre(texto)) return '';

  /**
   * "A perdón, sí es cierto, es la misma", "tienes razón", "ya la vi":
   * la persona reconoce algo. Se contesta con una línea amable, no con
   * otra búsqueda — antes esto acababa en un ticket.
   */
  if (palabras <= 12 && RECONOCE.test(limpio)) return voz.sinProblema();

  return null;
}

/** Los datos que el bot sabe pedir cuando faltan. */
type AskableSlot = 'categoria' | 'periodo' | 'empresa' | 'detalle';

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

/** "FACTURA_2026-02_V3001.pdf — febrero de 2026, folio V3001": nombre en negritas, datos después. */
function describe(doc: Document): string {
  const period = doc.period ? mesEnPalabras(doc.period) : 'sin mes';
  return `*${doc.name}* — ${period}${doc.folio ? `, folio ${doc.folio}` : ''}`;
}

/** Como describe(), pero dice el tipo: para lo que no es exactamente lo pedido. */
function describeConTipo(doc: Document): string {
  const period = doc.period ? mesEnPalabras(doc.period) : 'sin mes';
  return `*${doc.name}* — ${nombreConArticulo(doc.category)}, ${period}${doc.folio ? `, folio ${doc.folio}` : ''}`;
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
    return `*${l.count}* ${tipo}${rangoMeses(l.from, l.to)}`;
  });

  const quien = empresa ? `De *${empresa}* tengo:` : 'Tengo:';
  return [quien, ...partes.map((p) => `• ${p}`)].join('\n');
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
 * La raíz con la que se busca un tipo dentro de los NOMBRES de archivo:
 * "cotizacion" da con "Cotizacion_Vega_2026.pdf" aunque esté clasificado
 * como factura. Sin acentos, porque los nombres de archivo rara vez los
 * llevan, y el contains es insensible a mayúsculas.
 */
function raizNombre(category: DocCategory): string {
  return {
    FACTURA: 'factura',
    CONTRATO: 'contrato',
    COTIZACION: 'cotizacion',
    REPORTE: 'reporte',
    POLIZA: 'poliza',
    ESTADO_CUENTA: 'estado',
    CONTABLE: 'contab',
    OTRO: 'documento',
  }[category];
}

/**
 * Qué documentos no volver a ofrecer.
 *
 * Lo rechazado ("no es esa") se excluye de las búsquedas por tipo y mes,
 * que son las que se equivocan. Pero un folio o un nombre de archivo es
 * una identificación explícita: si después de rechazar la lista dice
 * "es V3001", es ese, aunque estuviera en la lista. Rechazar una lista
 * de dos y luego nombrar uno de los dos es una conversación normal.
 */
function excluir(query: SearchQuery, sol: Solicitud): readonly string[] {
  const explicito = query.folio !== null || (query.text !== null && nombreDeArchivo(query.text) !== null);
  return explicito ? [] : sol.rechazados;
}

/**
 * El mes que la persona reclama en una pregunta sobre lo entregado.
 *
 * "Yo te pedí la de mayo" → mayo, aunque antes diga "es de abril". Si solo
 * menciona un mes, ese. Si menciona dos sin decir cuál pedía ("¿es de
 * abril o de mayo?"), no se adivina: se contesta cuál es y ya.
 */
function mesReclamado(texto: string): Date | null {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const pedido = /\bte (pedi|habia pedido|dije|solicite) (la|el|lo) de (\w+)\b/.exec(limpio);
  if (pedido) return parseQuery(pedido[3]!).period;

  const meses = limpio.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/g) ?? [];
  if (new Set(meses).size !== 1) return null;
  return parseQuery(meses[0]!).period;
}
