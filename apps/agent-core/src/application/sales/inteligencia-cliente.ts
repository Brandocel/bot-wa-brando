import type { EtapaCliente } from '@prisma/client';
import type { Emocion } from './lectura';

/**
 * La capa que aprende de cada cliente, por encima de su historial:
 *
 *  1. Sentimiento: cómo se ha sentido en sus pláticas y hacia dónde va.
 *  2. Clasificación: un puntaje 0-100 y un segmento, con RFM (recencia,
 *     frecuencia, monto) para quien ya compró y la probabilidad de compra
 *     para quien todavía no.
 *  3. Postventa: la siguiente acción que conviene y cuándo.
 *  4. Estrategia: cómo atenderlo en la venta según todo lo anterior.
 *
 * Todo puro y determinista: entran hechos, salen etiquetas. El modelo solo
 * aporta la emoción de cada mensaje (con escala cerrada, ver lectura.ts).
 */

const DIA_MS = 24 * 60 * 60 * 1000;

// ── 1. Sentimiento ───────────────────────────────────────────────────────

/** Qué tan buena es cada emoción para la relación, de -1 a 1. */
const VALENCIA: Record<Emocion, number> = {
  entusiasmado: 1,
  interesado: 0.6,
  curioso: 0.3,
  neutral: 0,
  apurado: -0.1,
  indeciso: -0.1,
  sensible_precio: -0.2,
  desconfiado: -0.5,
  desinteresado: -0.6,
  frustrado: -0.7,
  molesto: -1,
};

export interface LecturaMensaje {
  emocion: string;
  /** 1 a 3. */
  intensidad: number | null;
  at: Date;
}

export interface Sentimiento {
  /** -100 a 100. */
  valor: number;
  tendencia: 'mejora' | 'estable' | 'empeora';
  dominante: string;
}

/**
 * Promedio ponderado por intensidad, con más peso a lo reciente: lo que
 * sintió ayer cuenta más que lo de hace tres meses. La tendencia compara
 * sus últimos mensajes contra los de antes.
 */
export function leerSentimiento(lecturas: readonly LecturaMensaje[]): Sentimiento | null {
  const validas = lecturas
    .filter((l) => l.emocion in VALENCIA)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (validas.length === 0) return null;

  const valor = (xs: readonly LecturaMensaje[]) => {
    let suma = 0;
    let pesos = 0;
    xs.forEach((l, i) => {
      const peso = Math.max(1, l.intensidad ?? 1) * (1 + i / xs.length);
      suma += VALENCIA[l.emocion as Emocion] * peso;
      pesos += peso;
    });
    return pesos ? suma / pesos : 0;
  };

  const total = valor(validas);
  const corte = Math.max(1, Math.floor(validas.length / 2));
  const antes = validas.length >= 6 ? valor(validas.slice(0, corte)) : null;
  const ahora = validas.length >= 6 ? valor(validas.slice(corte)) : null;
  const delta = antes !== null && ahora !== null ? ahora - antes : 0;

  const cuenta = new Map<string, number>();
  for (const l of validas) cuenta.set(l.emocion, (cuenta.get(l.emocion) ?? 0) + 1);
  const dominante = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  return {
    valor: Math.round(total * 100),
    tendencia: delta > 0.25 ? 'mejora' : delta < -0.25 ? 'empeora' : 'estable',
    dominante,
  };
}

// ── 2. Clasificación ─────────────────────────────────────────────────────

export type Segmento =
  | 'NUEVO' // escribió, nada más
  | 'PROSPECTO_CALIENTE' // no ha comprado, pero está a nada
  | 'PROSPECTO' // pregunta, arma, no cierra
  | 'PROSPECTO_FRIO' // se enfrió sin comprar
  | 'PRIMERA_COMPRA' // acaba de comprar por primera vez: momento de fidelizar
  | 'VIP' // compra seguido, reciente y de buen monto
  | 'LEAL' // compra seguido
  | 'PROMETEDOR' // reciente, pocas compras: puede volverse leal
  | 'OCASIONAL' // compra de vez en cuando
  | 'EN_RIESGO' // era bueno y se está enfriando
  | 'HIBERNANDO' // hace mucho que no compra
  | 'PERDIDO' // más de 90 días
  | 'NECESITA_ATENCION'; // viene molesto o tuvo un reclamo

