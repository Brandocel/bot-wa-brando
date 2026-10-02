import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DeliveryMode, Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { separarChat } from '../../domain/message/linea';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import { ConversationHistoryService } from '../support/conversation-history.service';
import { TicketService } from '../support/ticket.service';
import type { StrategyContext, StrategyReply } from '../support/support.strategy';
import { ESQUEMA_VENTA, SISTEMA_VENTA } from './guion-venta';
import {
  abiertoEn,
  cuandoEnPalabras,
  enZona,
  horarioEnPalabras,
  leerHorario,
  siguienteApertura,
} from './horario';
import { avanceDelPedido, leerLectura, mezclar, type LecturaModelo } from './lectura';
import {
  aplicar,
  faltantes,
  inventaMontos,
  montosPermitidos,
  pedidoVacio,
  pesos,
  resumen,
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
          select: { id: true, name: true, description: true, section: true, priceCents: true },
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
    const texto = message.body.trim();
    if (texto === '') return null;
    const ahora = new Date();

    const orden = await this.pedidoEnCurso(ctx.conversationId, negocio.organizationId);
    let pedido = orden ? desdeOrden(orden) : pedidoVacio();

    // El resumen ya se le mostró: un "sí" claro lo manda a la empresa.
    if (orden?.confirmPending) {
      if (confirmaPedido(texto)) return this.enviar(orden, pedido, negocio, message, ahora);
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
    const modelo = await this.llm.extract<RespuestaModelo>({
      tarea: 'conversacion',
      system: SISTEMA_VENTA,
      user: contexto(negocio, pedido, recientes, turnos, texto, ahora),
      schema: ESQUEMA_VENTA,
      validate: validarRespuesta,
    });

    if (!modelo) {
      return { text: 'Perdón, se me complicó entenderte. ¿Me dices qué te gustaría pedir?', awaiting: 'CLIENTE' };
    }

    const r = aplicar(pedido, modelo.acciones, negocio.catalogo, negocio.reglas, ahora);
    pedido = r.pedido;

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
      await this.guardarLectura(message.id, orden?.id ?? null, modelo.lectura, pedido, false, { cancelo: false, enviado: false });
      return { text: `Claro, le paso tu mensaje a alguien de ${negocio.nombre} y te escribe por aquí.`, awaiting: 'AGENTE' };
    }

    if (r.cancelar) {
      if (orden) await this.prisma.order.update({ where: { id: orden.id }, data: { status: 'CANCELADO', confirmPending: false } });
      await this.guardarLectura(message.id, orden?.id ?? null, modelo.lectura, pedido, false, { cancelo: true, enviado: false });
      return { text: textoSeguro(modelo.respuesta, 'Va, lo dejo así. Aquí estoy si se te antoja algo después.', pedido, negocio), awaiting: 'NADIE' };
    }

    const guardado = r.cambio || r.listo || orden
      ? await this.guardar(orden, pedido, negocio.organizationId, ctx, false)
      : null;

    if (r.listo) {
      const falta = faltantes(pedido, negocio.reglas, ahora);
      if (falta.length === 0 && guardado) {
        await this.prisma.order.update({ where: { id: guardado.id }, data: { confirmPending: true } });
        await this.guardarLectura(message.id, guardado.id, modelo.lectura, pedido, true, { cancelo: false, enviado: false });
        return { text: resumenFinal(pedido, negocio, ahora), awaiting: 'CLIENTE' };
      }
      // El modelo lo dio por listo antes de tiempo: se pide lo que falta.
      await this.guardarLectura(message.id, guardado?.id ?? null, modelo.lectura, pedido, false, { cancelo: false, enviado: false });
      return { text: preguntaPor(falta[0]!, pedido, negocio, ahora), awaiting: 'CLIENTE' };
    }

    await this.guardarLectura(message.id, guardado?.id ?? null, modelo.lectura, pedido, false, { cancelo: false, enviado: false });

    const partes = [textoSeguro(modelo.respuesta, '¿Qué más te gustaría agregar?', pedido, negocio)];
    if (r.avisos.length) partes.push(r.avisos.join(' '));
    if (r.cambio && pedido.items.length > 0) partes.push('Llevas:\n' + resumen(pedido));
    return { text: partes.join('\n\n'), awaiting: 'CLIENTE' };
  }

  /** El "sí" al resumen: el pedido pasa a la empresa. */
  private async enviar(
    orden: Order,
    pedido: Pedido,
    negocio: Negocio,
    message: IncomingMessage,
    ahora: Date,
  ): Promise<StrategyReply> {
    // Entre el resumen y el sí pudo cerrar el negocio o cambiar algo.
    const falta = faltantes(pedido, negocio.reglas, ahora);
    if (falta.length > 0) {
      await this.prisma.order.update({ where: { id: orden.id }, data: { confirmPending: false } });
      return { text: preguntaPor(falta[0]!, pedido, negocio, ahora), awaiting: 'CLIENTE' };
    }

    const enviado = await this.prisma.order.update({
      where: { id: orden.id },
      data: { status: 'POR_ACEPTAR', confirmPending: false, submittedAt: ahora, buyingScore: 100 },
    });
    await this.prisma.message.updateMany({
      where: { id: message.id },
      data: { salesEmotion: 'entusiasmado', salesIntensity: 3, salesStage: 'cerrando', salesScore: 100, salesSignal: 'confirmó el resumen' },
    });

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

  /** La lectura va al mensaje y al pedido. Si falla, la venta sigue. */
  private async guardarLectura(
    messageId: string,
    orderId: string | null,
    lectura: LecturaModelo,
    pedido: Pedido,
    confirmPending: boolean,
    opciones: { cancelo: boolean; enviado: boolean },
  ): Promise<void> {
    const score = mezclar(lectura, avanceDelPedido(pedido, confirmPending), opciones);
    try {
      await this.prisma.message.updateMany({
        where: { id: messageId },
        data: {
          salesEmotion: lectura.emocion,
          salesIntensity: lectura.intensidad,
          salesStage: lectura.etapa,
          salesScore: score,
          salesSignal: lectura.senal || null,
        },
      });
      if (orderId) await this.prisma.order.update({ where: { id: orderId }, data: { buyingScore: score } });
    } catch (err) {
      this.logger.warn(`no se guardó la lectura de ${messageId}: ${String(err)}`);
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
  const tipos = ['agregar', 'quitar', 'cantidad', 'entrega', 'programar', 'nombre', 'nota', 'listo', 'cancelar', 'persona'];
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
): string {
  const { reglas } = n;
  const local = enZona(ahora, reglas.timezone);
  const abierto = abiertoEn(reglas.horario, ahora, reglas.timezone);
  const abre = abierto ? null : siguienteApertura(reglas.horario, ahora, reglas.timezone);

  const carta = n.catalogo.map((c) =>
    `- [${c.id}] ${c.section ? c.section + ' · ' : ''}${c.name} — ${pesos(c.priceCents)}${c.description ? ' · ' + c.description : ''}`);

  const lleva = p.items.length
    ? p.items.map((i) => `${i.cantidad} × ${i.nombre} [${i.productId}]${i.nota ? ` (${i.nota})` : ''}`).join('; ')
    : 'nada todavía';

  return [
    `NEGOCIO: ${n.nombre}${n.giro ? ' — ' + n.giro : ''}`,
    n.pitch ? `LO QUE LA EMPRESA QUIERE QUE SEPAS:\n${n.pitch}` : '',
    `AHORA (hora del negocio): ${local.fecha} ${local.hhmm}, ${abierto ? 'ABIERTO' : 'CERRADO'}` +
      (abre ? `; abre ${cuandoEnPalabras(abre, ahora, reglas.timezone)}` : ''),
    `HORARIO: ${horarioEnPalabras(reglas.horario)}`,
    `ENTREGA: ${reglas.deliveryModes.map((m) => `${m} (${NOMBRE_ENTREGA[m]})`).join(', ') || 'sin definir'}` +
      (reglas.zonas.length ? `\nZONAS A DOMICILIO: ${reglas.zonas.map((z) => `${z.nombre} ${pesos(z.costoCents)}`).join(', ')}` : '') +
      `\nTIEMPO DE PREPARACIÓN: unos ${reglas.prepMinutes} minutos` +
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
    : `Lo antes posible (unos ${reglas.prepMinutes} min)`;

  return [
    'Así quedaría tu pedido:',
    resumen(p),
    `${entrega}\n${cuando}\nA nombre de: ${p.customerName}` + (p.notes ? `\nNota: ${p.notes}` : ''),
    '¿Lo confirmo así? Responde *sí* o dime qué cambio.',
  ].join('\n\n');
}

/** Lo que falta, preguntado como alternativa cuando se puede. */
function preguntaPor(f: Faltante, p: Pedido, n: Negocio, ahora: Date): string {
  const { reglas } = n;
  switch (f) {
    case 'productos': return '¿Qué se te antoja? Te puedo recomendar según para cuántos sea.';
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
