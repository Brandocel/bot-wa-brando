import type { DeliveryMode, EtapaCliente } from '@prisma/client';
import type { Renglon } from './pedido';

/**
 * Lo que se aprende de un cliente, calculado de sus pedidos.
 *
 * Funciones puras: entran pedidos, sale el perfil. Así se puede recalcular
 * entero cada vez (sin contadores que se desvíen) y probar sin base. Nada
 * de aquí sale del modelo: son hechos de lo que pidió.
 */

/** Un pedido que el cliente sí mandó (confirmado, aceptado o entregado). */
export interface PedidoHistorico {
  items: Renglon[];
  deliveryMode: DeliveryMode | null;
  zone: string | null;
  address: string | null;
  customerName: string | null;
  totalCents: number;
  /** Cuándo lo mandó. */
  at: Date;
}

export interface PreferenciaCalculada {
  producto: string;
  productId: string | null;
  /** En cuántos pedidos aparece. */
  veces: number;
  /** Piezas en total. */
  unidades: number;
  notas: string[];
  ultimaVez: Date;
}

export interface PerfilCalculado {
  etapa: EtapaCliente;
  nombre: string | null;
  pedidos: number;
  gastoCents: number;
  ticketPromedioCents: number;
  ultimoPedidoAt: Date | null;
  frecuenciaDias: number | null;
  entregaPreferida: DeliveryMode | null;
  zonaPreferida: string | null;
  direccionHabitual: string | null;
  horaHabitual: number | null;
  diasHabituales: string[];
  preferencias: PreferenciaCalculada[];
}

const DIA_DESDE_INGLES: Record<string, string> = {
  Mon: 'lun', Tue: 'mar', Wed: 'mie', Thu: 'jue', Fri: 'vie', Sat: 'sab', Sun: 'dom',
};
const DIA_ORDEN = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const DIA_NOMBRE: Record<string, string> = {
  lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado', dom: 'domingo',
};

const DIA_MS = 24 * 60 * 60 * 1000;

export function calcularPerfil(
  historial: readonly PedidoHistorico[],
  opciones: { ahora: Date; timezone: string; armoAlgo: boolean },
): PerfilCalculado {
  const pedidos = [...historial].sort((a, b) => a.at.getTime() - b.at.getTime());
  const n = pedidos.length;
  const gasto = pedidos.reduce((s, p) => s + p.totalCents, 0);
  const ultimo = pedidos[n - 1] ?? null;

  // Días promedio entre pedidos: con uno solo no hay ritmo que medir.
  const frecuencia =
    n >= 2 ? Math.max(1, Math.round((ultimo!.at.getTime() - pedidos[0]!.at.getTime()) / DIA_MS / (n - 1))) : null;

  return {
    etapa: etapaDe(n, ultimo?.at ?? null, frecuencia, opciones.ahora, opciones.armoAlgo),
    nombre: [...pedidos].reverse().find((p) => p.customerName)?.customerName ?? null,
    pedidos: n,
    gastoCents: gasto,
    ticketPromedioCents: n ? Math.round(gasto / n) : 0,
    ultimoPedidoAt: ultimo?.at ?? null,
    frecuenciaDias: frecuencia,
    entregaPreferida: moda(pedidos.map((p) => p.deliveryMode)),
    zonaPreferida: moda(pedidos.map((p) => p.zone)),
    direccionHabitual: moda(pedidos.filter((p) => p.deliveryMode === 'DOMICILIO').map((p) => p.address)),
    horaHabitual: n >= 2 ? moda(pedidos.map((p) => horaLocal(p.at, opciones.timezone))) : null,
    // Un día cuenta como habitual si cayó ahí al menos un tercio de las veces.
    diasHabituales: n >= 2 ? diasFrecuentes(pedidos.map((p) => diaLocal(p.at, opciones.timezone)), n) : [],
    preferencias: preferenciasDe(pedidos),
  };
}

function etapaDe(
  n: number,
  ultimo: Date | null,
  frecuencia: number | null,
  ahora: Date,
  armoAlgo: boolean,
): EtapaCliente {
  if (n === 0) return armoAlgo ? 'PROSPECTO' : 'NUEVO';
  const dias = (ahora.getTime() - ultimo!.getTime()) / DIA_MS;
  if (dias > 90) return 'PERDIDO';
  // En riesgo: ya tardó el doble de lo que suele (y al menos un mes).
  if (frecuencia !== null && dias > Math.max(30, frecuencia * 2)) return 'EN_RIESGO';
  return n >= 2 ? 'RECURRENTE' : 'COMPRADOR';
}

function preferenciasDe(pedidos: readonly PedidoHistorico[]): PreferenciaCalculada[] {
  const porProducto = new Map<string, PreferenciaCalculada>();
  for (const p of pedidos) {
    const enEste = new Set<string>();
    for (const r of p.items) {
      const clave = r.nombre.trim();
      if (!clave) continue;
      const pref = porProducto.get(clave) ?? {
        producto: clave, productId: r.productId ?? null, veces: 0, unidades: 0, notas: [], ultimaVez: p.at,
      };
      if (!enEste.has(clave)) pref.veces += 1;
      enEste.add(clave);
      pref.unidades += Math.max(1, r.cantidad);
      pref.productId = r.productId ?? pref.productId;
      if (p.at > pref.ultimaVez) pref.ultimaVez = p.at;
      const nota = r.nota?.trim();
      if (nota && !pref.notas.some((x) => x.toLowerCase() === nota.toLowerCase())) pref.notas.push(nota);
      porProducto.set(clave, pref);
    }
  }
  return [...porProducto.values()].sort((a, b) => b.veces - a.veces || b.unidades - a.unidades);
}

