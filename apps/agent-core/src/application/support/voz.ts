/**
 * La voz del asistente: todo lo que le dice al cliente, en un solo sitio.
 *
 * Son plantillas, no modelo — cuestan cero — pero con dos cosas que hacen
 * que no suenen a contestador: varias formas de decir lo mismo (se elige
 * una al azar, como haría cualquiera que no repite la frase exacta tres
 * veces en una tarde) y contexto (nombre del documento, mes en palabras,
 * quién atiende, si es la segunda entrega del hilo).
 *
 * Tono: español de México, tuteo, cálido y breve. Como alguien del equipo
 * que conoce a la persona y no tiene prisa por colgar. Sin emojis: en un
 * canal de facturas sobran.
 */

export interface Agente {
  name: string;
}

function una(opciones: readonly string[]): string {
  return opciones[Math.floor(Math.random() * opciones.length)]!;
}

// ── Saludos y cortesía ─────────────────────────────────────────────────

export function saludoInicial(empresa: string | null, nombre: string | null = null): string {
  // Por su nombre, si WhatsApp trae uno que parezca nombre. Es la diferencia
  // entre "¡Hola!" de contestador y "¡Hola, Mariana!" de alguien del equipo.
  const hola = nombre ? `¡Hola, ${nombre}!` : '¡Hola!';
  return empresa
    ? una([
        `${hola} Qué gusto. Dime qué documento necesitas de ${empresa} y te lo busco enseguida.`,
        `${hola} Aquí ando para lo que necesites de ${empresa}. ¿Qué documento te busco?`,
        `${hola} Cuéntame qué documento de ${empresa} necesitas y en un momento te lo mando.`,
      ])
    : una([
        `${hola} Qué gusto. Dime qué documento necesitas y de qué empresa, y te lo busco.`,
        `${hola} Aquí ando. ¿Qué documento te busco y de qué empresa?`,
      ]);
}

/**
 * El nombre de pila con el que saludar, o null si lo que trae WhatsApp no
 * parece un nombre ("BM", "🌸🌸", un número, una empresa entera).
 */
export function nombreDePila(pushName: string | null | undefined): string | null {
  if (!pushName) return null;
  const primera = pushName.trim().split(/s+/)[0] ?? '';
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
    'Con gusto. Cualquier otro documento, aquí estoy.',
    'Para eso estamos. Si necesitas algo más, nomás dime.',
    'De nada. Aquí ando cuando necesites otro.',
  ]);
}

export function archivoNoLeible(): string {
  return una([
    'Recibí tu archivo, pero todavía no sé leerlos. Escríbeme qué documento necesitas y de qué mes y te lo busco.',
    'Me llegó tu archivo, aunque por ahora solo entiendo texto. Dime qué documento necesitas y lo busco.',
  ]);
}

export function charlaSinModelo(empresas: string): string {
  return una([
    `Aquí ando. Puedo buscarte documentos de ${empresas}; dime cuál necesitas y de qué mes.`,
    `Cuenta conmigo para los documentos de ${empresas}. ¿Cuál te busco?`,
  ]);
}

// ── Preguntas ──────────────────────────────────────────────────────────

export function preguntaTipo(): string {
  return una([
    'Claro. ¿Qué documento necesitas? Puedo buscarte facturas, contratos, cotizaciones, reportes o pólizas.',
    'Va. ¿Qué documento te busco? Tengo facturas, contratos, cotizaciones, reportes y pólizas.',
    '¿Qué documento necesitas? Facturas, contratos, cotizaciones, reportes o pólizas: dime cuál.',
  ]);
}

export function preguntaTipoConMes(mes: string): string {
  return una([
    `De ${mes} tengo varios. ¿Qué documento necesitas: factura, contrato, cotización, reporte o póliza?`,
    `Tengo varias cosas de ${mes}. ¿Cuál te busco: factura, contrato, cotización, reporte o póliza?`,
  ]);
}

