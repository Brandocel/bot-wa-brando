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

/** La frase de siempre para pedir un dato que identifique el documento. */
function comoUbicarla(): string {
  return una([
    'Si tienes el *folio* o el *nombre del archivo*, mándamelo y con eso la ubico.',
    'Para dar con ella necesito un dato más: el *folio*, el *nombre del archivo* o el *mes exacto*.',
  ]);
}

// ── Saludos y cortesía ─────────────────────────────────────────────────

export function saludoInicial(empresa: string | null, nombre: string | null = null): string {
  // Por su nombre, si WhatsApp trae uno que parezca nombre. Es la diferencia
  // entre "¡Hola!" de contestador y "¡Hola, Mariana!" de alguien del equipo.
  const hola = nombre ? `¡Hola, ${nombre}!` : '¡Hola!';
  return empresa
    ? una([
        `${hola} Qué gusto saludarte.\nDime qué documento necesitas de ${n(empresa)} y te lo busco enseguida.`,
        `${hola} Aquí ando para lo que necesites de ${n(empresa)}.\n¿Qué documento te busco?`,
        `${hola} Cuéntame qué documento de ${n(empresa)} necesitas y en un momento te lo mando.`,
      ])
    : una([
        `${hola} Qué gusto saludarte.\nDime qué documento necesitas y de qué empresa, y te lo busco.`,
        `${hola} Aquí ando.\n¿Qué documento te busco y de qué empresa?`,
      ]);
}

/**
 * El nombre de pila con el que saludar, o null si lo que trae WhatsApp no
 * parece un nombre ("BM", "🌸🌸", un número, una empresa entera).
 */
export function nombreDePila(pushName: string | null | undefined): string | null {
  if (!pushName) return null;
  const primera = pushName.trim().split(/\s+/)[0] ?? '';
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,16}$/.test(primera)) return null;
  return primera.charAt(0).toUpperCase() + primera.slice(1).toLowerCase();
}

export function saludoDeNuevo(): string {
  return una([
    'Aquí ando. ¿Qué documento te busco?',
    'Qué gusto saludarte otra vez. ¿Qué necesitas?',
    'Aquí sigo. Dime qué documento necesitas.',
  ]);
}

export function saludoConPendiente(pregunta: string): string {
  return una([
    `Aquí sigo. ${pregunta}`,
    `Qué bueno que volviste. ${pregunta}`,
  ]);
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
    `Va. ¿De qué *mes* necesitas la ${tipo}?`,
    `Claro. ¿La ${tipo} de qué *mes*?`,
    `Perfecto. Dime de qué *mes* es la ${tipo} y te la busco.`,
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

export function entrega(que: string, esOtraMas: boolean): string {
  return esOtraMas
    ? una([
        `Aquí va también ${n(que)}.`,
        `Listo, te mando también ${n(que)}.`,
        `Va ${n(que)} también. Cualquier cosa, me dices.`,
      ])
    : una([
        `Listo, aquí tienes ${n(que)}.\nSi necesitas algo más, aquí ando.`,
        `Aquí está ${n(que)}.\nCualquier otra cosa, me dices.`,
        `Te mando ${n(que)}.\nAvísame si necesitas otro.`,
      ]);
}

export function reenvio(nombre: string): string {
  return una([
    `Perdón, te lo mando otra vez: ${n(nombre)}.`,
    `Va de nuevo: ${n(nombre)}.\nAvísame si ahora sí lo ves.`,
  ]);
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
    `${mayuscula(pedido)} no la veo. Lo más cercano que tengo es esto:`,
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
    `${mayuscula(pedido)} tal cual no la veo. Mira si es alguno de estos:`,
  ]);
}

export function muchosSinMes(cuantos: number, tipoPlural: string, mes: string): string {
  return una([
    `Tengo ${n(String(cuantos))} ${tipoPlural}, pero ninguna de ${n(mes)}.\n${comoUbicarla()}`,
    `De ${n(mes)} no veo ${tipoPlural}; tengo ${n(String(cuantos))} de otros meses.\n${comoUbicarla()}`,
  ]);
}

export function faltaInformacion(pedido: string): string {
  return una([
    `Con eso no me alcanza para ubicar ${pedido}.\n${comoUbicarla()}`,
    `${mayuscula(pedido)} así no la encuentro.\n${comoUbicarla()}`,
  ]);
}

export function sinInformacionEscalado(pedido: string, folio: string, agente: Agente | null): string {
  const cabeza = `Con lo que tengo no logro ubicar ${pedido}.`;
  return agente
    ? `${cabeza}\nSe lo pasé a ${n(agente.name)} con el folio ${n(folio)}; te escribe por aquí para revisarlo contigo.`
    : `${cabeza}\nQuedó con el folio ${n(folio)} para que alguien del equipo lo revise contigo.`;
}

export function rechazoPideDetalle(pedido: string): string {
  return una([
    `Entendido, no es ninguna de esas.\nPara dar con ${pedido} correcta necesito un dato más: el *folio*, el *nombre del archivo* o el *mes exacto*.`,
    `Va, esas no.\n¿Tienes el *folio* o el *nombre del archivo* de ${pedido}? Con eso la ubico sin adivinar.`,
  ]);
}

export function mesesDisponibles(tipoPlural: string, meses: readonly string[]): string {
  const lista = meses.map((m) => `• ${m}`).join('\n');
  return una([
    `De ${tipoPlural} tengo de estos meses:\n${lista}\n¿Cuál te mando?`,
    `Hay ${tipoPlural} de:\n${lista}\nDime el *mes* y te la busco.`,
  ]);
}

