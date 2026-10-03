import type { DeliveryMode } from '@prisma/client';
import { abiertoEn, desdeLocal, enZona, sumarDias, type Horario } from './horario';

/**
 * El pedido en curso y lo que se le puede hacer.
 *
 * El modelo PROPONE acciones; aquí se aplican solo las que tienen sentido
 * contra el catálogo real. Los precios y los totales salen siempre de aquí:
 * el modelo nunca dice cuánto cuesta algo que no esté en el catálogo, y
 * nunca suma.
 */

export interface Renglon {
  productId: string;
  nombre: string;
  precioCents: number;
  cantidad: number;
  nota: string | null;
}

export interface Pedido {
  items: Renglon[];
  deliveryMode: DeliveryMode | null;
  address: string | null;
  zone: string | null;
  deliveryCents: number;
  customerName: string | null;
  notes: string | null;
  scheduledFor: Date | null;
}

export interface ProductoVenta {
  id: string;
  name: string;
  description: string;
  section: string;
  priceCents: number;
  /** Días en que se vende ("lun".."dom"); vacío = todos. */
  availableDays?: string[];
}

export interface Zona {
  nombre: string;
  costoCents: number;
}

export interface ReglasVenta {
  deliveryModes: DeliveryMode[];
  zonas: Zona[];
  minOrderCents: number;
  horario: Horario;
  timezone: string;
  prepMinutes: number;
}

export type TipoAccion =
  | 'agregar' | 'quitar' | 'cantidad' | 'entrega' | 'programar' | 'nombre' | 'nota' | 'listo' | 'cancelar' | 'persona';

/** Una acción tal como la propone el modelo: campos planos, "" o 0 si no aplican. */
export interface Accion {
  tipo: TipoAccion;
  productoId: string;
  cantidad: number;
  texto: string;
  modo: DeliveryMode | '';
  zona: string;
}

export const MAX_CANTIDAD = 50;
const MAX_RENGLONES = 30;
/**
 * Regla del negocio: se vende para hoy, en el momento. Si el cliente lo pide,
 * se puede programar como máximo para mañana; nunca más lejos.
 */
const MAX_DIAS_PROGRAMA = 1;

/** "sabor a elegir", "pendiente"...: una nota que todavía no dice nada. */
function notaVacia(nota: string | null): boolean {
  return !nota || /elegir|pendiente|por definir|sin definir/i.test(nota);
}

export function pedidoVacio(): Pedido {
  return {
    items: [], deliveryMode: null, address: null, zone: null, deliveryCents: 0,
    customerName: null, notes: null, scheduledFor: null,
  };
}

export function subtotal(p: Pedido): number {
  return p.items.reduce((n, r) => n + r.precioCents * r.cantidad, 0);
}

export function total(p: Pedido): number {
  return subtotal(p) + p.deliveryCents;
}