export interface EntradaClasificacion {
  etapa: EtapaCliente;
  pedidos: number;
  ultimoPedidoAt: Date | null;
  ticketPromedioCents: number;
  /** Ticket típico de la empresa (mediana); null en frío. */
  ticketEmpresaCents: number | null;
  /** Probabilidad de compra de su última plática (0-100). */
  ultimoScore: number | null;
  sentimiento: Sentimiento | null;
  /** Reclamó en los últimos 30 días. */
  reclamoReciente: boolean;
  ahora: Date;
}

export interface Clasificacion {
  puntaje: number;
  segmento: Segmento;
  rfm: string | null;
}

export function clasificar(e: EntradaClasificacion): Clasificacion {
  const clima = e.sentimiento?.valor ?? 0;

  if (e.pedidos === 0 || !e.ultimoPedidoAt) {
    const score = e.ultimoScore ?? 0;
    const puntaje = limitar(Math.round(score * 0.8 + Math.max(0, clima) * 0.2));
    const segmento: Segmento =
      e.reclamoReciente || clima <= -40 ? 'NECESITA_ATENCION'
        : e.etapa === 'NUEVO' && score < 30 ? 'NUEVO'
          : score >= 60 ? 'PROSPECTO_CALIENTE'
            : score < 25 ? 'PROSPECTO_FRIO'
              : 'PROSPECTO';
    return { puntaje, segmento, rfm: null };
  }

  const dias = (e.ahora.getTime() - e.ultimoPedidoAt.getTime()) / DIA_MS;
  const r = dias <= 7 ? 5 : dias <= 14 ? 4 : dias <= 30 ? 3 : dias <= 60 ? 2 : 1;
  const f = e.pedidos >= 10 ? 5 : e.pedidos >= 5 ? 4 : e.pedidos >= 3 ? 3 : e.pedidos === 2 ? 2 : 1;
  const razon = e.ticketEmpresaCents ? e.ticketPromedioCents / e.ticketEmpresaCents : 1;
  const m = razon >= 2 ? 5 : razon >= 1.25 ? 4 : razon >= 0.8 ? 3 : razon >= 0.5 ? 2 : 1;

  const puntaje = limitar(Math.round(((r * 0.35 + f * 0.35 + m * 0.3) / 5) * 85 + ((clima + 100) / 200) * 15));

  const segmento: Segmento =
    e.reclamoReciente || clima <= -40 ? 'NECESITA_ATENCION'
      : dias > 90 ? 'PERDIDO'
        : r >= 4 && f >= 4 && m >= 4 ? 'VIP'
          : f >= 3 && r >= 3 ? 'LEAL'
            : e.pedidos === 1 && r >= 4 ? 'PRIMERA_COMPRA'
              : f >= 3 && r <= 2 ? 'EN_RIESGO'
                : r === 1 ? 'HIBERNANDO'
                  : r >= 3 ? 'PROMETEDOR'
                    : 'OCASIONAL';

  return { puntaje, segmento, rfm: `R${r}F${f}M${m}` };
}

