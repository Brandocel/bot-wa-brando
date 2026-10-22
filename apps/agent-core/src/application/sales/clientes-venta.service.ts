import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { Renglon } from './pedido';
import { prefijoDeLinea } from '../../domain/message/linea';
import {
  clasificar,
  estrategiaParaModelo,
  leerSentimiento,
  proximaAccion,
  type Segmento,
} from './inteligencia-cliente';
import { calcularPerfil, clienteParaModelo, type PedidoHistorico } from './perfil-cliente';

export type TipoEvento =
  | 'primer_contacto'
  | 'pedido_armando'
  | 'pedido_confirmado'
  | 'pedido_aceptado'
  | 'pedido_rechazado'
  | 'pedido_entregado'
  | 'pedido_cancelado'
  | 'reclamo'
  | 'pidio_persona';

/** Pedidos que el cliente sí mandó: son los que enseñan qué le gusta. */
const MANDADOS = ['POR_ACEPTAR', 'ACEPTADO', 'ENTREGADO'] as const;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Los clientes de venta de cada empresa: su bitácora (trazabilidad), su
 * perfil y lo que le gusta, y lo que se le recomienda.
 *
 * Arranca en frío: con la base vacía cada cliente es NUEVO y no se
 * recomienda nada propio. Conforme hay pedidos, el perfil se recalcula
 * entero de ellos (aprender), así nunca se desvía de lo que de verdad pasó.
 *
 * Nada de esto debe tumbar una venta: cada método falla en silencio.
 */
