import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DeliveryMode, Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { separarChat } from '../../domain/message/linea';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import { ConversationHistoryService } from '../support/conversation-history.service';
import { TicketService } from '../support/ticket.service';
import type { LecturaVenta, StrategyContext, StrategyReply } from '../support/support.strategy';
import { ESQUEMA_VENTA, SISTEMA_CORRECCION, SISTEMA_VENTA } from './guion-venta';
import {
  abiertoEn,
  cuandoEnPalabras,
  enZona,
  fechaEnPalabras,
  horarioEnPalabras,
  leerHorario,
  siguienteApertura,
} from './horario';
import { leerPresupuesto, montosDePresupuesto, presupuestoParaModelo } from './presupuesto';
import { avanceDelPedido, leerLectura, mezclar, type LecturaModelo } from './lectura';
import {
  aplicar,
  diasEnPalabras,
  faltantes,
  fueraDeDia,
  inventaMontos,
  montosPermitidos,
  pedidoVacio,
  pesos,
  resumen,
  subtotal,
  type Accion,
  type Faltante,
  type Pedido,
  type ProductoVenta,
  type ReglasVenta,
  type Renglon,
} from './pedido';

/** Un pedido a medio armar caduca: después de esto, la plática empieza de cero. */
const VIGENCIA_ARMANDO_MS = 6 * 60 * 60 * 1000;
/** Cuánto atrás se le recuerda al modelo un pedido ya enviado (postventa). */
const VENTANA_POSTVENTA_MS = 24 * 60 * 60 * 1000;
/**
 * Al pasar la plática a una persona, el bot se calla este tiempo (lo mismo que
 * "Atender yo" en el panel). Antes abría el ticket y seguía contestando: el
 * cliente tenía dos voces en el chat y no sabía a quién hacerle caso.
 */
const SILENCIO_ESCALADO_MS = 4 * 60 * 60 * 1000;

const NOMBRE_ENTREGA: Record<DeliveryMode, string> = {
  RECOGER: 'pasar a recoger',
  DOMICILIO: 'a domicilio',
  PAQUETERIA: 'envío por paquetería',
  DIGITAL: 'entrega digital',
};

interface Negocio {
  organizationId: string;
  nombre: string;
  giro: string;
  pitch: string;
  reglas: ReglasVenta;
  catalogo: ProductoVenta[];
}

interface RespuestaModelo {
  respuesta: string;
  acciones: Accion[];
  lectura: LecturaModelo;
}

/**
 * Ventas por la línea de WhatsApp de una empresa.
 *
 * Atiende a quien escribe por esa línea y NO es cliente registrado de la
 * empresa (los registrados siguen con soporte de documentos). El modelo
 * conversa y propone acciones; aquí se validan contra el catálogo, el
 * horario y las reglas de entrega, y se guarda el pedido. El pedido no
 * sale sin el "sí" del cliente al resumen, y la empresa lo acepta en su
 * panel.
 */
@Injectable()
export class SalesStrategy {
  private readonly logger = new Logger(SalesStrategy.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    private readonly history: ConversationHistoryService,
    private readonly tickets: TicketService,
  ) {}

  /** La empresa que vende por la línea de este chat, o null si no vende. */
  async negocioDe(chatId: string): Promise<Negocio | null> {
    const linea = separarChat(chatId).linea;
    if (!linea) return null;

    const org = await this.prisma.organization.findUnique({
      where: { waLineId: linea },
      select: {
        id: true,
        name: true,
        active: true,
        sales: true,
        products: {
          where: { active: true },
          orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
          take: 200,
          select: { id: true, name: true, description: true, section: true, priceCents: true, availableDays: true },
        },
      },
    });
    if (!org?.active || !org.sales?.enabled || org.products.length === 0) return null;

    const s = org.sales;
    return {
      organizationId: org.id,
      nombre: org.name,
      giro: s.businessType,
      pitch: s.pitch,
      catalogo: org.products,
      reglas: {
        deliveryModes: s.deliveryModes,
        zonas: leerZonas(s.zones),
        minOrderCents: s.minOrder * 100,
        horario: leerHorario(s.hours),
        timezone: s.timezone,
        prepMinutes: s.prepMinutes,
      },
    };
  }

