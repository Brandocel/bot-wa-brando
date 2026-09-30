import type { MessageIntent } from '@prisma/client';

/**
 * Qué clase de mensaje es: solicitud, queja, consulta, seguimiento...
 *
 * Se decide ANTES de contestar, porque cambia qué hay que hacer y cómo
 * decirlo. A una queja no se le contesta con otra búsqueda: primero se
 * reconoce, y si el bot no la puede resolver, pasa a una persona con
 * prioridad alta. A "¿ya revisaron mi caso?" no se le abre otro folio: se
 * le recuerda al agente que ya lo tiene. Y a alguien molesto no se le hace
 * una pregunta más.
 *
 * Por reglas y no por modelo, igual que los permisos y las prioridades: si
 * la clasificación la decidiera el modelo, escribir "QUEJA URGENTE" bastaría
 * para saltarse la fila. El modelo solo le pone etiqueta a lo que las reglas
 * dejan como OTRO, y esa etiqueta cambia el tono, nunca escala nada.
 *
 * Además de guiar la respuesta, la etiqueta se guarda en cada mensaje
 * entrante: así el operador ve en la bandeja, sin leer el hilo entero,
 * quién vino a pedir algo y quién vino a quejarse.
 *
 * Aquí viven también los detectores de frases concretas ("no me llegó",
 * "no es esa", "pásame con alguien"): son la materia prima de la
 * clasificación, y la Strategy los sigue usando para decidir el camino.
 */

export type TipoMensaje = MessageIntent;

/** De qué se queja. Decide si el bot la puede resolver solo o no. */
export type MotivoQueja =
  /** Lo resuelve el bot: reenvía. */
  | 'no_recibido'
  /** Lo resuelve el bot: busca otro. */
  | 'documento_equivocado'
  /** Persona: el bot no corrige facturas. */
  | 'error_en_documento'
  /** Persona: alguien lleva rato esperando. */
  | 'demora'
  /** Persona: el bot ya no le está sirviendo. */
  | 'mal_servicio';

export interface Clasificacion {
  tipo: TipoMensaje;
  motivo: MotivoQueja | null;
  /** Se nota molesto, sea cual sea el tipo. */
  molesto: boolean;
  /** Quién puso la etiqueta. El modelo solo etiqueta; nunca escala. */
  fuente: 'reglas' | 'modelo';
}

/** ¿Es una queja que el bot no puede resolver solo? */
export function quejaParaPersona(c: Clasificacion): boolean {
  return (
    c.tipo === 'QUEJA' &&
    (c.motivo === 'error_en_documento' || c.motivo === 'demora' || c.motivo === 'mal_servicio')
  );
}

/**
 * La clasificación de un mensaje, solo por reglas.
 *
 * El orden importa y va de lo más específico a lo más general: pedir una
 * persona gana a todo; una queja gana a los datos que traiga ("la factura
 * de marzo viene con el RFC mal" es una queja, no una petición); y una
 * pregunta sin ningún dato de documento es una consulta.
 */
export function clasificar(texto: string): Clasificacion {
  const limpio = normalizar(texto);
  const molesto = seNotaMolesto(texto, limpio);
  const con = (tipo: TipoMensaje, motivo: MotivoQueja | null = null): Clasificacion => ({
    tipo,
    motivo,
    molesto,
    fuente: 'reglas',
  });

  if (limpio === '') return con('OTRO');
  if (pideHumano(texto)) return con('PIDE_HUMANO');

  const motivo = motivoDeQueja(texto, limpio);
  if (motivo) return con('QUEJA', motivo);

  if (preguntaPorSuCaso(limpio)) return con('SEGUIMIENTO');
  if (esInventario(texto) || preguntaSobreEntregado(texto)) return con('CONSULTA');

  if (esPausa(limpio)) return con('CORTESIA');

  if (parseQueryTieneDatos(limpio) || leerNumero(texto) !== null) return con('SOLICITUD');
  if (esCortesia(limpio)) return con('CORTESIA');
  if (esAfirmacion(texto) || esRechazo(texto) || mencionaRechazo(texto)) return con('SOLICITUD');

  if (esPregunta(texto, limpio)) return con('CONSULTA');
  return con('OTRO');
}

