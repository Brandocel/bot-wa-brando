import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Invoice, InvoicingSettings, Prisma } from '@prisma/client';
import { config } from '../../config';
import { OutboxDispatcher } from '../../infrastructure/persistence/outbox.dispatcher';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { cifrar, descifrar } from '../../infrastructure/facturacion/secretos';
import { pesos, type Renglon } from '../sales/pedido';
import {
  ErrorPac,
  FACTURACION_PORT,
  type CredencialesPac,
  type FacturacionPort,
  type Serie,
} from '../ports/facturacion.port';
import { MOTIVOS_CANCELACION } from './catalogos';
import { armarConceptos, type Concepto } from './conceptos';
import {
  erroresDeReceptor,
  errorDePago,
  normalizarNombre,
  normalizarRfc,
  tipoPersona,
  type MetodoPago,
  type Receptor,
} from './validacion';

/** Pedidos que ya son una venta: lo que se puede facturar. */
const VENDIDO = ['ACEPTADO', 'ENTREGADO'] as const;
/** Una factura en estos estados ya cubre el pedido: no se arma otra. */
const VIGENTE = ['POR_APROBAR', 'TIMBRANDO', 'TIMBRADA'] as const;

export type Propuesta =
  | { ok: true; factura: Invoice }
  | { ok: false; errores: string[] };

export interface NuevaFactura {
  organizationId: string;
  contactId: string;
  orderId: string;
  receptor: Receptor;
  formaPago: string;
  metodoPago?: MetodoPago;
  /** De dónde salieron los datos fiscales: el PDF del SAT o lo que dictó. */
  origen: 'CONSTANCIA' | 'MANUAL';
}

export interface ConfigFacturacion {
  enabled?: boolean;
  sandbox?: boolean;
  apiKey?: string;
  secretKey?: string;
  serieId?: number | null;
  lugarExpedicion?: string;
  fallbackEmail?: string;
  pricesIncludeTax?: boolean;
  ivaBasisPoints?: number;
  defaultProdCode?: string;
  defaultUnitCode?: string;
  deliveryProdCode?: string;
  maxDaysAfterSale?: number;
}

/**
 * Facturación de las ventas de cada empresa.
 *
 * El flujo tiene un paso humano a propósito: el bot ARMA y VALIDA la
 * factura, pero la empresa la aprueba antes de timbrar. Una factura
 * timbrada no se borra; cancelarla pasa por el SAT y a veces por la
 * aceptación del receptor. Con pocas facturas al mes, revisar cada una
 * cuesta segundos y evita ese trámite.
 */
@Injectable()
export class FacturacionService {
  private readonly logger = new Logger(FacturacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxDispatcher,
    @Inject(FACTURACION_PORT) private readonly pac: FacturacionPort,
  ) {}

  // ── Configuración ───────────────────────────────────────────────────

  /** Lo que el panel puede ver: nunca las llaves, solo si están puestas. */
  async verConfig(organizationId: string) {
    const s = await this.prisma.invoicingSettings.findUnique({ where: { organizationId } });
    const { apiKeyEnc, secretKeyEnc, ...resto } = s ?? porOmision(organizationId);
    return { ...resto, llavesCapturadas: !!apiKeyEnc && !!secretKeyEnc, cifradoDisponible: !!config.facturacionSecret };
  }