  async handle(
    message: IncomingMessage,
    ctx: StrategyContext,
    negocio: Negocio,
  ): Promise<StrategyReply | null> {
    const lectura: { v?: LecturaVenta } = {};
    const reply = await this.atender(message, ctx, negocio, lectura);
    return reply && lectura.v ? { ...reply, lecturaVenta: lectura.v } : reply;
  }

  private async atender(
    message: IncomingMessage,
    ctx: StrategyContext,
    negocio: Negocio,
    lectura: { v?: LecturaVenta },
  ): Promise<StrategyReply | null> {
    const texto = message.body.trim();
    if (texto === '') return null;
    const ahora = new Date();

    const orden = await this.pedidoEnCurso(ctx.conversationId, negocio.organizationId);
    let pedido = orden ? desdeOrden(orden) : pedidoVacio();

    // El resumen ya se le mostró: un "sí" claro lo manda a la empresa.
    if (orden?.confirmPending) {
      if (confirmaPedido(texto)) return this.enviar(orden, pedido, negocio, lectura, ahora);
      await this.prisma.order.update({ where: { id: orden.id }, data: { confirmPending: false } });
    }

    const recientes = await this.prisma.order.findMany({
      where: {
        conversationId: ctx.conversationId,
        status: { in: ['POR_ACEPTAR', 'ACEPTADO', 'RECHAZADO'] },
        submittedAt: { gte: new Date(ahora.getTime() - VENTANA_POSTVENTA_MS) },
      },
      orderBy: { submittedAt: 'desc' },
      take: 3,
      select: { number: true, status: true, etaAt: true, rejectReason: true },
    });

    const turnos = await this.history.recent(ctx.conversationId, { excludeId: message.id });
    // Del más nuevo al más viejo: "tengo 250" de hace tres mensajes sigue valiendo.
    const presupuesto = leerPresupuesto([
      texto,
      ...turnos.filter((t) => t.role === 'cliente').map((t) => t.text).reverse(),
    ]);
    const modelo = await this.llm.extract<RespuestaModelo>({
      tarea: 'conversacion',
      system: SISTEMA_VENTA,
      user: contexto(negocio, pedido, recientes, turnos, texto, ahora, presupuesto),
      schema: ESQUEMA_VENTA,
      validate: validarRespuesta,
    });

    if (!modelo) {
      return { text: 'Perdón, se me complicó entenderte. ¿Me dices qué te gustaría pedir?', awaiting: 'CLIENTE' };
    }

    const r = aplicar(pedido, modelo.acciones, negocio.catalogo, negocio.reglas, ahora);
    pedido = r.pedido;

    // Reclamo de un pedido: disculpa, ticket urgente y el bot se calla. No se
    // deja al modelo improvisar: ni promesas de reembolso ni excusas.
    if (r.reclamo) {
      const ultimo = recientes[0];
      await this.tickets.abrirEscalado({
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        organizationId: negocio.organizationId,
        subject: `Reclamo${ultimo ? ` P-${ultimo.number}` : ''}: ${r.reclamo}`.slice(0, 120),
        slots: { venta: true, reclamo: r.reclamo, mensaje: texto, pedidos: recientes.map((o) => `P-${o.number} ${o.status}`) },
        reason: 'queja',
      });
      await this.guardarLectura(lectura, orden?.id ?? null, modelo.lectura, pedido, false, { cancelo: false, enviado: false });
      return {
        text: `Lamento mucho lo que pasó${ultimo ? ` con tu pedido P-${ultimo.number}` : ''} 🙏 ` +
          `Ya se lo pasé a ${negocio.nombre} como urgente; una persona te escribe por aquí para resolverlo.`,
        awaiting: 'AGENTE',
        silencioMs: SILENCIO_ESCALADO_MS,
      };
    }

    // Una persona: la plática sigue en el panel, con todo lo que llevaba.
    if (r.persona) {
      await this.tickets.abrirEscalado({
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        organizationId: negocio.organizationId,
        subject: `Venta: ${texto}`.slice(0, 120),
        slots: { venta: true, lleva: pedido.items.map((i) => `${i.cantidad} × ${i.nombre}`) },
        reason: 'pidio_humano',
      });
      await this.guardarLectura(lectura, orden?.id ?? null, modelo.lectura, pedido, false, { cancelo: false, enviado: false });
      return {
        text: `Claro, le paso tu mensaje a alguien de ${negocio.nombre} y te escribe por aquí.`,
        awaiting: 'AGENTE',
        silencioMs: SILENCIO_ESCALADO_MS,
      };
    }

    if (r.cancelar) {
      if (orden) await this.prisma.order.update({ where: { id: orden.id }, data: { status: 'CANCELADO', confirmPending: false } });
      await this.guardarLectura(lectura, orden?.id ?? null, modelo.lectura, pedido, false, { cancelo: true, enviado: false });
      return { text: textoSeguro(modelo.respuesta, 'Va, lo dejo así. Aquí estoy si se te antoja algo después.', pedido, negocio), awaiting: 'NADIE' };
    }

    const guardado = r.cambio || r.listo || orden
      ? await this.guardar(orden, pedido, negocio.organizationId, ctx, false)
      : null;

    // El cierre lo decide el código, no el modelo: en cuanto el pedido tiene
    // todo (productos, entrega, nombre) y acaba de cambiar, se le muestra el
    // resumen y se le pide el "sí". Antes el modelo decía "Listo, Brando, tu
    // paquete en 25 minutos" sin resumen ni confirmación, y nada se enviaba.
    const completo = r.cambio && r.rechazos.length === 0 &&
      faltantes(pedido, negocio.reglas, ahora, negocio.catalogo).length === 0;
    if (r.listo || completo) {
      const falta = faltantes(pedido, negocio.reglas, ahora, negocio.catalogo);
      if (falta.length === 0 && guardado) {
        await this.prisma.order.update({ where: { id: guardado.id }, data: { confirmPending: true } });
        await this.guardarLectura(lectura, guardado.id, modelo.lectura, pedido, true, { cancelo: false, enviado: false });
        return { text: resumenFinal(pedido, negocio, ahora), awaiting: 'CLIENTE' };
      }
      // El modelo lo dio por listo antes de tiempo: se pide lo que falta.
      await this.guardarLectura(lectura, guardado?.id ?? null, modelo.lectura, pedido, false, { cancelo: false, enviado: false });
      return { text: preguntaPor(falta[0]!, pedido, negocio, ahora), awaiting: 'CLIENTE' };
    }

    await this.guardarLectura(lectura, guardado?.id ?? null, modelo.lectura, pedido, false, { cancelo: false, enviado: false });

    const permitidos = montosPermitidos(pedido, negocio.catalogo, negocio.reglas);
    if (presupuesto) for (const m of montosDePresupuesto(negocio.catalogo, presupuesto)) permitidos.add(m);

    // Si una regla frenó algo, el texto del modelo daba por hecho lo que NO
    // pasó ("listo, te lo dejamos en Veracruz" + "a esa zona no llegamos" en
    // el mismo mensaje). Y si trae montos que no salen de la carta, tampoco
    // sale. En los dos casos se pide un texto nuevo con lo que de verdad quedó.
    const propio = modelo.respuesta.trim();
    const avisos = [...r.avisos];
    // Dar el pedido por cerrado sin el "sí" al resumen es prometer algo que no
    // pasó: el cliente se va creyendo que pidió.
    if (propio && afirmaCierre(propio)) avisos.push('El pedido todavía no está confirmado ni enviado.');
    let respuesta: string | null =
      propio && r.rechazos.length === 0 && avisos.length === r.avisos.length && !inventaMontos(propio, permitidos) ? propio : null;
    if (respuesta === null) {
      respuesta = await this.corregir(negocio, pedido, recientes, turnos, texto, ahora, presupuesto, avisos, propio, permitidos);
    }

    const partes: string[] = [];
    if (respuesta) partes.push(respuesta);
    else {
      // Sin texto que se pueda mandar: lo que no se pudo, primero, y luego
      // lo que falta. Nunca la misma frase de relleno en cada turno.
      if (r.avisos.length) partes.push(r.avisos.join(' '));
      partes.push(siguientePaso(pedido, negocio, ahora));
    }
    if (r.cambio && pedido.items.length > 0) partes.push('Llevas:\n' + resumen(pedido));
    return { text: partes.join('\n\n'), awaiting: 'CLIENTE' };
  }