/** Minúsculas, sin acentos ni signos, espacios simples. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Quejas ─────────────────────────────────────────────────────────────

/**
 * Datos mal DENTRO del documento: "el RFC viene mal", "me cobraron doble",
 * "hay que refacturar". Un "está mal" a secas no cuenta: casi siempre
 * quiere decir "no es esa", y eso lo resuelve el bot buscando otra.
 */
const ERROR_EN_DOCUMENTO =
  /\b((rfc|monto|importe|total|subtotal|iva|precio|cantidad|concepto|razon social|direccion|domicilio|codigo postal|regimen|uso de cfdi|datos fiscales|datos|nombre|fecha)( (esta|estan|viene|vienen|salio|salieron|aparece|aparecen))? (mal|incorrect[oa]s?|equivocad[oa]s?|erronea?s?|erroneos?)|(tiene|trae|traen|tienen|hay) (un |unos |algun )?(error|errores)|(viene|vino|esta|salio) con (error|errores)|me (cobraron|facturaron) (de mas|doble|mal|dos veces)|cobro (indebido|doble|de mas)|(corregir|corrijan|corrige|cancelar|cancelen|cancela) (la|el|esa|ese|mi) (factura|cfdi|documento|cotizacion|contrato|poliza)|refactur\w*|no coincide (el|la) (monto|total|importe|rfc|precio))\b/;

/** Lleva tiempo esperando: "sigo esperando", "nadie me contesta". */
const DEMORA =
  /\b(sigo esperando|seguimos esperando|llevo (\w+ ){0,2}(dias|horas|semanas|rato|tiempo|mucho) esperando|(tengo|llevo) (\w+ ){0,2}(dias|horas|semanas) (esperando|sin respuesta)|nadie me (contesta|responde|atiende|hace caso|ha contestado|ha respondido)|no me (han )?(contestado|respondido|atendido|resuelto)|no me (contestan|responden|atienden|resuelven)|(se tardan|tardan|tardaron) (mucho|demasiado|un monton)|cuanto (mas|tiempo) (tengo que|voy a|hay que) esperar|ya paso (mucho tiempo|una semana|un dia|\w+ dias))\b/;

/** El bot no le está sirviendo, o quiere dejar una queja formal. */
const MAL_SERVICIO =
  /\b((pesimo|mal|malisimo|terrible|horrible|fatal) (servicio|atencion|bot|sistema)|que (mal|malo|pesimo) (servicio|atencion)|no sirves|no sirve (para nada|este bot|el bot|esto|de nada)|(eres|es un|que bot) (inutil|tonto)|bot inutil|no entiendes nada|no me (entiendes|estas entendiendo)|no me ayudas (en nada|para nada)|nunca (encuentras|sirves|funciona|me ayudas)|es una burla|es el colmo|inaceptable|voy a (poner|levantar|meter) (una )?(queja|denuncia)|quiero (poner|levantar|hacer|presentar|dejar) (una )?queja|(tengo|es) una queja)\b/;

/** Le mandamos lo que no era, dicho como reclamo. */
const EQUIVOCADO =
  /\b(te equivocaste|se equivocaron|me (mandaste|enviaste|pasaste) (la|el|otra|otro) ?(equivocad[oa]|incorrect[oa]|que no era)|me (mandaste|enviaste|pasaste) (otra cosa|otro documento|otra factura)|(otra vez|de nuevo) (la|el|lo) (misma|mismo|equivocad[oa])|no es lo que (te )?pedi|eso no (fue|es) lo que (te )?pedi)\b/;

function motivoDeQueja(texto: string, limpio: string): MotivoQueja | null {
  if (esQuejaDeNoRecibido(texto)) return 'no_recibido';
  if (ERROR_EN_DOCUMENTO.test(limpio)) return 'error_en_documento';
  if (DEMORA.test(limpio)) return 'demora';
  if (MAL_SERVICIO.test(limpio)) return 'mal_servicio';
  if (EQUIVOCADO.test(limpio)) return 'documento_equivocado';
  return null;
}