  async guardarConfig(organizationId: string, c: ConfigFacturacion) {
    const secreto = config.facturacionSecret;
    const actual = await this.prisma.invoicingSettings.findUnique({ where: { organizationId } });

    const datos: Prisma.InvoicingSettingsUncheckedCreateInput = {
      organizationId,
      enabled: c.enabled === true,
      sandbox: c.sandbox !== false,
      serieId: c.serieId == null ? null : Math.trunc(Number(c.serieId)) || null,
      lugarExpedicion: (c.lugarExpedicion ?? '').trim(),
      fallbackEmail: (c.fallbackEmail ?? '').trim(),
      pricesIncludeTax: c.pricesIncludeTax !== false,
      ivaBasisPoints: [0, 800, 1600].includes(Number(c.ivaBasisPoints)) ? Number(c.ivaBasisPoints) : 1600,
      defaultProdCode: (c.defaultProdCode ?? '').trim() || '01010101',
      defaultUnitCode: (c.defaultUnitCode ?? '').trim().toUpperCase() || 'H87',
      deliveryProdCode: (c.deliveryProdCode ?? '').trim() || '78102203',
      maxDaysAfterSale: Math.min(365, Math.max(1, Math.trunc(Number(c.maxDaysAfterSale) || 30))),
      apiKeyEnc: actual?.apiKeyEnc ?? null,
      secretKeyEnc: actual?.secretKeyEnc ?? null,
    };

    if (datos.lugarExpedicion && !/^\d{5}$/.test(datos.lugarExpedicion)) throw new Error('el lugar de expedición es un código postal de 5 dígitos');
    if ((datos.enabled || datos.fallbackEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.fallbackEmail!)) {
      throw new Error('captura el correo de la empresa: Factura.com lo pide para registrar a los clientes que no dan el suyo');
    }
    for (const [campo, valor] of [['clave de producto', datos.defaultProdCode], ['clave de envío', datos.deliveryProdCode]] as const) {
      if (!/^\d{8}$/.test(valor!)) throw new Error(`la ${campo} del SAT son 8 dígitos`);
    }

    // Las llaves solo se reemplazan si vienen; vacías = se quedan las de antes.
    if (c.apiKey?.trim() || c.secretKey?.trim()) {
      if (!secreto) throw new Error('falta FACTURACION_SECRET en el servidor: sin ella no se pueden guardar llaves');
      if (!c.apiKey?.trim() || !c.secretKey?.trim()) throw new Error('captura las dos llaves: API key y secret key');
      datos.apiKeyEnc = cifrar(c.apiKey.trim(), secreto);
      datos.secretKeyEnc = cifrar(c.secretKey.trim(), secreto);
    }

    if (datos.enabled && (!datos.apiKeyEnc || !datos.secretKeyEnc)) throw new Error('captura las llaves de Factura.com antes de activar');
    if (datos.enabled && !datos.serieId) throw new Error('elige la serie con la que se va a facturar');

    const { organizationId: _id, ...cambios } = datos;
    await this.prisma.invoicingSettings.upsert({ where: { organizationId }, create: datos, update: cambios });
    return this.verConfig(organizationId);
  }

  /** Prueba las llaves y devuelve las series de factura, para elegir una. */
  async probarConexion(organizationId: string): Promise<Serie[]> {
    const s = await this.prisma.invoicingSettings.findUnique({ where: { organizationId } });
    if (!s) throw new Error('primero guarda las llaves');
    const series = await this.pac.series(this.credenciales(s));
    return series.filter((x) => x.tipo === 'factura');
  }

  // ── Armar ───────────────────────────────────────────────────────────

