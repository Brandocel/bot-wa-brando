/**
 * La voz del asistente: todo lo que le dice al cliente, en un solo sitio.
 *
 * Son plantillas, no modelo — cuestan cero — pero con dos cosas que hacen
 * que no suenen a contestador: varias formas de decir lo mismo (se elige
 * una al azar, como haría cualquiera que no repite la frase exacta tres
 * veces en una tarde) y contexto (nombre del documento, mes en palabras,
 * quién atiende, si es la segunda entrega del hilo).
 *
 * Cómo se redacta, y por qué:
 *
 *  - Frases cortas. Una idea por frase, punto, siguiente idea. Lo lee
 *    gente con prisa, en un celular, y a veces gente mayor que no tiene
 *    por qué descifrar una oración de tres renglones.
 *  - Lo importante en *negritas* (formato de WhatsApp): el nombre del
 *    archivo, el mes, el folio, el número de la lista. Es lo que la vista
 *    busca primero, y así se encuentra sin leer todo.
 *  - Primero lo que pasó, después lo que sigue. "Es de abril. ¿La necesitas
 *    de mayo?" y no al revés. Y siempre se dice qué puede hacer la persona
 *    a continuación: nunca se cierra con un "no" seco.
 *  - Sin jerga: "el archivo" y no "el documento indexado"; "por dentro"
 *    y no "el contenido extraído". Se explica como se le explicaría a un
 *    tío por teléfono.
 *
 * Tono: español de México, tuteo, cálido y claro. Como alguien del equipo
 * que conoce a la persona, sabe de lo que habla y no tiene prisa por
 * colgar. Sin emojis: en un canal de facturas sobran.
 */

import type { MotivoQueja } from './message-classifier';

export interface Agente {
  name: string;
}

function una(opciones: readonly string[]): string {
  return opciones[Math.floor(Math.random() * opciones.length)]!;
}

/** Negritas de WhatsApp. */
function n(texto: string): string {
  return `*${texto}*`;
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ── Saludos y cortesía ─────────────────────────────────────────────────

export function saludoInicial(empresa: string | null, nombre: string | null = null, mensaje = ''): string {
  // Por su nombre, si WhatsApp trae uno que parezca nombre. Es la diferencia
  // entre "¡Hola!" de contestador y "¡Hola, Mariana!" de alguien del equipo.
  const hola = saludoBreve(mensaje, nombre);
  const presentacion = empresa
    ? `Soy Jarvis, el asistente documental de ${n(empresa)}. Puedo ayudarte a encontrar y recibir documentos por aquí.`
    : 'Soy Jarvis, tu asistente documental. Puedo ayudarte a encontrar y recibir documentos por aquí.';
  return `${hola} Qué gusto saludarte. ${presentacion}\n¿En qué te puedo ayudar hoy?`;
}

/**
 * El nombre de pila con el que saludar, o null si lo que trae WhatsApp no
 * parece un nombre ("BM", "🌸🌸", un número, una empresa entera).
 */
export function nombreDePila(pushName: string | null | undefined): string | null {
  if (!pushName) return null;
  const primera = pushName.trim().split(/\s+/)[0] ?? '';
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,16}$/.test(primera)) return null;
  if (/^(empresa|grupo|constructora|corporativo|despacho|oficina|servicios|administraci[oó]n)$/i.test(primera)) return null;
  return primera.charAt(0).toUpperCase() + primera.slice(1).toLowerCase();
}

export function saludoDeNuevo(mensaje: string, nombre: string | null = null): string {
  return `${saludoBreve(mensaje, nombre)} Qué gusto saludarte. ¿Qué documento necesitas hoy?`;
}

export function saludoBreve(mensaje: string, nombre: string | null): string {
  let base = 'Hola';
  if (/\bbuenos dias\b|\bbuen dia\b/.test(mensaje)) base = 'Buenos días';
  else if (/\bbuenas tardes\b/.test(mensaje)) base = 'Buenas tardes';
  else if (/\bbuenas noches\b/.test(mensaje)) base = 'Buenas noches';
  return `¡${base}${nombre ? `, ${nombre}` : ''}!`;
}