/**
 * ¿Se nota molesto? Palabras fuertes, groserías, "???" de impaciencia o un
 * mensaje entero en mayúsculas.
 *
 * Es independiente del tipo: "LA FACTURA DE MARZO" es una solicitud, pero
 * no se contesta igual que "la factura de marzo". Los "!!" no cuentan: en
 * WhatsApp igual son de enojo que de gusto ("¡¡gracias!!").
 */
function seNotaMolesto(texto: string, limpio: string): boolean {
  const MOLESTIA =
    /\b(pesim[oa]|horrible|terrible|inaceptable|indignante|hart[oa]s?|molest[oa]|enojad[oa]|encabronad[oa]|furios[oa]|una burla|el colmo|no puede ser|cuantas veces|ya van \w+ veces|otra vez lo mismo|que poca|no sirves?|inutil|nadie me (contesta|responde|atiende|hace caso)|mierda|chingad\w*|pinche|carajo|verga|puta|joder|wtf)\b/;

  if (MOLESTIA.test(limpio)) return true;
  if (/\?{3,}/.test(texto)) return true;

  const letras = texto.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  const mayusculas = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
  return letras.length >= 12 && mayusculas / letras.length >= 0.8;
}

// ── Seguimiento, cortesía y consultas ──────────────────────────────────

/** "¿Ya revisaron mi caso?", "¿qué pasó con mi ticket?", "¿alguna novedad?". */
function preguntaPorSuCaso(limpio: string): boolean {
  return (
    /\b((ya )?(revisaron|vieron|checaron|resolvieron|atendieron|contestaron) (mi |el )?(caso|ticket|solicitud|queja|pendiente|asunto)|que (paso|onda|hay) con (mi |el )?(caso|ticket|solicitud|queja|pendiente|asunto)|(alguna|hay|tienes|tienen) (novedad|novedades|noticias|avance)|como va (mi |el )?(caso|ticket|solicitud|queja|tramite|asunto)|(estatus|status|seguimiento) (de|del|a) (mi |el )?(caso|ticket|solicitud|queja)|(ticket|caso) \d+)\b/.test(
      limpio,
    ) || /^(y )?(ya )?(lo )?(revisaron|vieron|checaron|resolvieron)$/.test(limpio)
  );
}

/** Saludo, agradecimiento, acuse o cierre, sin ningún otro contenido. */
export const SALUDO =
  /^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que tal|hey|que onda|como estas|como andas)( (buenas|que tal|como estas|como andas|buen dia|buenos dias|buenas tardes|brother|bro|amigo|amiga|jefe|jefa|compa|hermano|buenas buenas|que hay|todo bien))?$/;

export const CIERRE =
  /\b(es todo|eso es todo|con eso (esta bien|basta|es suficiente|me sirve|quedo)|asi esta bien|esta bien asi|ya quedo|ya esta(?= gracias| asi| bien|$)|ya con eso|nada mas|por ahora no|no gracias)\b/;

/**
 * ¿Da por terminada la conversación? CIERRE solo no basta: "¿ya está?" o
 * "nada más quería saber si ya está" contienen un cierre, pero preguntan
 * cómo va el pedido, y tomarlos como cierre abandonaba la solicitud justo
 * cuando la persona la estaba siguiendo.
 */
export function esCierre(texto: string): boolean {
  if (/[?¿]/.test(texto)) return false;
  const limpio = normalizar(texto);
  if (limpio.split(' ').length > 8) return false;
  if (/\b(saber|si ya|cuando|como va|como vas)\b/.test(limpio)) return false;
  return CIERRE.test(limpio);
}

