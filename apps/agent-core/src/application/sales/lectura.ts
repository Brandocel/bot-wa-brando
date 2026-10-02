import type { Pedido } from './pedido';

/**
 * La lectura de venta de un mensaje: cómo se siente, en qué punto de la
 * compra está y qué tan probable es que termine en un pedido real.
 *
 * La emoción y la etapa las propone el modelo con una escala cerrada. La
 * probabilidad final NO es solo su opinión: se mezcla con hechos que el
 * código sí comprueba (lleva productos, eligió entrega, dio su nombre,
 * está por confirmar). Un "me encanta" con el carrito vacío no vale lo
 * mismo que un pedido armado esperando su sí.
 */

export const EMOCIONES = [
  'entusiasmado', // "¡sí!, justo eso", signos de alegría
  'interesado', // pregunta detalles concretos, sigue la plática
  'curioso', // pregunta general, sin compromiso
  'neutral', // datos sin carga ("a domicilio", "Juan")
  'indeciso', // "no sé", "a ver", duda entre opciones
  'sensible_precio', // pregunta por precio, promos, "está caro"
  'apurado', // "rápido", "ya", "tengo prisa"
  'desconfiado', // duda de calidad, tiempos o del bot
  'frustrado', // algo no le salió, repite, se desespera
  'molesto', // enojo explícito, groserías dirigidas a nosotros
  'desinteresado', // "no gracias", "solo veía", respuestas secas
] as const;
export type Emocion = (typeof EMOCIONES)[number];

/** El recorrido de compra, de saludar a pagar. */
export const ETAPAS = [
  'saludo', // abre la plática, aún no dice qué quiere
  'explorando', // pregunta qué hay, horarios, cómo funciona
  'comparando', // entre opciones o contra otro lugar
  'decidiendo', // ya eligió algo, ajusta cantidades o detalles
  'cerrando', // da entrega, dirección, nombre o dice que sí
  'postventa', // pregunta por un pedido ya hecho
  'no_compra', // no viene a comprar (otra cosa, equivocado, rechazo)
] as const;
export type Etapa = (typeof ETAPAS)[number];

export interface LecturaModelo {
  emocion: Emocion;
  /** 1 apenas se nota, 5 muy marcada. */
  intensidad: number;
  etapa: Etapa;
  /** La opinión del modelo, 0 a 100. */
  probabilidad: number;
  /** Por qué, en pocas palabras: la señal concreta del mensaje. */
  senal: string;
}

export interface Lectura extends LecturaModelo {
  /** La probabilidad final, mezclada con los hechos del pedido. */
  score: number;
}

/** Qué tan avanzado va el pedido, solo con hechos: 0 a 100. */
export function avanceDelPedido(p: Pedido, confirmPending: boolean): number {
  if (confirmPending) return 90;
  if (p.items.length === 0) return 0;
  let n = 40;
  if (p.deliveryMode) n += 20;
  if (p.customerName) n += 10;
  if (p.deliveryMode !== 'DOMICILIO' || p.address) n += 10;
  return n;
}

/**
 * La probabilidad final. 60 % la lectura del mensaje, 40 % el avance real,
 * con topes que no se discuten:
 *  - quien rechaza o no viene a comprar no pasa de 10;
 *  - molesto o frustrado fuerte (4-5) no pasa de 40 aunque lleve carrito;
 *  - un pedido esperando su "sí" no baja de 60 por un mensaje neutro.
 */
export function mezclar(l: LecturaModelo, avance: number, opciones: { cancelo: boolean; enviado: boolean }): number {
  if (opciones.enviado) return 100;
  if (opciones.cancelo || l.etapa === 'no_compra' || l.emocion === 'desinteresado') {
    return Math.min(10, Math.round(l.probabilidad * 0.2));
  }
  let score = Math.round(0.6 * l.probabilidad + 0.4 * avance);
  if ((l.emocion === 'molesto' || l.emocion === 'frustrado') && l.intensidad >= 4) score = Math.min(score, 40);
  if (avance >= 90 && l.emocion !== 'molesto') score = Math.max(score, 60);
  return Math.max(0, Math.min(100, score));
}

/** Lo que devuelva el modelo, en la escala cerrada. Si no se entiende, neutral. */
export function leerLectura(raw: unknown): LecturaModelo {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const emocion = EMOCIONES.includes(r.emocion as Emocion) ? (r.emocion as Emocion) : 'neutral';
  const etapa = ETAPAS.includes(r.etapa as Etapa) ? (r.etapa as Etapa) : 'explorando';
  const num = (v: unknown, min: number, max: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : def;
  return {
    emocion,
    intensidad: num(r.intensidad, 1, 5, 2),
    etapa,
    probabilidad: num(r.probabilidad, 0, 100, 30),
    senal: typeof r.senal === 'string' ? r.senal.slice(0, 160) : '',
  };
}