/** Responde el saludo sin reabrir una solicitud documental pendiente. */
export function respuestaSocial(mensaje: string): string {
  if (/\bcomo estas\b/.test(mensaje)) {
    return una([
      '¡Todo bien, gracias! Qué gusto saludarte.',
      'Muy bien, gracias por preguntar. ¡Hola!',
    ]);
  }

  if (/\bbuenos dias\b|\bbuen dia\b/.test(mensaje)) {
    return una(['¡Buenos días! Qué gusto saludarte.', '¡Buenos días!']);
  }

  if (/\bbuenas tardes\b/.test(mensaje)) {
    return una(['¡Buenas tardes! Qué gusto saludarte.', '¡Buenas tardes!']);
  }

  if (/\bbuenas noches\b/.test(mensaje)) {
    return una(['¡Buenas noches! Qué gusto saludarte.', '¡Buenas noches!']);
  }

  return '¡Hola! Qué gusto saludarte.';
}

export function deNada(): string {
  return una([
    'Con gusto. Cualquier otro documento que necesites, aquí estoy.',
    'Para eso estamos. Si necesitas algo más, nomás dime.',
    'De nada. Aquí ando cuando necesites otro.',
  ]);
}

export function archivoNoLeible(): string {
  return una([
    'Recibí tu archivo, pero por ahora solo entiendo texto.\nEscríbeme qué documento necesitas y de qué mes, y te lo busco.',
    'Me llegó tu archivo. Todavía no sé leer fotos ni audios, pero sí texto: dime qué documento necesitas y lo busco.',
  ]);
}

export function charlaSinModelo(empresas: string): string {
  return una([
    `Aquí ando. Puedo buscarte documentos de ${n(empresas)}.\nDime cuál necesitas y de qué mes.`,
    `Cuenta conmigo para los documentos de ${n(empresas)}. ¿Cuál te busco?`,
  ]);
}

/** Cierre breve cuando la persona abandona una solicitud pendiente. */
export function cierreSolicitud(): string {
  return 'Entendido, lo dejamos aquí. Cuando necesites otro documento, dime.';
}

export function respuestaPausa(): string {
  return 'Claro, tómate tu tiempo.';
}

// ── Preguntas ──────────────────────────────────────────────────────────

export function preguntaTipo(): string {
  return una([
    'Claro. ¿Qué documento necesitas?\nPuedo buscarte *facturas*, *contratos*, *cotizaciones*, *reportes* o *pólizas*.',
    'Va. ¿Qué documento te busco?\nTengo *facturas*, *contratos*, *cotizaciones*, *reportes* y *pólizas*.',
  ]);
}

export function preguntaTipoConMes(mes: string): string {
  return una([
    `De ${n(mes)} tengo varios documentos.\n¿Cuál necesitas: *factura*, *contrato*, *cotización*, *reporte* o *póliza*?`,
    `Tengo varias cosas de ${n(mes)}.\n¿Cuál te busco: *factura*, *contrato*, *cotización*, *reporte* o *póliza*?`,
  ]);
}

export function preguntaMes(tipo: string): string {
  return una([
    `Claro. ¿De qué *mes* necesitas ${tipo}?`,
    `¿De qué *mes* es ${tipo}?`,
  ]);
}

export function preguntaEmpresa(): string {
  return una([
    'Tienes acceso a varias empresas. ¿De cuál lo necesitas?',
    'Veo que puedes consultar varias empresas. ¿De cuál te lo busco?',
  ]);
}

/** Cómo se repite la pregunta pendiente cuando la persona vuelve. */
export const PREGUNTA_PENDIENTE = {
  categoria: '¿Qué documento necesitas?',
  periodo: '¿De qué *mes* lo necesitas?',
  empresa: '¿De qué empresa lo necesitas? Responde con el *número* de la lista.',
  detalle: '¿Me das el *folio*, el *nombre del archivo* o el *mes exacto*?',
} as const;

// ── Listas ─────────────────────────────────────────────────────────────

export function encabezadoLista(cuantos: number, que: string): string {
  return una([
    `Tengo ${n(String(cuantos))} ${que}. ¿Cuál te mando?`,
    `Encontré ${n(String(cuantos))} ${que}. Dime cuál necesitas:`,
    `Hay ${n(String(cuantos))} ${que}. ¿Cuál te sirve?`,
  ]);
}