/** Construcciones para pedir tiempo: se exige una frase, nunca un ordinal aislado. */
export const PAUSA =
  /^(?:espera(?:me)?(?: (?:tantito|un moment(?:o|ito)))?|aguanta(?:me)?(?: (?:tantito|un moment(?:o|ito)))?|un moment(?:o|ito)|dame un (?:moment(?:o|ito)|segundo)|ahorita (?:te digo|veo)|dejame (?:ver|checar))(?: (?:tantito|por favor))?$/;

export function esPausa(texto: string): boolean {
  return PAUSA.test(normalizar(texto));
}

export const ACUSE =
  /^(ok|okay|okey|oki|va|vale|sale|listo|perfecto|excelente|genial|de acuerdo|entendido|enterado|recibido|ya|si|dale|orale|ah ok|va bien|esta bien|muy bien)$/;

/**
 * Separa un marcador INICIAL y sus conectores de una petición explícita.
 * No decide si es documental: quien lo usa debe comprobar categoría/mes/folio.
 * Conserva el sufijo original para no alterar nombres de archivo ni datos.
 */
export function separarPeticionMixta(texto: string): {
  marcador: 'CIERRE' | 'PAUSA' | 'CORTESIA' | 'ACUSE';
  peticion: string;
} | null {
  const peticiones = /\b(?:necesito|quiero|quisiera|ocupo|busco|dame|m[aá]ndame|p[aá]same|env[ií]ame|comp[aá]rteme)\s+/gi;
  for (const match of texto.matchAll(peticiones)) {
    const inicio = texto.slice(0, match.index);
    // Una pregunta inicial ("¿ya está?, quiero...") no abandona el pedido.
    // Compruébalo antes de normalizar, que elimina los signos.
    if (/[?¿]/.test(inicio)) continue;
    const sinSignos = normalizar(inicio);
    const prefijo = sinSignos.replace(/(?:\s+(?:ahora|pero|mejor))+$/, '');
    // CIERRE también se usa para encontrar frases dentro de un mensaje;
    // aquí debe cubrir TODO el prefijo para no recortar contenido documental.
    const cierre = CIERRE.exec(prefijo);
    // Y tiene que ir SEPARADO del pedido (coma, punto o "ahora/pero/mejor"):
    // "Nada más, ahora quiero un contrato" cierra, pero "Nada más quiero la
    // de marzo" es "solo quiero la de marzo" y no debe tirar la solicitud.
    const separado = /[,.;:!]\s*$/.test(inicio) || sinSignos !== prefijo;
    const marcador = cierre?.[0] === prefijo && prefijo !== '' && separado ? 'CIERRE'
      : PAUSA.test(prefijo) ? 'PAUSA'
      : /^(?:muchas )?gracias$/.test(prefijo) ? 'CORTESIA'
      : ACUSE.test(prefijo) ? 'ACUSE'
      : null;
    if (marcador) return { marcador, peticion: texto.slice(match.index) };
  }
  return null;
}

export const RECONOCE =
  /\b(es la misma|si es cierto|es cierto|tienes razon|tenias razon|ya la (tengo|vi|encontre)|ya lo (tengo|vi|encontre)|perdon|una disculpa|mi error|me equivoque|me confundi|no te preocupes|olvidalo|dejalo asi|ya no)\b/;

function esCortesia(limpio: string): boolean {
  if (limpio.length > 60) return false;
  const palabras = limpio.split(' ').length;
  return (
    SALUDO.test(limpio) ||
    ACUSE.test(limpio) ||
    (palabras <= 8 && (/\bgracias\b/.test(limpio) || CIERRE.test(limpio))) ||
    (palabras <= 12 && RECONOCE.test(limpio))
  );
}

/** Tiene forma de pregunta: signo de interrogación o arranque interrogativo. */
function esPregunta(texto: string, limpio: string): boolean {
  return (
    texto.includes('?') ||
    /^(que|como|cuando|donde|quien|quienes|cual|cuales|cuanto|cuanta|por que|porque|puedo|puedes|pueden|se puede|tienen|hay|me puedes|me pueden|sabes|saben)\b/.test(
      limpio,
    )
  );
}