export function preguntaMes(tipo: string): string {
  return una([
    `Va. ¿De qué mes necesitas la ${tipo}?`,
    `Claro. ¿La ${tipo} de qué mes?`,
    `Perfecto. Dime de qué mes es la ${tipo} y te la busco.`,
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
  periodo: '¿De qué mes lo necesitas?',
  empresa: '¿De qué empresa lo necesitas? Responde con el número de la lista.',
  detalle: '¿Me das el folio, el nombre del archivo o el mes exacto?',
} as const;

// ── Listas ─────────────────────────────────────────────────────────────

export function encabezadoLista(cuantos: number, que: string): string {
  return una([
    `Tengo ${cuantos} ${que}. ¿Cuál te mando?`,
    `Encontré ${cuantos} ${que}. Dime cuál necesitas:`,
    `Hay ${cuantos} ${que}. ¿Cuál te sirve?`,
  ]);
}

export function pieLista(): string {
  return una(['Responde con el número.', 'Con el número me basta.', 'Dime el número y te lo mando.']);
}

export function encabezadoInventarioMes(mes: string, cuantos: number): string {
  return `De ${mes} tengo ${cuantos === 1 ? 'esto' : 'estos ' + cuantos}:`;
}

export function pieInventario(): string {
  return una(['Si quieres alguno, dime el número.', 'Pide el que necesites con el número.']);
}

// ── Entregas ───────────────────────────────────────────────────────────

export function entrega(que: string, esOtraMas: boolean): string {
  return esOtraMas
    ? una([
        `Aquí va también ${que}.`,
        `Listo, te mando también ${que}.`,
        `Va ${que} también. Cualquier cosa me dices.`,
      ])
    : una([
        `Listo, aquí tienes ${que}. Si necesitas algo más, aquí ando.`,
        `Aquí está ${que}. Cualquier otra cosa, me dices.`,
        `Te mando ${que}. Avísame si necesitas otro.`,
      ]);
}

export function reenvio(nombre: string): string {
  return una([
    `Perdón, te lo mando otra vez: ${nombre}.`,
    `Va de nuevo: ${nombre}. Avísame si ahora sí lo ves.`,
  ]);
}

export function entregaFallida(folio: string, agente: Agente | null): string {
  return agente
    ? `Encontré tu documento pero no logré enviártelo por aquí. Ya se lo pasé a ${agente.name} con el folio ${folio} para que te lo haga llegar.`
    : `Encontré tu documento pero no logré enviártelo por aquí. Lo pasé al equipo con el folio ${folio} para que te lo hagan llegar.`;
}

export function reenvioFallido(nombre: string, folio: string): string {
  return `Sigo sin poder enviarte ${nombre} por aquí. Ya lo pasé al equipo con el folio ${folio} para que te lo hagan llegar; una disculpa por la vuelta.`;
}

// ── Cuando no aparece ──────────────────────────────────────────────────

export function noEncontreParecidos(pedido: string): string {
  return una([
    `No encontré ${pedido}, pero tengo esto que se parece:`,
    `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} no lo veo. Lo más cercano que tengo:`,
    `Mmm, ${pedido} no aparece. Mira si alguno de estos te sirve:`,
  ]);
}

export function pieParecidos(): string {
  return una(['¿Te sirve alguno? Dime el número.', 'Si alguno es, respóndeme con el número.']);
}

export function noEncontreListaTodo(pedido: string, empresa: string | null): string {
  return una([
    `No encontré ${pedido}. Lo que tengo${empresa ? ` de ${empresa}` : ''} es esto:`,
    `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} no aparece. Te dejo lo que sí tengo${empresa ? ` de ${empresa}` : ''}:`,
  ]);
}

export function noEncontreInventario(pedido: string, inventario: string): string {
  return una([
    `No encontré ${pedido}. ${inventario} ¿Te sirve alguno?`,
    `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} no lo tengo. ${inventario} Si alguno te sirve, dime cuál.`,
  ]);
}

export function noEncontreEscalado(pedido: string, folio: string, agente: Agente | null): string {
  return agente
    ? una([
        `No encontré ${pedido}. Se lo pasé a ${agente.name} con el folio ${folio}; te escribe por aquí en cuanto lo revise.`,
        `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} no aparece por ningún lado. Ya lo tiene ${agente.name} con el folio ${folio}; te busca por aquí.`,
      ])
    : una([
        `No encontré ${pedido}. Lo dejé anotado con el folio ${folio} para que alguien del equipo lo revise y te escriba.`,
        `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} no aparece. Quedó registrado con el folio ${folio}; alguien del equipo lo revisa y te contacta.`,
      ]);
}

export function sinDocumentosDe(que: string, cuando: string, empresa: string | null, resto: string | null): string {
  const base = `Por ahora no tengo ${que}${cuando}${empresa ? ` de ${empresa}` : ''}.`;
  return resto ? `${base}\n${resto}` : base;
}

export function inventarioGeneral(inventario: string): string {
  return una([
    `${inventario} Dime cuál necesitas y de qué mes.`,
    `${inventario} ¿Cuál te busco?`,
  ]);
}

export function sinNada(empresa: string | null): string {
  return `Todavía no tengo documentos cargados${empresa ? ` de ${empresa}` : ''}. En cuanto haya, por aquí te los busco.`;
}

// ── Pasar a una persona ────────────────────────────────────────────────

export function pasarAHumano(folio: string, agente: Agente | null): string {
  return agente
    ? una([
        `Claro. Te atiende ${agente.name}; ya tiene tu caso con el folio ${folio} y te escribe por aquí.`,
        `Por supuesto. Le paso tu caso a ${agente.name} (folio ${folio}); en un momento te escribe por aquí.`,
      ])
    : una([
        `Claro. Lo dejé anotado con el folio ${folio}; alguien del equipo te contacta por aquí.`,
        `Por supuesto. Quedó registrado con el folio ${folio} y alguien del equipo te escribe por aquí.`,
      ]);
}

export function noTeEntiendo(folio: string, agente: Agente | null): string {
  const cabeza = una([
    'Creo que no te estoy entendiendo bien, y no quiero hacerte dar más vueltas.',
    'Perdón, no logro entender bien qué necesitas y no quiero marearte.',
  ]);
  const cola = agente
    ? `Te atiende ${agente.name}; ya tiene tu caso con el folio ${folio}.`
    : `Ya le pasé tu caso al equipo con el folio ${folio}; alguien te contacta.`;
  return `${cabeza}\n${cola}`;
}

export function yaPregunte(folio: string, agente: Agente | null): string {
  const cabeza = 'Ya te lo había preguntado y sigo sin entenderlo bien; no quiero hacerte repetir.';
  const cola = agente
    ? `Te atiende ${agente.name}; ya tiene tu caso con el folio ${folio}.`
    : `Se lo pasé al equipo con el folio ${folio}.`;
  return `${cabeza}\n${cola}`;
}

export function tocoElTecho(): string {
  return 'Llevamos muchos mensajes seguidos; dame un rato y te sigo atendiendo. Ya quedó marcado para que alguien del equipo lo vea por si es urgente.';
}

// ── Cuando falta información ───────────────────────────────────────────

export function seParecen(pedido: string): string {
  return una([
    `No tengo exactamente ${pedido}, pero estos se le parecen:`,
    `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} tal cual no lo veo; mira si es alguno de estos:`,
  ]);
}

export function muchosSinMes(cuantos: number, tipoPlural: string, mes: string): string {
  return una([
    `Tengo ${cuantos} ${tipoPlural}, pero ninguna de ${mes}. ¿Me das el folio o el nombre del archivo?`,
    `De ${mes} no veo ${tipoPlural}; tengo ${cuantos} de otros meses. Si tienes el folio o el nombre, con eso la ubico.`,
  ]);
}

export function faltaInformacion(pedido: string): string {
  return una([
    `Con eso no me alcanza para ubicar ${pedido}. ¿Tienes el folio, el nombre del archivo o el mes exacto?`,
    `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} así no lo encuentro; necesito un dato más: folio, nombre del archivo o mes.`,
    `Para dar con ${pedido} me falta algo más concreto: el folio, el nombre del archivo o el mes.`,
  ]);
}

export function sinInformacionEscalado(pedido: string, folio: string, agente: Agente | null): string {
  return agente
    ? `Con lo que tengo no logro ubicar ${pedido}. Se lo pasé a ${agente.name} con el folio ${folio}; te escribe por aquí para revisarlo contigo.`
    : `Con lo que tengo no logro ubicar ${pedido}. Quedó con el folio ${folio} para que alguien del equipo lo revise contigo.`;
}

export function rechazoPideDetalle(pedido: string): string {
  return una([
    `Entendido, no es ninguna de esas. Para dar con ${pedido} correcta necesito un dato más: el folio, el nombre del archivo o el mes exacto.`,
    `Va, esas no. ¿Tienes el folio o el nombre del archivo de ${pedido}? Con eso la ubico sin adivinar.`,
    `Perdón por la vuelta. Para ubicar ${pedido} que sí es, dime el folio, el nombre del archivo o el mes exacto.`,
  ]);
}

export function mesesDisponibles(tipoPlural: string, meses: readonly string[]): string {
  return una([
    `De ${tipoPlural} tengo de: ${meses.join(', ')}. ¿Cuál te mando?`,
    `Hay ${tipoPlural} de ${meses.join(', ')}. Dime el mes y te la busco.`,
  ]);
}

// ── Leer antes de mandar ───────────────────────────────────────────────

/** Solo hay un candidato y es de otro mes: se ofrece, no se manda. */
export function unicaDeOtroMes(pedido: string, nombre: string, mes: string): string {
  return una([
    `${pedido.charAt(0).toUpperCase() + pedido.slice(1)} como tal no la tengo. La única que veo es ${nombre}, y esa es de ${mes}. ¿Te la mando o buscamos otra?`,
    `De ese mes no tengo nada; lo más cercano es ${nombre}, que es de ${mes}. Si te sirve, dime "sí" y te la paso.`,
  ]);
}

/** Solo hay un candidato y no se sabe de qué mes es: se dice tal cual. */
export function unicaSinMes(pedido: string, nombre: string): string {
  return una([
    `Tengo ${nombre}, pero no trae mes ni en el nombre ni por dentro, así que no te puedo asegurar que sea ${pedido}. ¿Te la mando para que la revises?`,
    `Lo único parecido es ${nombre}; no dice de qué mes es, así que no sé si es ${pedido}. Si quieres te la paso y la checas.`,
  ]);
}

/** La búsqueda cayó en lo mismo que se acaba de mandar. */
export function esLaMisma(nombre: string): string {
  return una([
    `Esa es la que te acabo de mandar: ${nombre}. ¿Buscas otra distinta? Si me das el folio o el mes exacto, la ubico.`,
    `Es la misma de arriba (${nombre}). Si necesitas otra, dime el folio o el nombre y la busco; si era esa, ya la tienes.`,
  ]);
}

/** Rechazó lo único que había: se dice así en vez de "no encontré". */
export function soloTeniaEsa(pedido: string, cuantas: number): string {
  return cuantas > 1
    ? una([
        `Fuera de las que ya viste, no tengo otra que sea ${pedido}. Si tienes el folio o el nombre del archivo, la busco por ahí; si no, lo reviso con el equipo.`,
        `Ya te enseñé lo que tengo de eso y no hay más. Con un folio o un nombre de archivo lo puedo ubicar; si no, lo paso con alguien del equipo.`,
      ])
    : una([
        `Entonces solo tenía esa. ¿Tienes el folio o el nombre del archivo de ${pedido}? Con eso la busco; si no está, lo veo con el equipo.`,
        `Va, esa no. Para ${pedido} no veo otra; si me pasas el folio o el nombre la busco, y si no aparece lo reviso con el equipo.`,
      ]);
}

// ── Explicar de dónde salió un dato ────────────────────────────────────

export function mesPorNombre(nombre: string, mes: string): string {
  return una([
    `Por el nombre del archivo: ${nombre} trae ${mes}. Si tú sabes que es de otro mes, dime cuál y busco la correcta.`,
    `Lo dice el nombre del archivo (${nombre}): ${mes}. Si no cuadra, dime de qué mes debería ser y la busco.`,
  ]);
}

export function mesPorContenido(nombre: string, mes: string): string {
  return una([
    `Lo leí del documento: ${nombre} trae fecha de ${mes}. Si tú sabes que es de otro mes, dime cuál y busco la correcta.`,
    `Por lo que dice adentro: ${nombre} está fechado en ${mes}. Si no es lo que esperabas, dime el mes y la busco.`,
  ]);
}

export function mesDesconocido(nombre: string, tipo: string): string {
  return una([
    `La verdad, no lo sé con certeza: ${nombre} no trae mes ni en el nombre ni por dentro, y es la única ${tipo} que tengo. Si me dices de qué mes debería ser, busco otra o lo reviso con el equipo.`,
    `No te lo puedo asegurar. ${nombre} no dice de qué mes es, y es lo único que hay de ese tipo. Dime el mes que necesitas y lo checo, o lo paso con alguien del equipo.`,
  ]);
}

export function mesPorContenidoCorrigiendo(nombre: string, mesDentro: string, mesNombre: string): string {
  return una([
    `Es de ${mesDentro}: así dice la fecha de emisión por dentro. El nombre (${nombre}) trae una marca de ${mesNombre}, pero esa es la fecha en que se descargó, no la del documento.`,
    `Por dentro dice ${mesDentro} (fecha de emisión). Lo de ${mesNombre} viene del nombre del archivo, que es cuando se bajó del portal; la buena es la de adentro.`,
  ]);
}

export function perdonMesEquivocado(mesDicho: string): string {
  return una([
    `Tienes razón, te la mandé como de ${mesDicho} y no es así.`,
    `Perdón, la etiqueté mal como de ${mesDicho}.`,
  ]);
}

export function confirmaMes(mes: string): string {
  return una([`Sí, es de ${mes}.`, `Correcto, ${mes}.`]);
}

export function siHayDeEseMes(tipoPlural: string, mes: string): string {
  return `De ${mes} sí tengo ${tipoPlural}; dime el número y te la mando:`;
}

export function noHayDeEseMes(tipoPlural: string, mes: string): string {
  return una([
    `De ${mes} no veo ${tipoPlural} en la carpeta. Si tienes el folio o el nombre la busco; si no, lo reviso con el equipo.`,
    `${tipoPlural.charAt(0).toUpperCase() + tipoPlural.slice(1)} de ${mes} no hay; a lo mejor todavía no la suben. Si me das el folio la ubico, o lo checo con el equipo.`,
  ]);
}