export function encabezadoListaLimitada(total: number, mostrados: number, que: string): string {
  return `Encontré ${n(String(total))} ${que}. Te muestro ${n(String(mostrados))} opciones:`;
}

// ── Varios documentos en un mensaje ─────────────────────────────────────

/** "a", "a y b", "a, b y c". */
function enumerar(cosas: readonly string[]): string {
  if (cosas.length <= 1) return cosas[0] ?? '';
  return `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`;
}

export function encabezadoVariasDe(que: string): string {
  return `De ${n(que)} encontré varias:`;
}

export function noEncontreVarios(pedidos: readonly string[]): string {
  return pedidos.length === 1
    ? `No encontré ${n(pedidos[0]!)}.`
    : `No encontré ${enumerar(pedidos.map(n))}.`;
}

export function yaEstabanArriba(nombres: readonly string[]): string {
  return nombres.length === 1
    ? `${n(nombres[0]!)} ya te lo había mandado hace un momento; está arriba.`
    : `${enumerar(nombres.map(n))} ya te los había mandado hace un momento; están arriba.`;
}

export function hayMasDeLasEnviadas(cuantas: number): string {
  return `Hay ${n(String(cuantas))} más. Si las necesitas, dime de qué mes y te las mando.`;
}

export function comoUbicarVarios(): string {
  return 'Si tienes el *folio* o el *nombre del archivo*, compártemelo y vuelvo a buscar.';
}

export function numerosFueraDeLista(cuantas: number): string {
  return `Esos números no están en la lista: van del *1* al *${cuantas}*. ¿Cuáles te mando?`;
}

export function pieLista(): string {
  return una(['Responde con el *número*.', 'Con el *número* me basta.', 'Dime el *número* y te lo mando.']);
}

export function encabezadoInventarioMes(mes: string, cuantos: number): string {
  return `De ${n(mes)} tengo ${cuantos === 1 ? 'esto' : `estos ${n(String(cuantos))}`}:`;
}

export function pieInventario(): string {
  return una(['Si quieres alguno, dime el *número*.', 'Pide el que necesites con el *número*.']);
}

// ── Entregas ───────────────────────────────────────────────────────────

export function entrega(que: string, esOtraMas: boolean, saludo = '', nombreEnLote: string | null = null): string {
  // Cada adjunto del lote conserva una leyenda identificable sin repetir la introducción.
  if (nombreEnLote) return `${n(nombreEnLote)} — ${que}`;
  const mensaje = esOtraMas
    ? `También te mando ${n(que)}.`
    : una([
        `Listo, aquí tienes ${n(que)}.\nSi necesitas algo más, aquí ando.`,
        `Aquí está ${n(que)}.\nCualquier otra cosa, me dices.`,
        `Te mando ${n(que)}.\nAvísame si necesitas otro.`,
      ]);
  return saludo ? `${saludo} ${mensaje}` : mensaje;
}

export function reenvio(nombre: string, tipo: string): string {
  return `Claro, te mando de nuevo ${tipo}: ${n(nombre)}.`;
}

export function entregaFallida(folio: string, agente: Agente | null): string {
  const cabeza = 'Encontré tu documento, pero no logré enviártelo por aquí.';
  return agente
    ? `${cabeza}\nYa se lo pasé a ${n(agente.name)} con el folio ${n(folio)} para que te lo haga llegar.`
    : `${cabeza}\nLo pasé al equipo con el folio ${n(folio)} para que te lo hagan llegar.`;
}

export function reenvioFallido(nombre: string, folio: string): string {
  return `Sigo sin poder enviarte ${n(nombre)} por aquí.\nYa lo pasé al equipo con el folio ${n(folio)} para que te lo hagan llegar. Una disculpa por la vuelta.`;
}

// ── Cuando no aparece ──────────────────────────────────────────────────

export function noEncontreParecidos(pedido: string): string {
  return una([
    `No encontré ${pedido}, pero tengo esto que se parece:`,
    `${mayuscula(pedido)} no aparece. Lo más cercano que tengo es esto:`,
  ]);
}