// ── Detectores de frases concretas ─────────────────────────────────────

/**
 * "¿Cómo sabes que es de este mes?", "¿de qué fecha es?", "¿seguro que
 * es esa?", "¿por qué esa?": pregunta sobre lo que se acaba de mandar.
 */
export function preguntaSobreEntregado(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 90) return false;

  const M = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
  // "¿es de abril o de mayo?", "esta factura es de abril?", "dice que es de
  // abril", "es de abril, no de mayo", "yo te pedí la de mayo".
  const conMes = new RegExp(
    `\\b(es de ${M} o (de )?${M}|(esta|esa|la) (factura|cotizacion|contrato|reporte|poliza|documento)( que (me )?mandaste)? es de ${M}|dice que es de ${M}|es de ${M},? no (de|la de) ${M}|(yo )?te (pedi|habia pedido|dije) la de ${M})\\b`,
  );

  return (
    /\b(como sabes|como supiste|por que (esa|ese|esta|este|dices|crees|me mandas|me mandaste)|de que (mes|fecha|ano|anio) es|que (mes|fecha) (es|tiene|trae)|de cuando es|(estas|esta) segur[oa]|es (la|el) correct[oa]|es (la|el) de este mes)\b|^segur[oa]( que)?\s*\?|(?<!no )\bes de (este|ese) mes\??$|\bsi es de (este|ese) mes\b/.test(
      limpio,
    ) || conMes.test(limpio)
  );
}

/**
 * Un rechazo dentro de un mensaje que además trae datos: "sí es la
 * cotización pero esa no es de este mes", "no es de septiembre, es de
 * octubre", "esa no, la de marzo".
 */
export function mencionaRechazo(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (limpio.length > 160) return false;

  return /\b((esa|ese|esta|este) no( es| era)?\b|no (es|era) (de|del|la de|el de|esa|ese|esta|este)\b|no corresponde|no coincide|esta mal|es (la|el) equivocad[oa]|te equivocaste|no es (la|el) correct[oa]|otra distinta|otro distinto|no es la que|no es el que)/.test(
    limpio,
  );
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
export function leerNumero(texto: string): number | null {
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
    // "es el número dos", "la tres": con letra también.
    uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
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
export function esQuejaDeNoRecibido(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 60) return false;

  const peticion = limpio.replace(/[¿?!.]/g, '').trim();
  if (/^(?:reenvia(?:me)?(?:lo|la)|(?:mandame(?:lo|la)|me (?:lo|la) mandas) (?:de nuevo|otra vez))$/.test(peticion)) {
    return true;
  }

  return /\b(no (lo |la |me )?(veo|llego|llega|recibi|aparece|abre)|no me lo mandaste|donde esta|no vino|no esta el (doc|archivo|pdf)|(mandala|mandalo|pasala|pasalo|enviala|envialo) (otra vez|de nuevo)|(otra vez|de nuevo)$|reenvia(la|lo|me)?|vuelve(la|lo)? a (mandar|pasar|enviar))\b/.test(
    limpio,
  );
}

/** ¿El texto trae tipo, mes, año o folio? Entonces no es charla. */
export function parseQueryTieneDatos(limpio: string): boolean {
  return (
    /\b(factura|facturas|contrato|contratos|cotizacion|cotizaciones|reporte|reportes|poliza|polizas|cfdi|recibo|comprobante|documento|archivo|pdf)\b/.test(limpio) ||
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|20\d\d)\b/.test(limpio) ||
    /\b[a-z]{1,3}\d{3,}\b/.test(limpio)
  );
}

/**
 * ¿Pregunta qué hay? "qué documentos tienes", "dame las opciones", "qué me
 * puedes entregar", "qué hay de este mes". Se contesta con el inventario,
 * sin modelo y sin abrir ticket.
 */
