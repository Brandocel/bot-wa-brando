import { Inject, Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import {
  ESCALONES_BASE,
  ESCALONES_FACTURA,
  IVA,
  MESES_ESCALERA,
  clavePrecio,
  cobroDelMes,
} from '../../domain/plan/plan-persona';
import type { StripeClient } from '../../infrastructure/pagos/stripe.client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

export const STRIPE = Symbol('STRIPE');
export type StripePort = Pick<StripeClient, 'pedir'>;

const PRODUCTOS = {
  base: { id: 'jarvis_persona', name: 'Jarvis · Plan Persona' },
  factura: { id: 'jarvis_persona_factura', name: 'Jarvis · Facturación' },
} as const;

interface Catalogo {
  iva: string;
  precios: Record<string, string>;
}

/** Lo que el panel enseña del plan de una organización. */
export interface VistaPlan {
  disponible: boolean;
  iva: number;
  escalones: Array<{ mes: number; base: number; factura: number }>;
  suscripcion: {
    estado: string;
    conFactura: boolean;
    mesesPagados: number;
    /** Lo que toca en el próximo cobro. */
    siguiente: ReturnType<typeof cobroDelMes>;
    ultimoCobroAt: Date | null;
    checkoutUrl: string | null;
  } | null;
}

/**
 * Plan Persona sobre Stripe. La escalera de precios vive en un Subscription
 * Schedule: Stripe cobra solo cada escalón, así un webhook perdido no deja
 * a nadie pagando de más. Los webhooks solo llevan la cuenta para el panel.
 */
@Injectable()
export class PlanService {
  private readonly log = new Logger(PlanService.name);
  private catalogo: Promise<Catalogo> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE) private readonly stripe: StripePort | null,
  ) {}

  get disponible(): boolean {
    return !!this.stripe;
  }

  private api(): StripePort {
    if (!this.stripe) throw new Error('El cobro no está configurado: falta STRIPE_SECRET_KEY.');
    return this.stripe;
  }

  async vista(organizationId: string): Promise<VistaPlan> {
    const s = await this.prisma.suscripcion.findUnique({ where: { organizationId } });
    return {
      disponible: this.disponible,
      iva: IVA,
      escalones: ESCALONES_BASE.map((base, i) => ({ mes: i + 1, base, factura: ESCALONES_FACTURA[i] })),
      suscripcion: s && {
        estado: s.estado,
        conFactura: s.conFactura,
        mesesPagados: s.mesesPagados,
        siguiente: cobroDelMes(s.mesesPagados + 1, s.conFactura),
        ultimoCobroAt: s.ultimoCobroAt,
        checkoutUrl: s.estado === 'PENDIENTE' ? s.checkoutUrl : null,
      },
    };
  }

  /**
   * Liga de pago para empezar el plan. Siempre arranca en el mes 1: una
   * suscripción cancelada no conserva su escalón.
   */
  async crearLiga(organizationId: string, conFactura: boolean, email?: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (!org) throw new Error('No encontré esa cuenta.');
    if (org.plan && ['ACTIVA', 'ATRASADA'].includes(org.plan.estado)) {
      throw new Error(`${org.name} ya tiene un plan activo.`);
    }

    const { iva, precios } = await this.asegurarCatalogo();
    const renglon = (clave: string) => ({ price: precios[clave], quantity: 1, tax_rates: [iva] });
    const sesion = await this.api().pedir('POST', 'checkout/sessions', {
      mode: 'subscription',
      locale: 'es',
      client_reference_id: organizationId,
      customer_email: email || undefined,
      line_items: [
        renglon(clavePrecio('base', 0)),
        ...(conFactura ? [renglon(clavePrecio('factura', 0))] : []),
      ],
      // Para quien quiera CFDI a su nombre: Stripe pide el RFC en el pago.
      tax_id_collection: { enabled: true },
      subscription_data: { metadata: { organizationId } },
      success_url: `${config.publicUrl}/plan/listo`,
      cancel_url: `${config.publicUrl}/plan/cancelado`,
    });

    await this.prisma.suscripcion.upsert({
      where: { organizationId },
      create: { organizationId, conFactura, checkoutUrl: sesion.url },
      update: {
        conFactura,
        checkoutUrl: sesion.url,
        estado: 'PENDIENTE',
        mesesPagados: 0,
        stripeSubscriptionId: null,
        stripeScheduleId: null,
        ultimoCobroId: null,
        ultimoCobroAt: null,
      },
    });
    return sesion.url as string;
  }

  /** Deja de cobrar al cierre del mes ya pagado; el webhook la marca cancelada. */
  async cancelar(organizationId: string): Promise<void> {
    const s = await this.prisma.suscripcion.findUnique({ where: { organizationId } });
    if (!s?.stripeSubscriptionId || s.estado === 'CANCELADA') {
      // Liga sin pagar: basta con olvidarla.
      if (s) await this.prisma.suscripcion.update({ where: { organizationId }, data: { estado: 'CANCELADA', checkoutUrl: null } });
      return;
    }
    // Con la escalera puesta, Stripe no deja tocar la suscripción: primero se suelta.
    if (s.stripeScheduleId) {
      await this.api()
        .pedir('POST', `subscription_schedules/${s.stripeScheduleId}/release`)
        .catch((err) => this.log.warn(`release ${s.stripeScheduleId}: ${err.message}`));
    }
    await this.api().pedir('POST', `subscriptions/${s.stripeSubscriptionId}`, { cancel_at_period_end: true });
  }

  // ── Webhooks ───────────────────────────────────────────────────────

  async manejarEvento(evento: { type: string; data: { object: any } }): Promise<void> {
    const o = evento.data.object;
    switch (evento.type) {
      case 'checkout.session.completed':
        return this.alPagarLiga(o);
      case 'invoice.paid':
        return this.alCobrar(o);
      case 'invoice.payment_failed':
        return this.cambiarEstado(suscripcionDe(o), 'ATRASADA');
      case 'customer.subscription.deleted':
        return this.cambiarEstado(o.id, 'CANCELADA');
    }
  }

  private async alPagarLiga(sesion: any): Promise<void> {
    const organizationId: string | undefined = sesion.client_reference_id;
    const subId: string | undefined = sesion.subscription;
    if (!organizationId || !subId) return;

    const s = await this.prisma.suscripcion.findUnique({ where: { organizationId } });
    if (!s) return;
    // Stripe reintenta webhooks: si la escalera ya está, no se arma otra.
    if (s.stripeSubscriptionId === subId && s.stripeScheduleId) return;

    const scheduleId = await this.armarEscalera(subId, s.conFactura);
    await this.prisma.suscripcion.update({
      where: { organizationId },
      data: {
        stripeSubscriptionId: subId,
        stripeCustomerId: sesion.customer ?? null,
        stripeScheduleId: scheduleId,
        estado: 'ACTIVA',
        checkoutUrl: null,
      },
    });
  }

  private async alCobrar(factura: any): Promise<void> {
    const subId = suscripcionDe(factura);
    if (!subId || !(factura.amount_paid > 0)) return;
    const s = await this.prisma.suscripcion.findUnique({ where: { stripeSubscriptionId: subId } });
    // El primer cobro puede llegar antes que checkout.session.completed.
    if (!s) return this.cobroSinLigar(factura, subId);
    if (s.ultimoCobroId === factura.id) return;
    await this.prisma.suscripcion.update({
      where: { organizationId: s.organizationId },
      data: {
        mesesPagados: { increment: 1 },
        ultimoCobroId: factura.id,
        ultimoCobroAt: new Date((factura.status_transitions?.paid_at ?? Date.now() / 1000) * 1000),
        estado: 'ACTIVA',
      },
    });
  }

  /** Primer cobro que se adelantó a la liga: se liga por la metadata de la suscripción. */
  private async cobroSinLigar(factura: any, subId: string): Promise<void> {
    const organizationId: string | undefined =
      factura.subscription_details?.metadata?.organizationId ??
      factura.parent?.subscription_details?.metadata?.organizationId;
    if (!organizationId) return;
    const s = await this.prisma.suscripcion.findUnique({ where: { organizationId } });
    if (!s || s.stripeSubscriptionId) return;
    await this.prisma.suscripcion.update({
      where: { organizationId },
      data: { stripeSubscriptionId: subId, stripeCustomerId: factura.customer ?? null },
    });
    await this.alCobrar(factura);
  }

  private async cambiarEstado(subId: string | null, estado: string): Promise<void> {
    if (!subId) return;
    await this.prisma.suscripcion.updateMany({ where: { stripeSubscriptionId: subId }, data: { estado } });
  }

  /**
   * Convierte la suscripción recién pagada en la escalera: el mes en curso
   * se queda en el escalón 1 y cada fase siguiente dura un mes. Al terminar
   * la última, Stripe suelta la suscripción y sigue cobrando el piso.
   */
  private async armarEscalera(subId: string, conFactura: boolean): Promise<string> {
    const { iva, precios } = await this.asegurarCatalogo();
    const items = (i: number) => [
      { price: precios[clavePrecio('base', i)], quantity: 1, tax_rates: [iva] },
      ...(conFactura ? [{ price: precios[clavePrecio('factura', i)], quantity: 1, tax_rates: [iva] }] : []),
    ];

    const sched = await this.api().pedir('POST', 'subscription_schedules', { from_subscription: subId });
    const actual = sched.phases[0];
    await this.api().pedir('POST', `subscription_schedules/${sched.id}`, {
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        { start_date: actual.start_date, end_date: actual.end_date, items: items(0) },
        ...Array.from({ length: MESES_ESCALERA - 1 }, (_, k) => ({ items: items(k + 1), iterations: 1 })),
      ],
    });
    return sched.id as string;
  }

  // ── Catálogo en Stripe ─────────────────────────────────────────────

  /**
   * Productos, precios e IVA en la cuenta de Stripe, creados la primera vez.
   * Los precios se buscan por lookup_key: si un monto cambia aquí, se crea
   * el precio nuevo y se queda con la clave; las suscripciones viejas siguen
   * con el suyo.
   */
  private asegurarCatalogo(): Promise<Catalogo> {
    this.catalogo ??= this.armarCatalogo().catch((err) => {
      this.catalogo = null;
      throw err;
    });
    return this.catalogo;
  }

  private async armarCatalogo(): Promise<Catalogo> {
    const api = this.api();

    for (const p of Object.values(PRODUCTOS)) {
      await api.pedir('GET', `products/${p.id}`).catch(async (err) => {
        if (err.status !== 404) throw err;
        await api.pedir('POST', 'products', { id: p.id, name: p.name, tax_code: 'txcd_10103001' });
      });
    }

    const tasas = await api.pedir('GET', 'tax_rates', { active: true, limit: 100 });
    const existente = tasas.data.find(
      (t: any) => t.percentage === IVA * 100 && t.inclusive === false && t.metadata?.jarvis === 'iva',
    );
    const iva =
      existente?.id ??
      (
        await api.pedir('POST', 'tax_rates', {
          display_name: 'IVA',
          percentage: IVA * 100,
          inclusive: false,
          country: 'MX',
          jurisdiction: 'MX',
          metadata: { jarvis: 'iva' },
        })
      ).id;

    const deseados = (['base', 'factura'] as const).flatMap((tipo) =>
      (tipo === 'base' ? ESCALONES_BASE : ESCALONES_FACTURA).map((monto, i) => ({
        tipo,
        clave: clavePrecio(tipo, i),
        centavos: monto * 100,
      })),
    );
    const hay = await api.pedir('GET', 'prices', { lookup_keys: deseados.map((d) => d.clave), limit: 100 });
    const precios: Record<string, string> = {};
    for (const d of deseados) {
      const p = hay.data.find((x: any) => x.lookup_key === d.clave);
      if (p && p.unit_amount === d.centavos && p.active) {
        precios[d.clave] = p.id;
        continue;
      }
      const nuevo = await api.pedir('POST', 'prices', {
        product: PRODUCTOS[d.tipo].id,
        currency: 'mxn',
        unit_amount: d.centavos,
        recurring: { interval: 'month' },
        tax_behavior: 'exclusive',
        lookup_key: d.clave,
        transfer_lookup_key: true,
        nickname: d.clave,
      });
      precios[d.clave] = nuevo.id;
    }
    return { iva, precios };
  }
}

/** La suscripción de un invoice, en la forma vieja y en la nueva de la API. */
function suscripcionDe(factura: any): string | null {
  return factura.subscription ?? factura.parent?.subscription_details?.subscription ?? null;
}