  /** Segundo intento de texto, ya sabiendo qué se rechazó. Null si tampoco sirve. */
  private async corregir(
    negocio: Negocio,
    pedido: Pedido,
    recientes: Array<{ number: number; status: string; etaAt: Date | null; rejectReason: string | null }>,
    turnos: Array<{ role: string; text: string }>,
    texto: string,
    ahora: Date,
    presupuesto: number | null,
    avisos: string[],
    propio: string,
    permitidos: Set<number>,
  ): Promise<string | null> {
    const borrador = await this.llm.draft({
      tarea: 'redaccion',
      system: SISTEMA_CORRECCION,
      user: [
        contexto(negocio, pedido, recientes, turnos, texto, ahora, presupuesto),
        avisos.length ? `AVISOS DEL SISTEMA (esto NO se hizo):\n${avisos.join('\n')}` : '',
        propio ? `LO QUE SE IBA A CONTESTAR (no se puede mandar así):\n${propio}` : '',
      ].filter(Boolean).join('\n\n'),
      maxTokens: 400,
    });
    const limpio = borrador?.trim() ?? '';
    if (!limpio || inventaMontos(limpio, permitidos)) return null;
    return limpio;
  }

  /** El "sí" al resumen: el pedido pasa a la empresa. */
  private async enviar(
    orden: Order,
    pedido: Pedido,
    negocio: Negocio,
    lectura: { v?: LecturaVenta },
    ahora: Date,
  ): Promise<StrategyReply> {
    // Entre el resumen y el sí pudo cerrar el negocio o cambiar algo.
    const falta = faltantes(pedido, negocio.reglas, ahora, negocio.catalogo);
    if (falta.length > 0) {
      await this.prisma.order.update({ where: { id: orden.id }, data: { confirmPending: false } });
      return { text: preguntaPor(falta[0]!, pedido, negocio, ahora), awaiting: 'CLIENTE' };
    }

    const enviado = await this.prisma.order.update({
      where: { id: orden.id },
      data: { status: 'POR_ACEPTAR', confirmPending: false, submittedAt: ahora, buyingScore: 100 },
    });
    lectura.v = { salesEmotion: 'entusiasmado', salesIntensity: 3, salesStage: 'cerrando', salesScore: 100, salesSignal: 'confirmó el resumen' };

    const nombre = pedido.customerName?.split(' ')[0] ?? '';
    return {
      text: `¡Listo${nombre ? `, ${nombre}` : ''}! Tu pedido *P-${enviado.number}* ya está con ${negocio.nombre}. ` +
        'En cuanto lo acepten te confirmo por aquí la hora.',
      awaiting: 'NADIE',
    };
  }