export function pieParecidos(): string {
  return una(['¿Te sirve alguno? Dime el *número*.', 'Si alguno es, respóndeme con el *número*.']);
}

export function noEncontreListaTodo(pedido: string, empresa: string | null): string {
  const de = empresa ? ` de ${n(empresa)}` : '';
  return una([
    `No encontré ${pedido}. Lo que tengo${de} es esto:`,
    `${mayuscula(pedido)} no aparece. Te dejo lo que sí tengo${de}:`,
  ]);
}

export function noEncontreInventario(pedido: string, inventario: string): string {
  return una([
    `No encontré ${pedido}.\n${inventario}\n¿Te sirve alguno?`,
    `${mayuscula(pedido)} no lo tengo.\n${inventario}\nSi alguno te sirve, dime cuál.`,
  ]);
}

export function noEncontreEscalado(pedido: string, folio: string, agente: Agente | null): string {
  const cabeza = `No encontré ${pedido}.`;
  return agente
    ? `${cabeza}\nSe lo pasé a ${n(agente.name)} con el folio ${n(folio)}; te escribe por aquí en cuanto lo revise.`
    : `${cabeza}\nLo dejé anotado con el folio ${n(folio)} para que alguien del equipo lo revise y te escriba.`;
}

export function sinDocumentosDe(que: string, mes: string | null, empresa: string | null, resto: string | null): string {
  const base = `Por ahora no tengo ${que}${mes ? ` de ${n(mes)}` : ''}${empresa ? ` de ${n(empresa)}` : ''}.`;
  return resto ? `${base}\n${resto}` : base;
}

export function inventarioGeneral(inventario: string): string {
  return una([
    `${inventario}\nDime cuál necesitas y de qué mes.`,
    `${inventario}\n¿Cuál te busco?`,
  ]);
}

export function sinNada(empresa: string | null): string {
  return `Todavía no tengo documentos cargados${empresa ? ` de ${n(empresa)}` : ''}.\nEn cuanto haya, por aquí te los busco.`;
}

// ── Pasar a una persona ────────────────────────────────────────────────

export function pasarAHumano(folio: string, agente: Agente | null): string {
  return agente
    ? una([
        `Claro. Te atiende ${n(agente.name)}.\nYa tiene tu caso con el folio ${n(folio)} y te escribe por aquí.`,
        `Por supuesto. Le paso tu caso a ${n(agente.name)} (folio ${n(folio)}); en un momento te escribe por aquí.`,
      ])
    : una([
        `Claro. Lo dejé anotado con el folio ${n(folio)}.\nAlguien del equipo te contacta por aquí.`,
        `Por supuesto. Quedó registrado con el folio ${n(folio)} y alguien del equipo te escribe por aquí.`,
      ]);
}

export function noTeEntiendo(folio: string, agente: Agente | null): string {
  const cabeza = una([
    'Creo que no te estoy entendiendo bien, y no quiero hacerte dar más vueltas.',
    'Perdón, no logro entender bien qué necesitas, y no quiero marearte.',
  ]);
  const cola = agente
    ? `Te atiende ${n(agente.name)}; ya tiene tu caso con el folio ${n(folio)}.`
    : `Ya le pasé tu caso al equipo con el folio ${n(folio)}; alguien te contacta.`;
  return `${cabeza}\n${cola}`;
}

export function yaPregunte(folio: string, agente: Agente | null): string {
  const cabeza = 'Ya te lo había preguntado y sigo sin entenderlo bien. No quiero hacerte repetir.';
  const cola = agente
    ? `Te atiende ${n(agente.name)}; ya tiene tu caso con el folio ${n(folio)}.`
    : `Se lo pasé al equipo con el folio ${n(folio)}.`;
  return `${cabeza}\n${cola}`;
}

export function tocoElTecho(): string {
  return 'Llevamos muchos mensajes seguidos. Dame un rato y te sigo atendiendo.\nYa quedó marcado para que alguien del equipo lo vea, por si es urgente.';
}

// ── Cuando falta información ───────────────────────────────────────────

