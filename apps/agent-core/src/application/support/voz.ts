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

export function saludoInicial(empresa: string | null): string {
  return empresa
    ? una([
        `¡Hola! Qué gusto. Dime qué documento necesitas de ${empresa} y te lo busco enseguida.`,
        `¡Hola! Aquí ando para lo que necesites de ${empresa}. ¿Qué documento te busco?`,
        `¡Hola! Cuéntame qué documento de ${empresa} necesitas y en un momento te lo mando.`,
      ])
    : una([
        '¡Hola! Qué gusto. Dime qué documento necesitas y de qué empresa, y te lo busco.',
        '¡Hola! Aquí ando. ¿Qué documento te busco y de qué empresa?',
      ]);
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