  private async pedidoEnCurso(conversationId: string, organizationId: string): Promise<Order | null> {
    return this.prisma.order.findFirst({
      where: {
        conversationId,
        organizationId,
        status: 'ARMANDO',
        updatedAt: { gte: new Date(Date.now() - VIGENCIA_ARMANDO_MS) },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async guardar(
    orden: Order | null,
    p: Pedido,
    organizationId: string,
    ctx: StrategyContext,
    confirmPending: boolean,
  ): Promise<Order> {
    const datos = {
      items: p.items as unknown as Prisma.InputJsonValue,
      deliveryMode: p.deliveryMode,
      address: p.address,
      zone: p.zone,
      deliveryCents: p.deliveryCents,
      totalCents: p.items.reduce((n, r) => n + r.precioCents * r.cantidad, 0) + p.deliveryCents,
      customerName: p.customerName,
      notes: p.notes,
      scheduledFor: p.scheduledFor,
      confirmPending,
    };
    return orden
      ? this.prisma.order.update({ where: { id: orden.id }, data: datos })
      : this.prisma.order.create({
          data: { ...datos, organizationId, contactId: ctx.contactId, conversationId: ctx.conversationId },
        });
  }

  /**
   * La lectura va al pedido aquí, y al mensaje por el caso de uso.
   *
   * La del mensaje NO se escribe con this.prisma: la transacción del turno
   * ya tiene tomado ese renglón (lo marcó atendido), así que un UPDATE desde
   * otra conexión esperaba a que la transacción terminara, y la transacción
   * esperaba a este UPDATE. A los 60 s se vencía, se deshacía todo —también
   * la respuesta— y el cliente nunca recibía nada. Se deja en `destino` y
   * el caso de uso la escribe con su propia transacción.
   */
  private async guardarLectura(
    destino: { v?: LecturaVenta },
    orderId: string | null,
    lectura: LecturaModelo,
    pedido: Pedido,
    confirmPending: boolean,
    opciones: { cancelo: boolean; enviado: boolean },
  ): Promise<void> {
    const score = mezclar(lectura, avanceDelPedido(pedido, confirmPending), opciones);
    destino.v = {
      salesEmotion: lectura.emocion,
      salesIntensity: lectura.intensidad,
      salesStage: lectura.etapa,
      salesScore: score,
      salesSignal: lectura.senal || null,
    };
    if (!orderId) return;
    try {
      await this.prisma.order.update({ where: { id: orderId }, data: { buyingScore: score } });
    } catch (err) {
      this.logger.warn(`no se guardó la probabilidad del pedido ${orderId}: ${String(err)}`);
    }
  }
}

// ── Piezas sin estado ──────────────────────────────────────────────────

/** "sí", "confírmalo", "así está bien", "va, mándalo"... y nada que lo contradiga. */
export function confirmaPedido(texto: string): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (/\b(no|pero|cambia|cambiar|quita|agrega|mejor|espera)\b/.test(t)) return false;
  return /^(si|sip|simon|claro|dale|va|sale|ok|okey|perfecto|correcto|exacto|listo|asi|asi esta bien|asi esta perfecto|esta bien|confirma|confirmalo|confirmado|si confirma|si confirmalo|si por favor|si porfa|si gracias|si asi|mandalo|si mandalo|va mandalo|adelante|de acuerdo|si esta bien|si dale|si va|si correcto)( (por favor|porfa|gracias|asi|va))*$/.test(t);
}

function validarRespuesta(raw: unknown): RespuestaModelo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.respuesta !== 'string' || !Array.isArray(r.acciones)) return null;
  const tipos = ['agregar', 'quitar', 'cantidad', 'entrega', 'programar', 'nombre', 'nota', 'listo', 'cancelar', 'persona', 'reclamo'];
  const modos = ['', 'RECOGER', 'DOMICILIO', 'PAQUETERIA', 'DIGITAL'];
  const acciones: Accion[] = [];
  for (const a of r.acciones.slice(0, 20)) {
    const x = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>;
    if (!tipos.includes(String(x.tipo))) continue;
    acciones.push({
      tipo: x.tipo as Accion['tipo'],
      productoId: String(x.productoId ?? ''),
      cantidad: typeof x.cantidad === 'number' ? x.cantidad : 0,
      texto: String(x.texto ?? ''),
      modo: (modos.includes(String(x.modo)) ? x.modo : '') as Accion['modo'],
      zona: String(x.zona ?? ''),
    });
  }
  return { respuesta: r.respuesta.slice(0, 1200), acciones, lectura: leerLectura(r.lectura) };
}

/** "Listo, tu pedido está…", "confirmado", "en 25 minutos": hablar como si ya se hubiera enviado. */
export function afirmaCierre(texto: string): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(pedido (esta|quedo|ya esta) (confirmado|listo|hecho|enviado)|ya (quedo|esta) (confirmado|tu pedido)|confirmado|te lo (tenemos|llevamos|entregamos) en \d+|(listo|llega|estara)[^.?!]{0,40}en \d+ min|\btu (pedido|paquete|pollo|orden)[^.?!]{0,50}en \d+ min|^listo\b[^?]{0,60}\btu (pedido|paquete|pollo|orden))/.test(t);
}