/** $245 o $245.50: sin centavos cuando no hay. */
export function pesos(cents: number): string {
  const entero = cents % 100 === 0;
  return '$' + (cents / 100).toLocaleString('es-MX', {
    minimumFractionDigits: entero ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export interface Resultado {
  pedido: Pedido;
  /** Cambió lo que lleva (productos, entrega o cuándo): se le enseña. */
  cambio: boolean;
  /** Lo que no se pudo hacer, dicho para el cliente. */
  avisos: string[];
  /**
   * Qué regla frenó algo (zona, fecha, horario, producto). Si hay alguno, el
   * texto que escribió el modelo daba por hecho algo que NO pasó y no se
   * puede mandar tal cual.
   */
  rechazos: Array<'zona' | 'fecha' | 'horario' | 'producto'>;
  listo: boolean;
  cancelar: boolean;
  persona: boolean;
}

/**
 * Aplica las acciones en orden. Las que no casan con el catálogo o con las
 * reglas de la empresa se ignoran y dejan un aviso; nunca revientan.
 */
export function aplicar(
  inicial: Pedido,
  acciones: readonly Accion[],
  catalogo: readonly ProductoVenta[],
  reglas: ReglasVenta,
  ahora: Date,
): Resultado {
  const p: Pedido = { ...inicial, items: inicial.items.map((r) => ({ ...r })) };
  const r: Resultado = { pedido: p, cambio: false, avisos: [], rechazos: [], listo: false, cancelar: false, persona: false };
  const producto = (id: string) => catalogo.find((c) => c.id === id);

  for (const a of acciones) {
    switch (a.tipo) {
      case 'agregar': {
        const prod = producto(a.productoId);
        if (!prod) { r.avisos.push('Eso no lo tenemos en la carta.'); r.rechazos.push('producto'); break; }
        if (!seVendeEl(prod, p.scheduledFor ?? ahora, reglas.timezone)) {
          r.avisos.push(`${prod.name} solo se vende ${diasEnPalabras(prod.availableDays!)}.`);
        }
        const cantidad = Math.min(MAX_CANTIDAD, Math.max(1, Math.trunc(a.cantidad) || 1));
        const nota = a.texto.trim().slice(0, 120) || null;
        const igual = p.items.find((i) => i.productId === prod.id && i.nota === nota);
        // El sabor de algo que ya estaba ("2 pollos, sabor a elegir" y luego
        // "Pastor") es el MISMO renglón, no uno nuevo: sumarlo duplicaba el
        // pedido ($510 + $510 por los mismos dos pollos).
        const porDefinir = !igual && !notaVacia(nota)
          ? p.items.find((i) => i.productId === prod.id && notaVacia(i.nota) && i.cantidad === cantidad)
          : undefined;
        if (porDefinir) porDefinir.nota = nota;
        else if (igual) igual.cantidad = Math.min(MAX_CANTIDAD, igual.cantidad + cantidad);
        else if (p.items.length < MAX_RENGLONES) {
          p.items.push({ productId: prod.id, nombre: prod.name, precioCents: prod.priceCents, cantidad, nota });
        }
        r.cambio = true;
        break;
      }
      case 'quitar': {
        const antes = p.items.length;
        p.items = p.items.filter((i) => i.productId !== a.productoId);
        r.cambio ||= p.items.length !== antes;
        break;
      }
      case 'cantidad': {
        const renglon = p.items.find((i) => i.productId === a.productoId);
        if (!renglon) break;
        const cantidad = Math.trunc(a.cantidad);
        if (cantidad <= 0) p.items = p.items.filter((i) => i !== renglon);
        else renglon.cantidad = Math.min(MAX_CANTIDAD, cantidad);
        r.cambio = true;
        break;
      }
      case 'entrega': {
        if (!a.modo || !reglas.deliveryModes.includes(a.modo)) {
          r.avisos.push('Esa forma de entrega no la manejamos.');
          break;
        }
        if (a.modo === 'DOMICILIO') {
          const zona = reglas.zonas.find((z) => normal(z.nombre) === normal(a.zona));
          // Una zona a la que no se llega NO entra al pedido, ni su dirección:
          // antes se guardaba igual y el bot seguía hasta pedir el nombre
          // "para cerrar" un pedido a Veracruz.
          if (a.zona && reglas.zonas.length > 0 && !zona) {
            r.avisos.push('A esa zona no llegamos a domicilio.');
            r.rechazos.push('zona');
            break;
          }
          p.deliveryMode = a.modo;
          if (a.texto.trim()) p.address = a.texto.trim().slice(0, 300);
          if (zona) { p.zone = zona.nombre; p.deliveryCents = zona.costoCents; }
        } else {
          p.deliveryMode = a.modo;
          if (a.modo === 'PAQUETERIA' && a.texto.trim()) p.address = a.texto.trim().slice(0, 300);
          else p.address = null;
          p.zone = null;
          p.deliveryCents = 0;
        }
        r.cambio = true;
        break;
      }
      case 'programar': {
        if (!a.texto.trim()) { p.scheduledFor = null; r.cambio = true; break; }
        const cuando = desdeLocal(a.texto, reglas.timezone);
        if (!cuando) break;
        if (cuando.getTime() < ahora.getTime() + 10 * 60 * 1000) {
          r.avisos.push('Esa hora ya casi pasó; dime otra.');
          break;
        }
        const limite = sumarDias(enZona(ahora, reglas.timezone).fecha, MAX_DIAS_PROGRAMA);
        if (enZona(cuando, reglas.timezone).fecha > limite) {
          r.avisos.push('Solo podemos programar pedidos para hoy o para mañana.');
          r.rechazos.push('fecha');
          break;
        }
        if (!abiertoEn(reglas.horario, cuando, reglas.timezone)) {
          r.avisos.push('A esa hora estamos cerrados.');
          r.rechazos.push('horario');
          break;
        }
        p.scheduledFor = cuando;
        r.cambio = true;
        break;
      }
      case 'nombre': {
        const nombre = a.texto.trim().slice(0, 80);
        if (nombre) p.customerName = nombre;
        break;
      }
      case 'nota': {
        const nota = a.texto.trim().slice(0, 300);
        if (nota) p.notes = nota;
        break;
      }
      case 'listo': r.listo = true; break;
      case 'cancelar': r.cancelar = true; break;
      case 'persona': r.persona = true; break;
    }
  }

  return r;
}

export type Faltante = 'productos' | 'dia' | 'entrega' | 'direccion' | 'zona' | 'nombre' | 'minimo' | 'horario';

/** Lo que falta para poder mandarlo a la empresa, en orden de prioridad. */
export function faltantes(
  p: Pedido,
  reglas: ReglasVenta,
  ahora: Date,
  catalogo: readonly ProductoVenta[] = [],
): Faltante[] {
  const f: Faltante[] = [];
  if (p.items.length === 0) f.push('productos');
  if (fueraDeDia(p, catalogo, reglas, ahora).length > 0) f.push('dia');
  if (!p.deliveryMode) f.push('entrega');
  if ((p.deliveryMode === 'DOMICILIO' || p.deliveryMode === 'PAQUETERIA') && !p.address) f.push('direccion');
  if (p.deliveryMode === 'DOMICILIO' && reglas.zonas.length > 0 && !p.zone) f.push('zona');
  if (!p.customerName) f.push('nombre');
  if (p.items.length > 0 && subtotal(p) < reglas.minOrderCents) f.push('minimo');
  // Sin hora programada, se prepara ya: tiene que estar abierto.
  if (!p.scheduledFor && !abiertoEn(reglas.horario, ahora, reglas.timezone)) f.push('horario');
  return f;
}

/**
 * Lo que lleva, en renglones para WhatsApp. Precios del catálogo, nunca del modelo.
 *
 * Sin "1 × …": muchos productos ya traen la cantidad en el nombre ("1/2 pollo")
 * y "2 × 1 pollo" se leía como otra cosa. La cantidad va al final y solo si
 * es más de uno.
 */
export function resumen(p: Pedido): string {
  const lineas = p.items.map((r) =>
    `• ${r.nombre}${r.nota ? ` (${r.nota})` : ''}${r.cantidad > 1 ? ` ×${r.cantidad}` : ''} — ${pesos(r.precioCents * r.cantidad)}`);
  if (p.deliveryCents > 0) lineas.push(`• Envío${p.zone ? ` a ${p.zone}` : ''} — ${pesos(p.deliveryCents)}`);
  lineas.push(`*Total: ${pesos(total(p))}*`);
  return lineas.join('\n');
}

/**
 * Montos que el texto del modelo puede mencionar sin inventar: precios del
 * catálogo, costos de envío, el mínimo y lo que el pedido suma.
 */
export function montosPermitidos(p: Pedido, catalogo: readonly ProductoVenta[], reglas: ReglasVenta): Set<number> {
  const ok = new Set<number>();
  for (const c of catalogo) ok.add(c.priceCents);
  for (const z of reglas.zonas) ok.add(z.costoCents);
  ok.add(reglas.minOrderCents);
  ok.add(subtotal(p));
  ok.add(total(p));
  for (const r of p.items) ok.add(r.precioCents * r.cantidad);
  return ok;
}

/** ¿Menciona algún monto que no sale del catálogo ni del pedido? */
export function inventaMontos(texto: string, permitidos: Set<number>): boolean {
  for (const m of texto.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g)) {
    const enteros = Number(m[1]!.replace(/,/g, ''));
    const cents = enteros * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
    if (!permitidos.has(cents)) return true;
  }
  return false;
}

const NOMBRE_DIA: Record<string, string> = {
  lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábados', dom: 'domingos',
};

/** "los miércoles", "los lunes y martes". */
export function diasEnPalabras(dias: readonly string[]): string {
  const nombres = dias.map((d) => NOMBRE_DIA[d] ?? d);
  return 'los ' + (nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0]);
}

export function seVendeEl(prod: ProductoVenta, instante: Date, timezone: string): boolean {
  if (!prod.availableDays?.length) return true;
  return prod.availableDays.includes(enZona(instante, timezone).dia);
}

/** Lo que lleva y no se vende el día en que se prepararía el pedido. */
export function fueraDeDia(
  p: Pedido,
  catalogo: readonly ProductoVenta[],
  reglas: ReglasVenta,
  ahora: Date,
): ProductoVenta[] {
  const cuando = p.scheduledFor ?? ahora;
  return p.items
    .map((i) => catalogo.find((c) => c.id === i.productId))
    .filter((c): c is ProductoVenta => !!c && !seVendeEl(c, cuando, reglas.timezone));
}

function normal(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