/** El valor más repetido (null si no hay ninguno). Empate: el más reciente. */
function moda<T>(valores: ReadonlyArray<T | null>): T | null {
  const cuenta = new Map<T, number>();
  let mejor: T | null = null;
  let max = 0;
  for (const v of valores) {
    if (v === null || v === undefined || v === '') continue;
    const c = (cuenta.get(v) ?? 0) + 1;
    cuenta.set(v, c);
    if (c >= max) {
      max = c;
      mejor = v;
    }
  }
  return mejor;
}

function diasFrecuentes(dias: readonly string[], n: number): string[] {
  const cuenta = new Map<string, number>();
  for (const d of dias) cuenta.set(d, (cuenta.get(d) ?? 0) + 1);
  return DIA_ORDEN.filter((d) => (cuenta.get(d) ?? 0) * 3 >= n && (cuenta.get(d) ?? 0) >= 2);
}

function horaLocal(d: Date, timezone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(d);
  return Number(h) % 24;
}

function diaLocal(d: Date, timezone: string): string {
  const w = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(d);
  return DIA_DESDE_INGLES[w] ?? 'lun';
}

// ── Recomendación ────────────────────────────────────────────────────────

export interface ContextoRecomendacion {
  perfil: Pick<PerfilCalculado, 'etapa' | 'pedidos' | 'ultimoPedidoAt' | 'entregaPreferida' | 'zonaPreferida' |
    'horaHabitual' | 'diasHabituales' | 'nombre' | 'frecuenciaDias'>;
  preferencias: readonly PreferenciaCalculada[];
  /** Lo más pedido en la empresa por todos (para quien no tiene historial). */
  populares: readonly { producto: string; veces: number }[];
  /** Lo que otros piden junto con su favorito. */
  acompanantes: readonly { producto: string; veces: number }[];
  /** Nombres de la carta vigente: solo se recomienda lo que hoy se vende. */
  enCarta: ReadonlySet<string>;
  ahora: Date;
}

/**
 * El bloque CLIENTE para el modelo de venta. Arranque en frío: sin
 * historial propio usa lo más pedido de la empresa; sin pedidos en la
 * empresa, no recomienda nada (la carta y el pitch de la empresa mandan).
 */
export function clienteParaModelo(c: ContextoRecomendacion): string {
  const p = c.perfil;
  const lineas: string[] = [];

  if (p.pedidos === 0) {
    lineas.push(`CLIENTE: ${p.etapa === 'PROSPECTO' ? 'ya había preguntado antes, nunca ha pedido' : 'primera vez'}.`);
    const top = c.populares.filter((x) => c.enCarta.has(x.producto)).slice(0, 3);
    if (top.length) {
      lineas.push(`LO MÁS PEDIDO AQUÍ (para recomendar si no sabe qué pedir): ${top.map((x) => x.producto).join(', ')}.`);
    }
    return lineas.join('\n');
  }

  const hace = p.ultimoPedidoAt ? Math.round((c.ahora.getTime() - p.ultimoPedidoAt.getTime()) / DIA_MS) : null;
  lineas.push(
    `CLIENTE: ${etiqueta(p.etapa)}${p.nombre ? `, se llama ${p.nombre}` : ''}; ${p.pedidos} pedido${p.pedidos === 1 ? '' : 's'}` +
      (hace !== null ? `, el último hace ${hace === 0 ? 'menos de un día' : `${hace} día${hace === 1 ? '' : 's'}`}` : '') + '.',
  );

  const favoritos = c.preferencias.filter((x) => c.enCarta.has(x.producto)).slice(0, 3);
  if (favoritos.length) {
    lineas.push(
      'LO QUE SUELE PEDIR: ' +
        favoritos
          .map((f) => {
            const porVez = Math.max(1, Math.round(f.unidades / f.veces));
            return `${porVez} × ${f.producto} (${f.veces} de ${p.pedidos} veces${f.notas.length ? `; ${f.notas.join(', ')}` : ''})`;
          })
          .join('; ') + '.',
    );
  }
  const habitos = [
    p.entregaPreferida ? `entrega ${p.entregaPreferida.toLowerCase()}${p.zonaPreferida ? ` en ${p.zonaPreferida}` : ''}` : '',
    p.diasHabituales.length ? `pide en ${p.diasHabituales.map((d) => DIA_NOMBRE[d]).join(' y ')}` : '',
    p.horaHabitual !== null ? `como a las ${p.horaHabitual}:00` : '',
  ].filter(Boolean);
  if (habitos.length) lineas.push(`HÁBITOS: ${habitos.join(', ')}.`);

  const otros = c.acompanantes
    .filter((x) => c.enCarta.has(x.producto) && !favoritos.some((f) => f.producto === x.producto))
    .slice(0, 2);
  if (otros.length) lineas.push(`OTROS CLIENTES LO ACOMPAÑAN CON: ${otros.map((x) => x.producto).join(', ')}.`);

  return lineas.join('\n');
}

function etiqueta(e: EtapaCliente): string {
  return {
    NUEVO: 'nuevo',
    PROSPECTO: 'prospecto',
    COMPRADOR: 'ya compró una vez',
    RECURRENTE: 'cliente frecuente',
    EN_RIESGO: 'cliente que dejó de pedir hace rato',
    PERDIDO: 'cliente que no pide desde hace meses',
  }[e];
}