/** El texto del modelo, salvo que mencione un monto que no sale del catálogo. */
function textoSeguro(texto: string, respaldo: string, p: Pedido, n: Negocio): string {
  const limpio = texto.trim();
  if (!limpio) return respaldo;
  if (inventaMontos(limpio, montosPermitidos(p, n.catalogo, n.reglas))) return respaldo;
  return limpio;
}

function leerZonas(raw: unknown): ReglasVenta['zonas'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((z) => (typeof z === 'object' && z !== null ? z as Record<string, unknown> : {}))
    .filter((z) => typeof z.nombre === 'string' && z.nombre.trim() !== '')
    .map((z) => ({ nombre: String(z.nombre).trim(), costoCents: Math.max(0, Math.round(Number(z.costo) || 0) * 100) }));
}

function desdeOrden(o: Order): Pedido {
  return {
    items: Array.isArray(o.items) ? (o.items as unknown as Renglon[]) : [],
    deliveryMode: o.deliveryMode,
    address: o.address,
    zone: o.zone,
    deliveryCents: o.deliveryCents,
    customerName: o.customerName,
    notes: o.notes,
    scheduledFor: o.scheduledFor,
  };
}

/** Lo que se le dice al modelo: el negocio, la carta, el pedido y la plática. */
function contexto(
  n: Negocio,
  p: Pedido,
  recientes: Array<{ number: number; status: string; etaAt: Date | null; rejectReason: string | null }>,
  turnos: Array<{ role: string; text: string }>,
  texto: string,
  ahora: Date,
  presupuesto: number | null = null,
): string {
  const { reglas } = n;
  const local = enZona(ahora, reglas.timezone);
  const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
  const abierto = abiertoEn(reglas.horario, ahora, reglas.timezone);
  const abre = abierto ? null : siguienteApertura(reglas.horario, ahora, reglas.timezone);

  const carta = n.catalogo.map((c) =>
    `- [${c.id}] ${c.section ? c.section + ' · ' : ''}${c.name} — ${pesos(c.priceCents)}` +
    (c.availableDays?.length ? ` · SOLO ${diasEnPalabras(c.availableDays).toUpperCase()}` : '') +
    (c.description ? ' · ' + c.description : ''));

  const lleva = p.items.length
    ? p.items.map((i) => `${i.cantidad} × ${i.nombre} [${i.productId}]${i.nota ? ` (${i.nota})` : ''}`).join('; ')
    : 'nada todavía';

  return [
    `NEGOCIO: ${n.nombre}${n.giro ? ' — ' + n.giro : ''}`,
    n.pitch ? `LO QUE LA EMPRESA QUIERE QUE SEPAS:\n${n.pitch}` : '',
    `AHORA (hora del negocio): ${local.fecha} ${local.hhmm}, ${abierto ? 'ABIERTO' : 'CERRADO'}` +
      (abre ? `; abre ${cuandoEnPalabras(abre, ahora, reglas.timezone)}` : ''),
    `HOY ES: ${fechaEnPalabras(ahora, reglas.timezone)}. MAÑANA ES: ${fechaEnPalabras(manana, reglas.timezone)}. ` +
      'Solo se programa para hoy o mañana.',
    `HORARIO: ${horarioEnPalabras(reglas.horario)}`,
    `ENTREGA: ${reglas.deliveryModes.map((m) => `${m} (${NOMBRE_ENTREGA[m]})`).join(', ') || 'sin definir'}` +
      (reglas.zonas.length
        ? `\nZONAS A DOMICILIO (solo estas; cualquier otro lugar = no llegamos): ` +
          reglas.zonas.map((z) => `${z.nombre} ${pesos(z.costoCents)}`).join(', ')
        : '') +
      `\nTIEMPO DE PREPARACIÓN (APROXIMADO): ${tiempoAproximado(reglas.prepMinutes)}. Nunca prometas un ` +
        'tiempo exacto: di "aproximadamente" y que se le confirma cuando el negocio acepte el pedido.' +
      (reglas.minOrderCents ? `\nPEDIDO MÍNIMO: ${pesos(reglas.minOrderCents)}` : ''),
    `CARTA (usa SOLO estos id):\n${carta.join('\n')}`,
    `PEDIDO EN CURSO: ${lleva}` +
      `\n  entrega: ${p.deliveryMode ?? 'sin elegir'}${p.address ? ` · dirección: ${p.address}` : ''}${p.zone ? ` · zona: ${p.zone}` : ''}` +
      `\n  nombre: ${p.customerName ?? 'sin dar'}` +
      `\n  para: ${p.scheduledFor ? cuandoEnPalabras(p.scheduledFor, ahora, reglas.timezone) : 'lo antes posible'}`,
    recientes.length
      ? 'PEDIDOS YA ENVIADOS HOY: ' + recientes.map((o) => `P-${o.number} ${o.status}` +
          (o.etaAt ? ` listo ${cuandoEnPalabras(o.etaAt, ahora, reglas.timezone)}` : '') +
          (o.rejectReason ? ` (${o.rejectReason})` : '')).join('; ')
      : '',
    presupuesto ? presupuestoParaModelo(n.catalogo, presupuesto, subtotal(p)) : '',
    turnos.length ? 'PLÁTICA RECIENTE:\n' + turnos.map((t) => `${t.role}: ${t.text}`).join('\n') : '',
    `MENSAJE NUEVO DEL CLIENTE:\n${texto}`,
  ].filter(Boolean).join('\n\n');
}