export function seParecen(pedido: string): string {
  return una([
    `No tengo exactamente ${pedido}, pero estos se le parecen:`,
    `${mayuscula(pedido)} no aparece tal cual. Mira si es alguno de estos:`,
  ]);
}

export function muchosSinMes(cuantos: number, tipoPlural: string, mes: string): string {
  return una([
    `Tengo ${n(String(cuantos))} ${tipoPlural}, pero no de ${n(mes)}.\nSi tienes el *folio* o el *nombre del archivo*, compártemelo.`,
    `De ${n(mes)} no veo ${tipoPlural}; tengo ${n(String(cuantos))} de otros meses.\nCon el *folio* o el *nombre del archivo* puedo buscarlo mejor.`,
  ]);
}

export function faltaInformacion(pedido: string): string {
  return `Encontré varias opciones para ${pedido}. Si tienes el *folio* o el *nombre del archivo*, compártemelo y afino la búsqueda.`;
}

/** Cero coincidencias: ofrecer únicamente datos que aún no están en la solicitud. */
interface DatosConocidos {
  folio: boolean;
  periodo: boolean;
  nombre: boolean;
}

function datosFaltantes(conocidos: DatosConocidos): string[] {
  return [
    !conocidos.folio && 'el *folio*',
    !conocidos.nombre && 'el *nombre del archivo*',
    !conocidos.periodo && 'el *mes*',
  ].filter((dato): dato is string => Boolean(dato));
}

export function sinCoincidencias(pedido: string, conocidos: DatosConocidos): string {
  const faltan = datosFaltantes(conocidos);
  const base = `Por ahora no encontré ${pedido}.`;
  return faltan.length > 0
    ? `${base} Si tienes ${faltan.join(' o ')}, compárteme ese dato y lo busco.`
    : `${base} Si quieres, revisamos otro documento.`;
}

export function sinInformacionEscalado(pedido: string, folio: string, agente: Agente | null): string {
  const cabeza = `Con lo que tengo no logro ubicar ${pedido}.`;
  return agente
    ? `${cabeza}\nSe lo pasé a ${n(agente.name)} con el folio ${n(folio)}; te escribe por aquí para revisarlo contigo.`
    : `${cabeza}\nQuedó con el folio ${n(folio)} para que alguien del equipo lo revise contigo.`;
}

export function rechazoPideDetalle(pedido: string): string {
  return una([
    `Entendido, esas opciones no corresponden a ${pedido}. ¿Tienes el *folio* o el *nombre del archivo*?`,
    `Va, esas no. Si tienes el *folio* o el *nombre del archivo* de ${pedido}, compártemelo y busco de nuevo.`,
  ]);
}

export function mesesDisponibles(tipoPlural: string, meses: readonly string[]): string {
  const lista = meses.map((m) => `• ${m}`).join('\n');
  return una([
    `De ${tipoPlural} tengo de estos meses:\n${lista}\n¿Cuál te mando?`,
    `Hay ${tipoPlural} de:\n${lista}\nDime el *mes* y busco el archivo.`,
  ]);
}

// ── Leer antes de mandar ───────────────────────────────────────────────

/** Solo hay un candidato y es de otro mes: se ofrece, no se manda. */
export function unicaDeOtroMes(pedido: string, nombre: string, mes: string): string {
  return una([
    `No encontré ${pedido}. Veo ${n(nombre)}, de ${n(mes)}. ¿Te mando ese archivo o buscamos otro?`,
    `De ese mes no encontré ${pedido}. Lo más cercano es ${n(nombre)}, de ${n(mes)}. Si te sirve, dime *sí* y te lo mando.`,
  ]);
}

/** Solo hay un candidato y no se sabe de qué mes es: se dice tal cual. */
export function unicaSinMes(pedido: string, nombre: string): string {
  return una([
    `Tengo ${n(nombre)}, pero no indica el mes en el nombre ni en el contenido. No puedo asegurar que sea ${pedido}. ¿Te lo mando para que lo revises?`,
    `Lo más parecido es ${n(nombre)}. No sé si es ${pedido} porque no indica el mes. Si quieres, te lo mando para que lo revises.`,
  ]);
}