@Injectable()
export class ClientesVentaService {
  private readonly logger = new Logger(ClientesVentaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Cada mensaje: el perfil existe y sabe cuándo fue el último contacto. */
  async tocar(organizationId: string, contactId: string): Promise<void> {
    await this.seguro('tocar', async () => {
      const ahora = new Date();
      const previo = await this.prisma.perfilCliente.findUnique({
        where: { organizationId_contactId: { organizationId, contactId } },
        select: { id: true },
      });
      if (previo) {
        await this.prisma.perfilCliente.update({ where: { id: previo.id }, data: { ultimoContactoAt: ahora } });
        return;
      }
      await this.prisma.perfilCliente.create({ data: { organizationId, contactId } });
      await this.registrar(organizationId, contactId, 'primer_contacto');
    });
  }

  async registrar(
    organizationId: string,
    contactId: string,
    tipo: TipoEvento,
    detalle: Record<string, unknown> = {},
    orderId: string | null = null,
  ): Promise<void> {
    await this.seguro(`evento ${tipo}`, () =>
      this.prisma.eventoCliente.create({
        data: { organizationId, contactId, tipo, detalle: detalle as Prisma.InputJsonValue, orderId },
      }),
    );
  }

  /**
   * La última lectura de la plática: cómo se siente y qué tan cerca está de
   * comprar. Con ella se reclasifica: un prospecto se calienta o se enfría
   * mientras platica, no solo cuando pide.
   */
  async lectura(organizationId: string, contactId: string, emocion: string | null, score: number | null): Promise<void> {
    await this.seguro('lectura', () =>
      this.prisma.perfilCliente.updateMany({
        where: { organizationId, contactId },
        data: { ultimaEmocion: emocion, ultimoScore: score },
      }),
    );
    await this.aprender(organizationId, contactId);
  }

  /** Recalcula perfil y preferencias de sus pedidos. Después de cada cambio de pedido. */
  async aprender(organizationId: string, contactId: string): Promise<void> {
    await this.seguro('aprender', async () => {
      const desde30 = new Date(Date.now() - 30 * DIA_MS);
      const [ordenes, armoAlgo, ajustes, org, previo, tickets, reclamos, ultimoEvento] = await Promise.all([
        this.prisma.order.findMany({
          where: { organizationId, contactId, status: { in: [...MANDADOS] } },
          select: {
            items: true, deliveryMode: true, zone: true, address: true, customerName: true,
            totalCents: true, submittedAt: true, createdAt: true,
          },
        }),
        this.prisma.order.count({ where: { organizationId, contactId } }),
        this.prisma.salesSettings.findUnique({ where: { organizationId }, select: { timezone: true } }),
        this.prisma.organization.findUnique({ where: { id: organizationId }, select: { waLineId: true } }),
        this.prisma.perfilCliente.findUnique({
          where: { organizationId_contactId: { organizationId, contactId } },
          select: { ultimoScore: true },
        }),
        // Ticket típico de la empresa: la vara contra la que se mide el monto.
        this.prisma.order.findMany({
          where: { organizationId, status: { in: [...MANDADOS] }, createdAt: { gte: new Date(Date.now() - 180 * DIA_MS) } },
          select: { totalCents: true },
          take: 500,
        }),
        this.prisma.eventoCliente.count({ where: { organizationId, contactId, tipo: 'reclamo', createdAt: { gte: desde30 } } }),
        this.prisma.eventoCliente.findFirst({
          where: { organizationId, contactId, tipo: { startsWith: 'pedido_' } },
          orderBy: { createdAt: 'desc' },
          select: { tipo: true, createdAt: true, detalle: true },
        }),
      ]);

      // Cómo se ha sentido: la emoción de sus mensajes por la línea de esta empresa.
      const lecturas = org?.waLineId
        ? await this.prisma.message.findMany({
            where: {
              direction: 'IN',
              salesEmotion: { not: null },
              conversation: { contactId, chatId: { startsWith: prefijoDeLinea(org.waLineId) } },
            },
            orderBy: { createdAt: 'desc' },
            take: 60,
            select: { salesEmotion: true, salesIntensity: true, createdAt: true },
          })
        : [];

      const historial: PedidoHistorico[] = ordenes.map((o) => ({
        items: renglones(o.items),
        deliveryMode: o.deliveryMode,
        zone: o.zone,
        address: o.address,
        customerName: o.customerName,
        totalCents: o.totalCents,
        at: o.submittedAt ?? o.createdAt,
      }));
      const perfil = calcularPerfil(historial, {
        ahora: new Date(),
        timezone: ajustes?.timezone ?? 'America/Mexico_City',
        armoAlgo: armoAlgo > 0,
      });

      const sentimiento = leerSentimiento(
        lecturas.map((l) => ({ emocion: l.salesEmotion!, intensidad: l.salesIntensity, at: l.createdAt })),
      );
      const ahora = new Date();
      const clase = clasificar({
        etapa: perfil.etapa,
        pedidos: perfil.pedidos,
        ultimoPedidoAt: perfil.ultimoPedidoAt,
        ticketPromedioCents: perfil.ticketPromedioCents,
        ticketEmpresaCents: mediana(tickets.map((t) => t.totalCents)),
        ultimoScore: previo?.ultimoScore ?? null,
        sentimiento,
        reclamoReciente: reclamos > 0,
        ahora,
      });
      const accion = proximaAccion({
        segmento: clase.segmento,
        pedidos: perfil.pedidos,
        ultimoPedidoAt: perfil.ultimoPedidoAt,
        frecuenciaDias: perfil.frecuenciaDias,
        favorito: perfil.preferencias[0]?.producto ?? null,
        ultimoEvento: ultimoEvento
          ? {
              tipo: ultimoEvento.tipo,
              at: ultimoEvento.createdAt,
              numero: typeof (ultimoEvento.detalle as { numero?: unknown })?.numero === 'number'
                ? (ultimoEvento.detalle as { numero: number }).numero
                : undefined,
            }
          : null,
        ahora,
      });

      const { preferencias, ...base } = perfil;
      const datos = {
        ...base,
        sentimiento: sentimiento?.valor ?? null,
        tendencia: sentimiento?.tendencia ?? null,
        emocionDominante: sentimiento?.dominante ?? null,
        puntaje: clase.puntaje,
        segmento: clase.segmento,
        rfm: clase.rfm,
        proximaAccion: accion?.texto ?? null,
        proximaAccionAt: accion?.at ?? null,
      };
      await this.prisma.$transaction([
        this.prisma.perfilCliente.upsert({
          where: { organizationId_contactId: { organizationId, contactId } },
          create: { organizationId, contactId, ...datos },
          update: datos,
        }),
        this.prisma.preferenciaCliente.deleteMany({ where: { organizationId, contactId } }),
        this.prisma.preferenciaCliente.createMany({
          data: preferencias.map((p) => ({ organizationId, contactId, ...p })),
        }),
      ]);
    });
  }

  /** El bloque CLIENTE para el modelo de venta, o '' si no hay nada que decir. */
  async paraVenta(organizationId: string, contactId: string, carta: readonly string[]): Promise<string> {
    try {
      const [perfil, preferencias, recientes] = await Promise.all([
        this.prisma.perfilCliente.findUnique({ where: { organizationId_contactId: { organizationId, contactId } } }),
        this.prisma.preferenciaCliente.findMany({
          where: { organizationId, contactId },
          orderBy: [{ veces: 'desc' }, { unidades: 'desc' }],
          take: 10,
        }),
        // Lo que pide la gente en esta empresa, para quien no tiene historial
        // y para saber qué acompaña al favorito de este cliente.
        this.prisma.order.findMany({
          where: {
            organizationId,
            status: { in: [...MANDADOS] },
            createdAt: { gte: new Date(Date.now() - 180 * DIA_MS) },
          },
          orderBy: { createdAt: 'desc' },
          take: 1000,
          select: { items: true },
        }),
      ]);

      const canastas = recientes.map((o) => [...new Set(renglones(o.items).map((r) => r.nombre.trim()))]);
      const favorito = preferencias[0]?.producto ?? null;
      const estrategia = estrategiaParaModelo(
        (perfil?.segmento ?? 'NUEVO') as Segmento,
        perfil?.sentimiento != null && perfil.emocionDominante
          ? { valor: perfil.sentimiento, tendencia: (perfil.tendencia ?? 'estable') as 'estable', dominante: perfil.emocionDominante }
          : null,
      );
      return estrategia + '\n' + clienteParaModelo({
        perfil: perfil ?? {
          etapa: 'NUEVO', pedidos: 0, ultimoPedidoAt: null, entregaPreferida: null, zonaPreferida: null,
          horaHabitual: null, diasHabituales: [], nombre: null, frecuenciaDias: null,
        },
        preferencias,
        populares: contar(canastas.flat()),
        acompanantes: favorito
          ? contar(canastas.filter((c) => c.includes(favorito)).flat().filter((x) => x !== favorito))
          : [],
        enCarta: new Set(carta),
        ahora: new Date(),
      });
    } catch (err) {
      this.logger.warn(`no se armó el perfil para la venta: ${String(err)}`);
      return '';
    }
  }

  private async seguro(que: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`clientes de venta (${que}): ${String(err)}`);
    }
  }
}

function renglones(items: unknown): Renglon[] {
  return Array.isArray(items) ? (items as Renglon[]).filter((r) => r && typeof r.nombre === 'string') : [];
}

function contar(nombres: readonly string[]): { producto: string; veces: number }[] {
  const c = new Map<string, number>();
  for (const n of nombres) if (n) c.set(n, (c.get(n) ?? 0) + 1);
  return [...c.entries()].map(([producto, veces]) => ({ producto, veces })).sort((a, b) => b.veces - a.veces);
}

function mediana(valores: readonly number[]): number | null {
  if (valores.length < 5) return null; // en frío no hay vara confiable
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.floor(orden.length / 2)]!;
}