export function esInventario(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 90) return false;

  // Las preguntas de disponibilidad admiten detalles entre el interrogativo
  // y la consulta: "qué contratos tengo disponibles". El interrogativo debe
  // abrir la pregunta y la consulta cerrarla; así "la factura que tengo
  // pendiente" o "cuál cotización tienes de enero" siguen siendo búsquedas.
  const disponibilidad = new RegExp(
    `${INICIO_DE_PREGUNTA}(?:que|cuales|cual)(?: \\w+){0,3} (?:tengo|tienes|tenemos|hay)(?: disponibles?)?$`,
  );
  if (disponibilidad.test(normalizar(texto))) return true;
  if (preguntaMeses(texto)) return true;

  return /\b((que|cuales|cual) (documentos|docs|archivos|opciones|cosas|meses|fechas)\b|opciones de lo que tienes|cuales tienes|cuales hay|(de que|de cuales) (meses|fechas)|que tienes\b|que hay\b|que( (doc|docs|documento|documentos|archivo|archivos))? me puedes (dar|entregar|mandar|pasar|enviar)|que puedes (darme|entregarme|mandarme|pasarme|enviarme)|lista(me)? (lo que|los documentos|todo)|catalogo|inventario|todo lo que (tienes|tengas|haya))/.test(
    limpio,
  );
}

/** "sí", "esa", "ese mismo", "dale": para cuando solo se ofreció una opción. */
export function esAfirmacion(texto: string): boolean {
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
export function pideHumano(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 120) return false;

  const alguien = /\b(agente|persona|humano|humana|alguien|asesor|asesora|ejecutivo|ejecutiva|encargado|encargada|operador|operadora|soporte|un ser humano)\b/;
  const accion = /\b(pasa|pasame|pasarme|comunica|comunicame|comunicarme|hablar|hable|atienda|atiendan|contacte|contacten|llame|llamen|quiero|necesito|me puede|me pueden|con un|con una|con el|con la)\b/;

  return alguien.test(limpio) && accion.test(limpio);
}

/**
 * "No es esa", "ninguna de esas", "esa no", "tampoco", "no me sirve",
 * "te digo que ninguna": rechazo de lo ofrecido o lo entregado. Corto y
 * sin datos de documento; con datos ("no, la de marzo") va por el flujo
 * normal, que ya sabe que es otra petición.
 */
export function esRechazo(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (limpio.length === 0 || limpio.split(' ').length > 9) return false;
  if (parseQueryTieneDatos(limpio)) return false;

  return /\b(no (es|son) (esa|ese|esta|este|esas|esos|estas|estos|ninguna|ninguno)|(esa|ese|esas|esos) no( es| son)?|ningun[ao]( de (esas|esos|estas|estos|las dos|los dos))?|tampoco|no me sirve|no (es|era) (la|el) que|no son (esas|esos)|no es ninguna|nel|nop)\b/.test(
    limpio,
  ) || /^(no|no no|que no|otra|otro|no otra|otra distinta|busca otra|buscamos otra|mejor otra|no esa|no ese|esa no|ese no|no gracias otra)$/.test(limpio);
}

/**
 * Dónde puede ir el interrogativo de una pregunta: al inicio del mensaje o
 * detrás de un saludo o de "dime", "me puedes decir"… En cualquier otro
 * lugar suele ser un "que" relativo: "la factura que tengo".
 */
const INICIO_DE_PREGUNTA =
  '(?:^|\\b(?:hola|oye|y|entonces|decir|dime|dices|saber|sabes|mostrar|muestrame|indicar|indicame) )';

/** "¿De qué meses hay?", "qué meses tienes", "de qué fechas", "cuáles son esos 6 meses". */
export function preguntaMeses(texto: string): boolean {
  const limpio = normalizar(texto);
  if (/\b(que|cuales|de que|de cuales) (meses|fechas)\b/.test(limpio)) return true;
  // Con palabras en medio solo cuenta si el interrogativo abre la pregunta:
  // "quiero que me pases los meses" no pregunta nada.
  return new RegExp(
    `${INICIO_DE_PREGUNTA}(?:de )?(?:que|cuales)(?: \\w+){1,4} (?:meses|fechas)\\b`,
  ).test(limpio);
}