/** La búsqueda cayó en lo mismo que se acaba de mandar. */
export function esLaMisma(nombre: string): string {
  return una([
    `Es el mismo archivo que te acabo de mandar: ${n(nombre)}. Si buscas otro, compárteme el *folio* o el *nombre del archivo*.`,
    `${n(nombre)} ya está arriba. Si necesitas otro, dime el *folio* o el *nombre del archivo* y lo busco.`,
  ]);
}

/** Rechazó lo único que había: se dice así en vez de "no encontré". */
export function soloTeniaEsa(pedido: string, cuantas: number, conocidos: DatosConocidos): string {
  const faltan = datosFaltantes(conocidos);
  const ayuda = faltan.length > 0
    ? `Si tienes ${faltan.join(' o ')}, compárteme ese dato y busco otra opción.`
    : 'Si quieres, revisamos otra solicitud.';
  const contexto = cuantas > 1
    ? 'Los archivos que te mostré no eran los que necesitabas.'
    : 'Ese archivo no era el que necesitabas.';
  return `${contexto} Por ahora no encontré ${pedido}. ${ayuda}`;
}

// ── Explicar de dónde salió un dato ────────────────────────────────────

export function mesPorNombre(nombre: string, mes: string): string {
  return una([
    `Es de ${n(mes)}. Lo dice el nombre del archivo: ${n(nombre)}.\nSi sabes que es de otro mes, dime cuál y busco el correcto.`,
    `Por el nombre del archivo, ${n(nombre)}, es de ${n(mes)}.\nSi no cuadra, dime de qué mes debería ser y busco otro.`,
  ]);
}

export function mesPorContenido(nombre: string, mes: string): string {
  return una([
    `Es de ${n(mes)}. Lo leí en el propio documento: ${n(nombre)} trae esa fecha.\nSi sabes que es de otro mes, dime cuál y busco el correcto.`,
    `Por lo que dice adentro, ${n(nombre)} está fechado en ${n(mes)}.\nSi no es lo que esperabas, dime el mes y busco otro.`,
  ]);
}

export function mesDesconocido(nombre: string): string {
  return `No te lo puedo asegurar con certeza. ${n(nombre)} no indica el mes en el nombre ni en el contenido que tengo. Si sabes de qué mes debería ser, dímelo y busco otra opción.`;
}

export function mesPorIndice(nombre: string, mes: string): string {
  return `Según nuestro registro, ${n(nombre)} es de ${n(mes)}.\nSi sabes que es de otro mes, dime cuál y busco el correcto.`;
}

export function mesPorContenidoCorrigiendo(nombre: string, mesDentro: string, mesNombre: string): string {
  return una([
    `Es de ${n(mesDentro)}. Así dice la *fecha de emisión* dentro del documento.\nEl nombre del archivo (${n(nombre)}) trae una marca de ${mesNombre}, pero esa es la fecha en que se *descargó*, no la del documento.`,
    `Por dentro dice ${n(mesDentro)} (fecha de emisión).\nLo de ${mesNombre} viene del nombre del archivo, que es cuando se bajó del portal. La buena es la de adentro.`,
  ]);
}

export function perdonMesEquivocado(mesDicho: string): string {
  return una([
    `Tienes razón: te envié el archivo como de ${mesDicho}, y no es así.`,
    `Perdón, etiqueté mal el archivo como de ${mesDicho}.`,
  ]);
}

export function siHayDeEseMes(tipoPlural: string, mes: string): string {
  return `De ${n(mes)} sí tengo ${tipoPlural}. Dime el *número* y te mando el archivo:`;
}

export function noHayDeEseMes(tipoPlural: string, mes: string): string {
  return una([
    `De ${n(mes)} no veo ${tipoPlural} en la carpeta.\nSi tienes el *folio* o el *nombre del archivo*, compártemelo.`,
    `Por ahora no encontré ${tipoPlural} de ${n(mes)}.\nCon el *folio* puedo buscarlo mejor.`,
  ]);
}

/** La persona reconoce algo ("sí, es la misma", "perdón"): una línea y ya. */
export function sinProblema(): string {
  return una([
    'Sin problema. Aquí ando si necesitas otra.',
    'No te preocupes. Cualquier otro documento, me dices.',
    'Todo bien. Si necesitas algo más, aquí estoy.',
  ]);
}