function limitar(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// ── 3. Postventa: la siguiente acción ────────────────────────────────────

export interface EntradaAccion {
  segmento: Segmento;
  pedidos: number;
  ultimoPedidoAt: Date | null;
  frecuenciaDias: number | null;
  /** Su favorito, para ofrecerlo por nombre. */
  favorito: string | null;
  /** El último evento de pedido y cuándo pasó. */
  ultimoEvento: { tipo: string; at: Date; numero?: number } | null;
  ahora: Date;
}

/**
 * Lo que conviene hacer después, con fecha. Es una sugerencia para el
 * equipo (y para el bot cuando el cliente escriba): nada se manda solo.
 */
export function proximaAccion(e: EntradaAccion): { texto: string; at: Date } | null {
  const ev = e.ultimoEvento;
  const horas = (n: number, desde = e.ahora) => new Date(desde.getTime() + n * 3600 * 1000);

  if (e.segmento === 'NECESITA_ATENCION') {
    return { texto: 'Atender en persona: tuvo un reclamo o viene molesto', at: e.ahora };
  }
  if (ev?.tipo === 'pedido_entregado' && e.ahora.getTime() - ev.at.getTime() < 3 * DIA_MS) {
    return { texto: `Preguntar cómo le fue con ${ev.numero ? `P-${ev.numero}` : 'su pedido'}`, at: horas(2, ev.at) };
  }
  if ((ev?.tipo === 'pedido_armando' || ev?.tipo === 'pedido_cancelado') && e.pedidos === 0) {
    return { texto: 'Retomar el pedido que dejó a medias', at: horas(2, ev.at) };
  }
  if (ev?.tipo === 'pedido_rechazado') {
    return { texto: 'Ofrecer una alternativa al pedido rechazado', at: horas(1, ev.at) };
  }
  if (e.ultimoPedidoAt && e.frecuenciaDias) {
    const tocaba = new Date(e.ultimoPedidoAt.getTime() + e.frecuenciaDias * DIA_MS);
    if (e.segmento === 'EN_RIESGO' || e.segmento === 'HIBERNANDO') {
      return { texto: `Reactivar${e.favorito ? ` con su favorito: ${e.favorito}` : ''}`, at: e.ahora };
    }
    return { texto: `Le toca volver a pedir${e.favorito ? `: ofrecer ${e.favorito}` : ''}`, at: tocaba };
  }
  if (e.segmento === 'PRIMERA_COMPRA' && e.ultimoPedidoAt) {
    return { texto: 'Invitar a su segunda compra', at: new Date(e.ultimoPedidoAt.getTime() + 7 * DIA_MS) };
  }
  if (e.segmento === 'PROSPECTO_CALIENTE') return { texto: 'Cerrar: estuvo cerca de comprar', at: e.ahora };
  return null;
}

// ── 4. Estrategia de atención ────────────────────────────────────────────

const TRATO: Record<Segmento, string> = {
  NUEVO: 'primera plática: preséntate breve, entiende qué busca y recomienda lo más pedido.',
  PROSPECTO_CALIENTE: 'está a nada de comprar: resuelve su última duda y ayúdale a cerrar sin presión.',
  PROSPECTO: 'ya preguntó antes sin comprar: retoma lo que le interesaba y facilita el primer pedido.',
  PROSPECTO_FRIO: 'se enfrió: sé breve, una sola sugerencia concreta, sin insistir.',
  PRIMERA_COMPRA: 'acaba de comprar por primera vez: agradécelo y haz que repetir sea fácil.',
  VIP: 'de los mejores clientes: trato preferente y ágil, no le hagas repetir datos que ya conoces.',
  LEAL: 'cliente leal: atiéndelo como alguien de casa, ofrécele lo de siempre.',
  PROMETEDOR: 'va bien: recomiéndale algo nuevo que combine con lo que le gusta.',
  OCASIONAL: 'compra de vez en cuando: recuérdale su favorito y algo de temporada si lo hay.',
  EN_RIESGO: 'antes pedía seguido y se está alejando: dale la bienvenida de vuelta, sin reclamarle.',
  HIBERNANDO: 'hace mucho que no pide: salúdalo con gusto y ofrécele su favorito.',
  PERDIDO: 'volvió después de meses: bienvenida cálida y cero presión.',
  NECESITA_ATENCION: 'tuvo un problema o viene molesto: primero escucha y resuelve; no vendas de más.',
};

/** Las líneas de estrategia para el modelo de venta. */
export function estrategiaParaModelo(segmento: Segmento, sentimiento: Sentimiento | null): string {
  const lineas = [`CÓMO ATENDERLO: ${TRATO[segmento]}`];
  if (sentimiento) {
    const clima = sentimiento.valor >= 40 ? 'buena onda' : sentimiento.valor <= -30 ? 'tenso' : 'neutral';
    const va = sentimiento.tendencia === 'empeora' ? ', y ha ido empeorando: cuida el tono' : sentimiento.tendencia === 'mejora' ? ', y ha ido mejorando' : '';
    lineas.push(`CLIMA CON ESTE CLIENTE: ${clima} (suele estar ${sentimiento.dominante.replace('_', ' ')})${va}.`);
  }
  return lineas.join('\n');
}