/** El resumen para el sí final. Lo arma el código, con los precios reales. */
function resumenFinal(p: Pedido, n: Negocio, ahora: Date): string {
  const { reglas } = n;
  const entrega = p.deliveryMode === 'DOMICILIO'
    ? `A domicilio: ${p.address}${p.zone ? ` (${p.zone})` : ''}`
    : p.deliveryMode === 'PAQUETERIA'
      ? `Envío a: ${p.address}`
      : p.deliveryMode === 'DIGITAL' ? 'Entrega digital' : `Para recoger en ${n.nombre}`;
  const cuando = p.scheduledFor
    ? `Para ${cuandoEnPalabras(p.scheduledFor, ahora, reglas.timezone)}`
    : `Lo antes posible (aproximadamente ${tiempoAproximado(reglas.prepMinutes)}; te confirmamos la hora al aceptarlo)`;

  return [
    'Así quedaría tu pedido:',
    resumen(p),
    `${entrega}\n${cuando}\nA nombre de: ${p.customerName}` + (p.notes ? `\nNota: ${p.notes}` : ''),
    '¿Lo confirmo así? Responde *sí* o dime qué cambio.',
  ].join('\n\n');
}

/**
 * "entre 25 y 40 minutos". El tiempo de preparación es un promedio, no una
 * promesa: "en 25 minutos" se lee como compromiso y la cocina no siempre llega.
 */