// ── Quejas y seguimiento ───────────────────────────────────────────────
//
// Primero se reconoce lo que pasó, luego se dice quién lo atiende. Nunca
// una excusa larga ni "entendemos su frustración": una frase honesta y
// qué sigue.

/** Quién atiende, como cierre de los mensajes de queja. */
function quienAtiende(folio: string, agente: Agente | null): string {
  return agente
    ? `Ya se lo pasé a ${n(agente.name)} con el folio ${n(folio)}, como *prioridad alta*.\nTe escribe por aquí.`
    : `Quedó registrado con el folio ${n(folio)}, como *prioridad alta*.\nAlguien del equipo te escribe por aquí.`;
}

/** Una queja que el bot no puede resolver: se reconoce y pasa a una persona. */
export function quejaEscalada(motivo: MotivoQueja | null, folio: string, agente: Agente | null): string {
  const cabeza =
    motivo === 'error_en_documento'
      ? una([
          'Gracias por avisar. Si el documento trae un dato mal, hay que corregirlo.\nEso yo no lo puedo hacer desde aquí.',
          'Tienes razón en reclamarlo: un documento con datos mal no se puede quedar así.\nYo no lo puedo corregir, pero sí moverlo rápido.',
        ])
      : motivo === 'demora'
        ? una([
            'Perdón por la espera. No está bien que lleves tanto tiempo sin respuesta.',
            'Tienes toda la razón, ya esperaste demasiado. Una disculpa.',
          ])
        : una([
            'Perdón, no te estoy ayudando como debería.',
            'Tienes razón, y lamento las vueltas que te he hecho dar.',
          ]);

  return `${cabeza}\n${quienAtiende(folio, agente)}`;
}

/** Se queja de un caso que ya tiene alguien: no hay folio nuevo, hay prisa. */
export function quejaConCasoAbierto(folio: string, agente: Agente | null): string {
  return agente
    ? `Tienes razón, y perdón por la espera.\nTu caso ${n(folio)} lo tiene ${n(agente.name)}. Ya le avisé otra vez y lo subí a *prioridad alta*.`
    : `Tienes razón, y perdón por la espera.\nTu caso ${n(folio)} sigue con el equipo. Lo subí a *prioridad alta* para que lo vean primero.`;
}

/** "¿Ya revisaron mi caso?" con un caso abierto. */
export function seguimientoCaso(folio: string, agente: Agente | null): string {
  return agente
    ? una([
        `Tu caso ${n(folio)} sigue abierto y lo tiene ${n(agente.name)}.\nYa sabe que estás esperando; te escribe por aquí.`,
        `${n(agente.name)} sigue con tu caso ${n(folio)}.\nLe dejé dicho que preguntaste. En cuanto tenga algo, te escribe.`,
      ])
    : `Tu caso ${n(folio)} sigue en revisión con el equipo.\nDejé anotado que preguntaste; te escriben por aquí.`;
}

/** Molesto y el bot ya dio vueltas: no más preguntas, pasa a una persona. */
export function molestoEscalado(folio: string, agente: Agente | null): string {
  return `Perdón, veo que esto te está costando más de lo que debería.\n${quienAtiende(folio, agente)}`;
}

/** Va antes de la respuesta cuando la persona se nota molesta. */
export function empatia(): string {
  return una(['Perdón por la molestia.', 'Una disculpa por la vuelta.', 'Entiendo, y perdón por el inconveniente.']);
}

/** Una pregunta que no es de documentos, sin modelo que la conteste. */
export function consultaSinModelo(empresas: string): string {
  return `Eso no lo puedo resolver por aquí; yo te ayudo con los documentos de ${n(empresas)}.\nSi necesitas a alguien del equipo, escribe *"quiero hablar con una persona"*.`;
}

/** Una inconformidad que las reglas no ubicaron, sin modelo. */
export function quejaSinModelo(): string {
  return 'Entiendo, y perdón por el inconveniente.\nSi quieres que lo vea alguien del equipo, escribe *"quiero hablar con una persona"*. Si es un documento, dime cuál y lo busco.';
}