  /**
   * Arma y valida la factura de un pedido y la deja POR_APROBAR. No timbra.
   * Devuelve los errores en palabras para el cliente si algo no cuadra.
   */
  async proponer(n: NuevaFactura): Promise<Propuesta> {
    const s = await this.prisma.invoicingSettings.findUnique({ where: { organizationId: n.organizationId } });
    if (!s?.enabled) return { ok: false, errores: ['Esta empresa todavía no factura por este medio.'] };

    const tipo = tipoPersona(n.receptor.rfc);
    const receptor: Receptor = {
      rfc: normalizarRfc(n.receptor.rfc),
      nombre: normalizarNombre(n.receptor.nombre, tipo),
      codigoPostal: n.receptor.codigoPostal.trim(),
      regimen: n.receptor.regimen.trim(),
      usoCfdi: n.receptor.usoCfdi.trim().toUpperCase(),
      email: n.receptor.email?.trim() || null,
    };
    const metodoPago = n.metodoPago ?? 'PUE';
    const errores = erroresDeReceptor(receptor);
    const errPago = errorDePago(n.formaPago, metodoPago);
    if (errPago) errores.push(errPago);
    if (errores.length) return { ok: false, errores };

    const orden = await this.prisma.order.findUnique({ where: { id: n.orderId } });
    if (!orden || orden.organizationId !== n.organizationId || orden.contactId !== n.contactId) {
      return { ok: false, errores: ['No encontré ese pedido.'] };
    }
    if (!(VENDIDO as readonly string[]).includes(orden.status)) {
      return { ok: false, errores: [`El pedido P-${orden.number} todavía no está aceptado; se factura cuando ya es una venta.`] };
    }
    const vendido = orden.submittedAt ?? orden.createdAt;
    if (Date.now() - vendido.getTime() > s.maxDaysAfterSale * 24 * 3600 * 1000) {
      return { ok: false, errores: [`El pedido P-${orden.number} ya pasó el plazo de ${s.maxDaysAfterSale} días para facturar.`] };
    }

    const renglones = (Array.isArray(orden.items) ? orden.items : []) as unknown as Renglon[];
    const productos = await this.prisma.product.findMany({
      where: { id: { in: renglones.map((r) => r.productId) }, organizationId: n.organizationId },
      select: { id: true, satProdCode: true, satUnitCode: true },
    });
    const armado = armarConceptos(
      renglones.map((r) => {
        const p = productos.find((x) => x.id === r.productId);
        return {
          nombre: r.nota ? `${r.nombre} (${r.nota})` : r.nombre,
          precioCents: r.precioCents,
          cantidad: r.cantidad,
          claveProdServ: p?.satProdCode,
          claveUnidad: p?.satUnitCode,
        };
      }),
      orden.deliveryCents,
      {
        preciosConIva: s.pricesIncludeTax,
        tasaIva: s.ivaBasisPoints / 10000,
        claveProdServ: s.defaultProdCode,
        claveUnidad: s.defaultUnitCode,
        claveProdServEnvio: s.deliveryProdCode,
      },
    );
    if (armado.conceptos.length === 0) return { ok: false, errores: ['El pedido no tiene nada que facturar.'] };

    // Perfil y factura en una transacción, y la revisión de "ya hay una"
    // dentro: dos "quiero factura" seguidos no deben armar dos.
    const factura = await this.prisma.$transaction(async (tx) => {
      const ya = await tx.invoice.findFirst({ where: { orderId: orden.id, status: { in: [...VIGENTE] } } });
      if (ya) return null;

      const perfil = await tx.fiscalProfile.upsert({
        where: { organizationId_contactId_rfc: { organizationId: n.organizationId, contactId: n.contactId, rfc: receptor.rfc } },
        create: {
          organizationId: n.organizationId, contactId: n.contactId, rfc: receptor.rfc, name: receptor.nombre,
          zip: receptor.codigoPostal, regimen: receptor.regimen, usoCfdi: receptor.usoCfdi, email: receptor.email, source: n.origen,
        },
        update: {
          name: receptor.nombre, zip: receptor.codigoPostal, regimen: receptor.regimen, usoCfdi: receptor.usoCfdi,
          email: receptor.email, source: n.origen,
        },
      });

      return tx.invoice.create({
        data: {
          organizationId: n.organizationId,
          contactId: n.contactId,
          conversationId: orden.conversationId,
          orderId: orden.id,
          fiscalProfileId: perfil.id,
          sandbox: s.sandbox,
          receptor: receptor as unknown as Prisma.InputJsonValue,
          concepts: armado.conceptos as unknown as Prisma.InputJsonValue,
          formaPago: n.formaPago,
          metodoPago,
          subtotalCents: armado.subtotalCents,
          ivaCents: armado.ivaCents,
          totalCents: armado.totalCents,
        },
      });
    });
    if (!factura) return { ok: false, errores: [`El pedido P-${orden.number} ya tiene una factura en curso.`] };
    return { ok: true, factura };
  }

  // ── Decidir ─────────────────────────────────────────────────────────