export function tiempoAproximado(prepMinutes: number): string {
  const desde = Math.max(5, prepMinutes);
  const holgura = Math.max(10, Math.round((desde * 0.5) / 5) * 5);
  return `entre ${desde} y ${desde + holgura} minutos`;
}

/** La pregunta que sigue cuando no hay texto del modelo que se pueda mandar. */
function siguientePaso(p: Pedido, n: Negocio, ahora: Date): string {
  const falta = faltantes(p, n.reglas, ahora, n.catalogo);
  if (falta.length === 0) return '¿Así te lo dejo o le cambio algo?';
  if (falta[0] === 'productos') return '¿Ya sabes qué se te antoja o te recomiendo algo?';
  return preguntaPor(falta[0]!, p, n, ahora);
}

/** Lo que falta, preguntado como alternativa cuando se puede. */
function preguntaPor(f: Faltante, p: Pedido, n: Negocio, ahora: Date): string {
  const { reglas } = n;
  switch (f) {
    case 'productos': return '¿Ya sabes qué se te antoja o te recomiendo algo?';
    case 'dia': {
      const fuera = fueraDeDia(p, n.catalogo, reglas, ahora);
      return fuera.map((c) => `${c.name} solo se vende ${diasEnPalabras(c.availableDays ?? [])}.`).join(' ') +
        ' ¿Lo cambiamos por otra opción o te lo programo para ese día?';
    }
    case 'entrega': {
      const modos = reglas.deliveryModes.map((m) => NOMBRE_ENTREGA[m]);
      return modos.length > 1 ? `¿Lo quieres ${modos.slice(0, -1).join(', ')} o ${modos[modos.length - 1]}?` : `Sería ${modos[0] ?? 'para recoger'}, ¿va?`;
    }
    case 'direccion': return '¿A qué dirección te lo llevamos? Calle, número y colonia.';
    case 'zona': return `¿En qué zona queda? Llegamos a: ${reglas.zonas.map((z) => z.nombre).join(', ')}.`;
    case 'nombre': return '¿A nombre de quién lo dejo?';
    case 'minimo': return `El pedido mínimo es de ${pesos(reglas.minOrderCents)}. ¿Le agregamos algo más?`;
    case 'horario': {
      const abre = siguienteApertura(reglas.horario, ahora, reglas.timezone);
      return abre
        ? `Ahorita estamos cerrados; abrimos ${cuandoEnPalabras(abre, ahora, reglas.timezone)}. ¿Te lo programo para esa hora o para otra?`
        : 'Ahorita no estamos tomando pedidos. ¿Te aviso cuando abramos?';
    }
  }
}