// ── Leer antes de mandar ───────────────────────────────────────────────

/** Solo hay un candidato y es de otro mes: se ofrece, no se manda. */
export function unicaDeOtroMes(pedido: string, nombre: string, mes: string): string {
  return una([
    `${mayuscula(pedido)} como tal no la tengo.\nLa única que veo es ${n(nombre)}, y esa es de ${n(mes)}.\n¿Te la mando, o buscamos otra?`,
    `De ese mes no tengo nada. Lo más cercano es ${n(nombre)}, que es de ${n(mes)}.\nSi te sirve, dime *sí* y te la paso.`,
  ]);
}

/** Solo hay un candidato y no se sabe de qué mes es: se dice tal cual. */
export function unicaSinMes(pedido: string, nombre: string): string {
  return una([
    `Tengo ${n(nombre)}, pero no trae mes ni en el nombre ni por dentro.\nNo te puedo asegurar que sea ${pedido}. ¿Te la mando para que la revises?`,
    `Lo único parecido es ${n(nombre)}. No dice de qué mes es, así que no sé si es ${pedido}.\nSi quieres, te la paso y la revisas.`,
  ]);
}

/** La búsqueda cayó en lo mismo que se acaba de mandar. */
export function esLaMisma(nombre: string): string {
  return una([
    `Esa es la que te acabo de mandar: ${n(nombre)}.\n¿Buscas otra distinta? Si me das el *folio* o el *mes exacto*, la ubico.`,
    `Es la misma de arriba: ${n(nombre)}.\nSi era esa, ya la tienes. Si necesitas otra, dime el *folio* o el *nombre* y la busco.`,
  ]);
}

/** Rechazó lo único que había: se dice así en vez de "no encontré". */
export function soloTeniaEsa(pedido: string, cuantas: number): string {
  return cuantas > 1
    ? una([
        `Fuera de las que ya viste, no tengo otra que sea ${pedido}.\n${comoUbicarla()} Si no aparece, lo reviso con el equipo.`,
        `Ya te enseñé lo que tengo de eso y no hay más.\n${comoUbicarla()} Si no, lo paso con alguien del equipo.`,
      ])
    : una([
        `Entonces solo tenía esa.\n¿Tienes el *folio* o el *nombre del archivo* de ${pedido}? Con eso la busco; si no está, lo veo con el equipo.`,
        `Va, esa no. Para ${pedido} no veo otra.\n${comoUbicarla()} Si no aparece, lo reviso con el equipo.`,
      ]);
}

// ── Explicar de dónde salió un dato ────────────────────────────────────

export function mesPorNombre(nombre: string, mes: string): string {
  return una([
    `Es de ${n(mes)}. Lo dice el nombre del archivo: ${n(nombre)}.\nSi tú sabes que es de otro mes, dime cuál y busco la correcta.`,
    `Por el nombre del archivo, ${n(nombre)}, es de ${n(mes)}.\nSi no cuadra, dime de qué mes debería ser y la busco.`,
  ]);
}

export function mesPorContenido(nombre: string, mes: string): string {
  return una([
    `Es de ${n(mes)}. Lo leí del propio documento: ${n(nombre)} trae esa fecha por dentro.\nSi tú sabes que es de otro mes, dime cuál y busco la correcta.`,
    `Por lo que dice adentro, ${n(nombre)} está fechado en ${n(mes)}.\nSi no es lo que esperabas, dime el mes y la busco.`,
  ]);
}

export function mesDesconocido(nombre: string, tipo: string): string {
  return una([
    `La verdad, no lo sé con certeza.\n${n(nombre)} no trae mes ni en el nombre ni por dentro, y es la única ${tipo} que tengo.\nSi me dices de qué mes debería ser, busco otra o lo reviso con el equipo.`,
    `No te lo puedo asegurar.\n${n(nombre)} no dice de qué mes es, y es lo único que hay de ese tipo.\nDime el mes que necesitas y lo reviso, o lo paso con alguien del equipo.`,
  ]);
}

export function mesPorContenidoCorrigiendo(nombre: string, mesDentro: string, mesNombre: string): string {
  return una([
    `Es de ${n(mesDentro)}. Así dice la *fecha de emisión* dentro del documento.\nEl nombre del archivo (${n(nombre)}) trae una marca de ${mesNombre}, pero esa es la fecha en que se *descargó*, no la del documento.`,
    `Por dentro dice ${n(mesDentro)} (fecha de emisión).\nLo de ${mesNombre} viene del nombre del archivo, que es cuando se bajó del portal. La buena es la de adentro.`,
  ]);
}

export function perdonMesEquivocado(mesDicho: string): string {
  return una([
    `Tienes razón: te la mandé como de ${mesDicho}, y no es así.`,
    `Perdón, la etiqueté mal como de ${mesDicho}.`,
  ]);
}

export function confirmaMes(): string {
  return una(['Sí, tienes razón.', 'Así es.']);
}

export function siHayDeEseMes(tipoPlural: string, mes: string): string {
  return `De ${n(mes)} sí tengo ${tipoPlural}. Dime el *número* y te la mando:`;
}

export function noHayDeEseMes(tipoPlural: string, mes: string): string {
  return una([
    `De ${n(mes)} no veo ${tipoPlural} en la carpeta.\n${comoUbicarla()} Si no, lo reviso con el equipo.`,
    `${mayuscula(tipoPlural)} de ${n(mes)} no hay; puede que todavía no la suban.\nSi me das el *folio* la ubico, o lo reviso con el equipo.`,
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