  /**
   * Timbra una factura aprobada y se la manda al cliente.
   *
   * El cambio a TIMBRANDO es condicional (solo desde POR_APROBAR o ERROR):
   * dos clics en "Aprobar" no timbran dos veces.
   */
  async aprobar(organizationId: string, invoiceId: string, por: string): Promise<Invoice> {
    const tomada = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, organizationId, status: { in: ['POR_APROBAR', 'ERROR'] } },
      data: { status: 'TIMBRANDO', decidedBy: por, error: null },
    });
    if (tomada.count === 0) throw new Error('esa factura ya no está por aprobar');

    const f = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const s = await this.prisma.invoicingSettings.findUnique({ where: { organizationId } });
    if (!s?.serieId) {
      return this.prisma.invoice.update({ where: { id: f.id }, data: { status: 'ERROR', error: 'No hay serie configurada.' } });
    }

    let timbrada: Invoice;
    try {
      const r = await this.pac.timbrar(this.credenciales(s), {
        receptor: f.receptor as unknown as Receptor,
        conceptos: f.concepts as unknown as Concepto[],
        serieId: s.serieId,
        formaPago: f.formaPago,
        metodoPago: f.metodoPago as MetodoPago,
        lugarExpedicion: s.lugarExpedicion || null,
        emailRespaldo: s.fallbackEmail || null,
        referencia: f.id,
      });
      timbrada = await this.prisma.invoice.update({
        where: { id: f.id },
        data: {
          status: 'TIMBRADA', providerUid: r.uidProveedor, uuid: r.uuid, serie: r.serie, folio: r.folio,
          stampedAt: new Date(), sandbox: s.sandbox,
        },
      });
    } catch (err) {
      const definitivo = !(err instanceof ErrorPac) || err.definitivo;
      const mensaje = err instanceof Error ? err.message : String(err);
      this.logger.warn(`factura ${f.id} no se timbró (${definitivo ? 'rechazo' : 'sin respuesta'}): ${mensaje}`);
      // Sin respuesta se queda en TIMBRANDO: pudo haberse timbrado, y
      // pasarla a ERROR invitaría a reintentar y duplicarla.
      return this.prisma.invoice.update({
        where: { id: f.id },
        data: { status: definitivo ? 'ERROR' : 'TIMBRANDO', error: mensaje.slice(0, 1000) },
      });
    }

    await this.entregar(timbrada).catch((err: unknown) =>
      this.logger.error(`factura ${timbrada.id} timbrada pero no se pudo mandar: ${String(err)}`));
    return timbrada;
  }

  async rechazar(organizationId: string, invoiceId: string, motivo: string, por: string): Promise<void> {
    const r = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, organizationId, status: { in: ['POR_APROBAR', 'ERROR'] } },
      data: { status: 'RECHAZADA', rejectReason: motivo, decidedBy: por },
    });
    if (r.count === 0) throw new Error('esa factura ya no está por aprobar');
    const f = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { order: { select: { number: true } } } });
    const pedido = f.order ? ` del pedido *P-${f.order.number}*` : '';
    await this.avisar(f.conversationId, `No pudimos emitir tu factura${pedido}: ${motivo}. Si quieres, mándame los datos corregidos.`);
  }

  /**
   * Una factura que se quedó en TIMBRANDO (el PAC no contestó). Alguien
   * revisó en Factura.com que NO se timbró, y la libera para reintentar.
   */
  async liberar(organizationId: string, invoiceId: string, por: string): Promise<void> {
    const r = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, organizationId, status: 'TIMBRANDO' },
      data: { status: 'ERROR', decidedBy: por, error: 'Revisado: no se timbró. Se puede reintentar.' },
    });
    if (r.count === 0) throw new Error('esa factura no está atorada');
  }

  async cancelar(organizationId: string, invoiceId: string, motivo: string, sustituto: string | null, por: string) {
    if (!MOTIVOS_CANCELACION[motivo]) throw new Error('motivo de cancelación no válido');
    if (motivo === '01' && !sustituto) throw new Error('con motivo 01 hace falta el UUID de la factura que la sustituye');

    const f = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!f || f.organizationId !== organizationId) throw new Error('no existe esa factura');
    if (f.status !== 'TIMBRADA' || !f.providerUid) throw new Error('solo se cancela una factura timbrada');

    const s = await this.prisma.invoicingSettings.findUniqueOrThrow({ where: { organizationId } });
    const r = await this.pac.cancelar(this.credenciales(s), f.providerUid, motivo, sustituto);
    if (r.estado === 'cancelada') {
      await this.prisma.invoice.update({
        where: { id: f.id },
        data: { status: 'CANCELADA', cancelMotivo: motivo, canceledAt: new Date(), decidedBy: por },
      });
    } else {
      // Se queda TIMBRADA hasta que el receptor acepte; se anota para verlo en el panel.
      await this.prisma.invoice.update({
        where: { id: f.id },
        data: { cancelMotivo: motivo, error: `Cancelación en proceso: ${r.detalle}`.slice(0, 1000), decidedBy: por },
      });
    }
    return r;
  }

  // ── Entregar ────────────────────────────────────────────────────────

  /** Manda el PDF y el XML por el mismo chat en que se pidió. */
  async entregar(f: Invoice): Promise<void> {
    if (!f.providerUid || !f.conversationId) return;
    const conv = await this.prisma.conversation.findUnique({ where: { id: f.conversationId }, select: { chatId: true } });
    if (!conv) return;
    const s = await this.prisma.invoicingSettings.findUniqueOrThrow({ where: { organizationId: f.organizationId } });
    const cred = this.credenciales(s);

    const [pdf, xml] = await Promise.all([
      this.pac.descargar(cred, f.providerUid, 'pdf'),
      this.pac.descargar(cred, f.providerUid, 'xml'),
    ]);
    const nombre = `Factura_${f.serie ?? ''}${f.folio ?? f.uuid?.slice(0, 8) ?? f.id}`;
    const prueba = f.sandbox ? '\n_(Factura de prueba: no tiene validez fiscal.)_' : '';

    await this.prisma.outboxMessage.createMany({
      data: [
        {
          chatId: conv.chatId,
          payload: {
            kind: 'file',
            base64: `data:application/pdf;base64,${pdf.toString('base64')}`,
            filename: `${nombre}.pdf`,
            caption: `Aquí está tu factura por ${pesos(f.totalCents)} 🧾${prueba}`,
            fallbackText: 'Tu factura ya quedó timbrada, pero no pude mandarte el PDF por aquí. Pídemela de nuevo en un rato.',
          },
        },
        {
          chatId: conv.chatId,
          payload: {
            kind: 'file',
            base64: `data:application/xml;base64,${xml.toString('base64')}`,
            filename: `${nombre}.xml`,
            fallbackText: null,
          },
        },
      ],
    });
    await this.outbox.drain();
  }

  // ── Interno ─────────────────────────────────────────────────────────

  private credenciales(s: InvoicingSettings): CredencialesPac {
    const secreto = config.facturacionSecret;
    if (!secreto) throw new Error('falta FACTURACION_SECRET en el servidor');
    if (!s.apiKeyEnc || !s.secretKeyEnc) throw new Error('la empresa no tiene llaves de Factura.com');
    return { apiKey: descifrar(s.apiKeyEnc, secreto), secretKey: descifrar(s.secretKeyEnc, secreto), sandbox: s.sandbox };
  }

  private async avisar(conversationId: string | null, texto: string): Promise<void> {
    if (!conversationId) return;
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { chatId: true } });
    if (!conv) return;
    await this.prisma.outboxMessage.create({ data: { chatId: conv.chatId, payload: { kind: 'text', text: texto } } });
    await this.outbox.drain();
  }
}

function porOmision(organizationId: string): InvoicingSettings {
  return {
    organizationId, enabled: false, sandbox: true, apiKeyEnc: null, secretKeyEnc: null, serieId: null,
    lugarExpedicion: '', fallbackEmail: '', pricesIncludeTax: true, ivaBasisPoints: 1600, defaultProdCode: '01010101',
    defaultUnitCode: 'H87', deliveryProdCode: '78102203', maxDaysAfterSale: 30, updatedAt: new Date(),
  };
}
