import { Injectable, Logger } from '@nestjs/common';
import type { InvoiceRequest, Prisma } from '@prisma/client';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { separarChat } from '../../domain/message/linea';
import { pesos } from '../sales/pedido';
import type { StrategyContext, StrategyReply } from '../support/support.strategy';
import { FORMAS_PAGO, regimen, usoCfdi } from './catalogos';
import { esConstancia, leerConstancia } from './constancia';
import {
  datosEnTexto,
  esNo,
  esSi,
  leerConceptos,
  leerCorreo,
  leerDatosEscritos,
  leerFormaPago,
  leerRegimen,
  leerUso,
  listaPagos,
  listaRegimenes,
  listaUsos,
  opcion,
  pideEmitirFactura,
  quiereSalir,
  usosPara,
  type ConceptoEscrito,
} from './factura-chat';
import { FacturacionService } from './facturacion.service';
import { errorDeRfc, erroresDeReceptor, normalizarNombre, tipoPersona, type Receptor } from './validacion';

const VIGENCIA_MS = 2 * 60 * 60 * 1000;
const MAX_INTENTOS = 3;

type Paso = 'EMPRESA' | 'DATOS' | 'REGIMEN' | 'USO' | 'CONCEPTOS' | 'PAGO' | 'TARJETA' | 'CORREO' | 'CONFIRMAR';

interface Datos {
  modo: 'empresa';
  organizationId?: string;
  empresa?: string;
  empresas?: Array<{ id: string; nombre: string }>;
  pricesIncludeTax?: boolean;
  receptor?: Partial<Receptor>;
  regimenes?: string[];
  origen?: 'CONSTANCIA' | 'MANUAL';
  conceptos?: ConceptoEscrito[];
  formaPago?: string;
  email?: string | null;
}

/**
 * Facturas que emite el PERSONAL de una empresa por WhatsApp.
 *
 * Un número autorizado con el permiso "puede facturar" escribe "factura
 * para…" y el bot le pide, una cosa a la vez: los datos fiscales de SU
 * cliente (Constancia en PDF, escritos, o solo el RFC si ya se le facturó),
 * el uso, qué se factura con su monto, cómo pagó y el correo del cliente.
 * Con su "sí" al resumen se timbra al momento y le llegan el PDF y el XML
 * para reenviárselos a su cliente.
 *
 * Igual que la plática del cliente final, no usa el modelo: lo dudoso se
 * vuelve a preguntar y todo se confirma antes de timbrar.
 */
@Injectable()
export class FacturaEquipoService {
  private readonly logger = new Logger(FacturaEquipoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
  ) {}

  /** null = este mensaje no es para emitir una factura y sigue su camino (documentos). */
  async atender(message: IncomingMessage, ctx: StrategyContext): Promise<StrategyReply | null> {
    const texto = message.body.trim();
    let req = await this.prisma.invoiceRequest.findUnique({ where: { conversationId: ctx.conversationId } });
    if (req && ((req.data as { modo?: string } | null)?.modo !== 'empresa' || req.expiresAt < new Date())) {
      if (req.expiresAt < new Date()) await this.borrar(ctx.conversationId);
      req = null;
    }

    if (!req) {
      if (!pideEmitirFactura(texto)) return null;
      return this.empezar(message, ctx);
    }

    if (quiereSalir(texto)) {
      await this.borrar(ctx.conversationId);
      return { text: 'Va, cancelé esa factura. Cuando quieras hacer otra, escríbeme "factura para…".', awaiting: 'NADIE' };
    }

    const pdf = message.attachment?.mimetype === 'application/pdf' ? message.attachment : null;
    const textoPdf = pdf ? await this.leerPdf(pdf.base64) : null;

    const datos = req.data as unknown as Datos;
    const r = await this.paso(req, datos, texto, textoPdf, message.senderId);
    if (r) return r;

    if (req.tries + 1 >= MAX_INTENTOS) {
      await this.borrar(ctx.conversationId);
      return { text: 'No logré entender los datos, así que dejé esa factura. Empieza otra con "factura para…" cuando quieras.', awaiting: 'NADIE' };
    }
    await this.prisma.invoiceRequest.update({ where: { conversationId: req.conversationId }, data: { tries: { increment: 1 } } });
    return { text: this.pregunta(req.step as Paso, datos, true), awaiting: 'CLIENTE' };
  }

  // ── Inicio ──────────────────────────────────────────────────────────

  private async empezar(message: IncomingMessage, ctx: StrategyContext): Promise<StrategyReply | null> {
    const ahora = new Date();
    const linea = separarChat(message.chatId).linea;
    const membresias = await this.prisma.membership.findMany({
      where: {
        contactId: ctx.contactId,
        revokedAt: null,
        OR: [{ validUntil: null }, { validUntil: { gt: ahora } }],
        organization: { active: true, ...(linea ? { waLineId: linea } : {}) },
      },
      select: {
        canInvoice: true,
        verifiedAt: true,
        organization: { select: { id: true, name: true, invoicing: { select: { enabled: true, pricesIncludeTax: true } } } },
      },
    });
    if (membresias.length === 0) return null;

    const pueden = membresias.filter((m) => m.canInvoice && m.verifiedAt && m.organization.invoicing?.enabled);
    if (pueden.length === 0) {
      const sinPermiso = membresias.every((m) => !m.canInvoice);
      return {
        text: sinPermiso
          ? 'Tu número no tiene permiso para emitir facturas. Pídele al administrador que te lo active en el panel (Directorio → tu número → "Puede facturar").'
          : 'Todavía no puedo facturar por ti: falta verificar tu número o activar la facturación de la empresa en el panel.',
        awaiting: 'NADIE',
      };
    }

    const datos: Datos = { modo: 'empresa', receptor: {} };
    let paso: Paso;
    if (pueden.length === 1) {
      const o = pueden[0]!.organization;
      datos.organizationId = o.id;
      datos.empresa = o.name;
      datos.pricesIncludeTax = o.invoicing?.pricesIncludeTax ?? true;
      paso = 'DATOS';
    } else {
      datos.empresas = pueden.map((m) => ({ id: m.organization.id, nombre: m.organization.name }));
      paso = 'EMPRESA';
    }

    // "factura para EKU9003173C9": si ya trae el RFC (o más datos), se aprovechan.
    const intro = datos.empresa ? `Va, hagamos una factura de *${datos.empresa}* 🧾` : 'Va, hagamos una factura 🧾';
    let aviso = '';
    if (datos.organizationId) {
      aviso = await this.aplicarEscritos(datos, message.body);
      paso = this.siguiente(datos);
    }

    await this.prisma.invoiceRequest.upsert({
      where: { conversationId: ctx.conversationId },
      create: {
        conversationId: ctx.conversationId, organizationId: datos.organizationId ?? pueden[0]!.organization.id, contactId: ctx.contactId,
        step: paso, data: datos as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + VIGENCIA_MS),
      },
      update: { step: paso, data: datos as unknown as Prisma.InputJsonValue, tries: 0, expiresAt: new Date(Date.now() + VIGENCIA_MS) },
    });
    return { text: [intro, aviso, this.pregunta(paso, datos)].filter(Boolean).join('\n\n'), awaiting: 'CLIENTE' };
  }

  // ── Pasos ───────────────────────────────────────────────────────────

  private async paso(req: InvoiceRequest, d: Datos, texto: string, textoPdf: string | null, waId: string): Promise<StrategyReply | null> {
    const paso = req.step as Paso;

    if (textoPdf && paso !== 'CONFIRMAR' && paso !== 'EMPRESA') {
      if (!esConstancia(textoPdf)) {
        return this.avanzar(req, d, paso, 'Ese PDF no parece una Constancia de Situación Fiscal 🤔');
      }
      const aviso = this.aplicarConstancia(d, textoPdf);
      return this.avanzar(req, d, this.siguiente(d), aviso);
    }

    switch (paso) {
      case 'EMPRESA': {
        const ops = d.empresas ?? [];
        const n = opcion(texto, ops.length);
        const elegida = n ? ops[n - 1] : ops.find((o) => normal(o.nombre).includes(normal(texto)) && normal(texto).length >= 3);
        if (!elegida) return null;
        const s = await this.prisma.invoicingSettings.findUnique({ where: { organizationId: elegida.id }, select: { pricesIncludeTax: true } });
        d.organizationId = elegida.id;
        d.empresa = elegida.nombre;
        d.pricesIncludeTax = s?.pricesIncludeTax ?? true;
        delete d.empresas;
        await this.prisma.invoiceRequest.update({ where: { conversationId: req.conversationId }, data: { organizationId: elegida.id } });
        return this.avanzar(req, d, this.siguiente(d), `Va, factura de *${elegida.nombre}*.`);
      }

      case 'DATOS': {
        const antes = JSON.stringify(d.receptor);
        const aviso = await this.aplicarEscritos(d, texto);
        if (JSON.stringify(d.receptor) === antes && !aviso) return null;
        return this.avanzar(req, d, this.siguiente(d), aviso);
      }

      case 'REGIMEN': {
        const ops = d.regimenes ?? [];
        const n = opcion(texto, ops.length);
        const reg = n ? ops[n - 1]! : leerRegimen(texto);
        if (!reg || !regimen(reg)) return null;
        d.receptor = { ...d.receptor, regimen: reg };
        return this.avanzar(req, d, this.siguiente(d));
      }

      case 'USO': {
        const uso = leerUso(texto, usosPara(d.receptor!.regimen!, d.receptor!.rfc!));
        if (!uso) return null;
        d.receptor = { ...d.receptor, usoCfdi: uso };
        return this.avanzar(req, d, this.siguiente(d));
      }

      case 'CONCEPTOS': {
        const c = leerConceptos(texto);
        if (!c) return null;
        d.conceptos = c;
        return this.avanzar(req, d, this.siguiente(d));
      }

      case 'PAGO': {
        const forma = leerFormaPago(texto);
        if (!forma) return null;
        if (forma === 'tarjeta') return this.avanzar(req, d, 'TARJETA');
        d.formaPago = forma;
        return this.avanzar(req, d, this.siguiente(d));
      }

      case 'TARJETA': {
        const forma = leerFormaPago(texto);
        const n = opcion(texto, 2);
        const elegida = n === 1 ? '28' : n === 2 ? '04' : forma === '28' || forma === '04' ? forma : null;
        if (!elegida) return null;
        d.formaPago = elegida;
        return this.avanzar(req, d, this.siguiente(d));
      }

      case 'CORREO': {
        const c = leerCorreo(texto);
        if (!c && esSi(texto)) return { text: '¿A qué correo de tu cliente? Escríbelo completo, por ejemplo nombre@gmail.com', awaiting: 'CLIENTE' };
        if (!c) return null;
        d.email = c === 'ninguno' ? null : c;
        return this.avanzar(req, d, 'CONFIRMAR');
      }

      case 'CONFIRMAR': {
        if (esNo(texto)) return this.avanzar(req, d, 'CONFIRMAR', '¿Qué corrijo? Mándame el dato nuevo (RFC, nombre, CP, régimen, conceptos o correo), o "cancelar" para dejarla.', true);
        if (!esSi(texto)) {
          // Un dato corregido directo en el resumen ("el CP es 77500", "Banquete $4,000").
          const antes = JSON.stringify(d);
          await this.aplicarEscritos(d, texto);
          const conceptos = leerConceptos(texto);
          if (conceptos) d.conceptos = conceptos;
          if (JSON.stringify(d) === antes) return null;
          return this.avanzar(req, d, this.siguiente(d), 'Corregido.');
        }
        return this.timbrar(req, d, waId);
      }
    }
  }

  private async timbrar(req: InvoiceRequest, d: Datos, waId: string): Promise<StrategyReply> {
    const r = await this.facturacion.facturarLibre({
      organizationId: d.organizationId!,
      contactId: req.contactId,
      conversationId: req.conversationId,
      por: `whatsapp:${waId.replace(/@.*$/, '')}`,
      receptor: { ...(d.receptor as Receptor), email: d.email ?? null },
      conceptos: d.conceptos ?? [],
      formaPago: d.formaPago!,
      origen: d.origen ?? 'MANUAL',
    });

    if (!r.ok) return this.avanzar(req, d, 'CONFIRMAR', `No la pude timbrar:\n• ${r.errores.join('\n• ')}\n\nCorrige el dato y te la vuelvo a mostrar.`, true);

    const f = r.factura;
    if (f.status === 'TIMBRADA') {
      await this.borrar(req.conversationId);
      const folio = `${f.serie ?? ''}${f.folio ?? ''}`;
      return {
        text: `✅ Timbrada${folio ? ` *${folio}*` : ''} por ${pesos(f.totalCents)}.\nUUID: ${f.uuid}\n\n` +
          `Ahorita te llegan el PDF y el XML para que se los reenvíes a tu cliente` +
          (d.email ? ` (también le llegan por correo a ${d.email}).` : '.') +
          (f.sandbox ? '\n_(Modo prueba: no tiene validez fiscal.)_' : ''),
        awaiting: 'NADIE',
      };
    }
    if (f.status === 'TIMBRANDO') {
      await this.borrar(req.conversationId);
      return {
        text: '⚠️ El sistema de facturación no contestó y no sé si alcanzó a timbrarse. No la vuelvas a pedir todavía: revísala en el panel (Ventas → Facturas).',
        awaiting: 'AGENTE',
      };
    }
    // Rechazo del SAT o del PAC: se queda en el resumen para corregir.
    this.logger.warn(`factura de equipo rechazada ${f.id}: ${f.error}`);
    await this.prisma.invoice.update({ where: { id: f.id }, data: { status: 'RECHAZADA', rejectReason: 'reintento desde WhatsApp' } });
    return this.avanzar(req, d, 'CONFIRMAR', `El SAT la rechazó:\n${f.error ?? 'sin detalle'}\n\nCorrige el dato y te la vuelvo a mostrar.`, true);
  }

  // ── Apoyo ───────────────────────────────────────────────────────────

  private siguiente(d: Datos): Paso {
    if (!d.organizationId) return 'EMPRESA';
    const r = d.receptor ?? {};
    if (!r.rfc || !r.nombre || !r.codigoPostal) return 'DATOS';
    if (!r.regimen) return (d.regimenes?.length ?? 0) > 1 ? 'REGIMEN' : 'DATOS';
    if (!r.usoCfdi) {
      const usos = usosPara(r.regimen, r.rfc);
      if (usos.length === 1) r.usoCfdi = usos[0]!.clave;
      else return 'USO';
    }
    if (!d.conceptos?.length) return 'CONCEPTOS';
    if (!d.formaPago) return 'PAGO';
    if (d.email === undefined) return 'CORREO';
    return 'CONFIRMAR';
  }

  private async avanzar(req: InvoiceRequest, d: Datos, paso: Paso, aviso = '', soloAviso = false): Promise<StrategyReply> {
    if (d.receptor?.nombre && d.receptor.rfc) d.receptor.nombre = normalizarNombre(d.receptor.nombre, tipoPersona(d.receptor.rfc));
    if (paso === 'CONFIRMAR' && !soloAviso) {
      const errores = erroresDeReceptor({ ...(d.receptor as Receptor), email: d.email ?? null });
      if (errores.length) {
        d.receptor = { ...d.receptor, usoCfdi: undefined };
        paso = 'USO';
        aviso = [aviso, ...errores].filter(Boolean).join('\n');
      }
    }
    await this.prisma.invoiceRequest.update({
      where: { conversationId: req.conversationId },
      data: { step: paso, data: d as unknown as Prisma.InputJsonValue, tries: 0, expiresAt: new Date(Date.now() + VIGENCIA_MS) },
    });
    return { text: soloAviso ? aviso : [aviso, this.pregunta(paso, d)].filter(Boolean).join('\n\n'), awaiting: 'CLIENTE' };
  }

  private pregunta(paso: Paso, d: Datos, otraVez = false): string {
    const r = d.receptor ?? {};
    const perdon = otraVez ? 'Perdón, no te entendí. ' : '';
    const iva = d.pricesIncludeTax === false ? 'antes de IVA' : 'con IVA incluido';
    switch (paso) {
      case 'EMPRESA':
        return `${perdon}¿De qué empresa es la factura?\n${(d.empresas ?? []).map((o, i) => `${i + 1}. ${o.nombre}`).join('\n')}`;
      case 'DATOS': {
        const faltan = [
          !r.rfc && 'RFC',
          !r.nombre && 'nombre o razón social',
          !r.codigoPostal && 'código postal fiscal',
          !r.regimen && 'régimen fiscal',
        ].filter(Boolean) as string[];
        if (faltan.length === 4) {
          return `${perdon}¿A quién le facturo? Mándame la *Constancia de Situación Fiscal* de tu cliente en PDF, ` +
            'o escríbeme su RFC, nombre o razón social, código postal y régimen. Si ya le facturaste antes, con el RFC basta.';
        }
        return `${perdon}De tu cliente me falta: ${faltan.join(', ')}.`;
      }
      case 'REGIMEN':
        return `${perdon}Tu cliente tiene varios regímenes. ¿Con cuál?\n${listaRegimenes(d.regimenes ?? [])}`;
      case 'USO':
        return `${perdon}¿Qué uso le da tu cliente a la factura?\n${listaUsos(usosPara(r.regimen!, r.rfc!))}\n\nSi no sabe, casi siempre es *Gastos en general*.`;
      case 'CONCEPTOS':
        return `${perdon}¿Qué le facturas? Un renglón por concepto, con el monto al final (${iva}):\n` +
          '_Banquete 50 personas $3,500_\n_2 x Pollo entero $255_';
      case 'PAGO':
        return `${perdon}¿Cómo pagó tu cliente?\n${listaPagos()}`;
      case 'TARJETA':
        return `${perdon}¿Fue tarjeta de débito o de crédito?\n1. Débito\n2. Crédito`;
      case 'CORREO':
        return `${perdon}¿Se la mando también al correo de tu cliente? Escríbelo, o dime *no*.`;
      case 'CONFIRMAR': {
        const total = (d.conceptos ?? []).reduce((n, c) => n + c.precioCents * c.cantidad, 0);
        return `Revisa la factura de *${d.empresa}*:\n${datosEnTexto(r)}\n` +
          `• Uso: ${usoCfdi(r.usoCfdi ?? '')?.nombre ?? r.usoCfdi} (${r.usoCfdi})\n` +
          (d.conceptos ?? []).map((c) => `• ${c.cantidad > 1 ? `${c.cantidad} × ` : ''}${c.descripcion} — ${pesos(c.precioCents * c.cantidad)}`).join('\n') +
          `\n*Total: ${pesos(total)}* (${iva})\n` +
          `• Pago: ${FORMAS_PAGO[d.formaPago ?? ''] ?? d.formaPago}\n` +
          `• Correo del cliente: ${d.email ?? 'no'}\n\n` +
          '¿La timbro? Responde *sí* o *no*.';
      }
    }
  }

  /** Datos escritos (RFC, nombre, CP, régimen, correo) y, con el RFC, lo que ya se sabía de ese cliente. */
  private async aplicarEscritos(d: Datos, texto: string): Promise<string> {
    const e = leerDatosEscritos(texto);
    const r = { ...d.receptor };
    let aviso = '';
    if (e.rfc) {
      const err = errorDeRfc(e.rfc);
      if (err) aviso = err;
      else r.rfc = e.rfc;
    }
    if (e.nombre) r.nombre = e.nombre;
    if (e.codigoPostal) r.codigoPostal = e.codigoPostal;
    if (e.regimen) r.regimen = e.regimen;
    if (e.email) d.email = e.email;
    if (e.rfc || e.nombre || e.codigoPostal || e.regimen) d.origen = d.origen ?? 'MANUAL';

    // Con solo el RFC de un cliente que ya se facturó, se completa lo demás.
    if (r.rfc && d.organizationId && (!r.nombre || !r.codigoPostal || !r.regimen)) {
      const p = await this.facturacion.perfilPorRfc(d.organizationId, r.rfc);
      if (p) {
        r.nombre ??= p.name;
        r.codigoPostal ??= p.zip;
        r.regimen ??= p.regimen;
        r.usoCfdi ??= p.usoCfdi;
        if (d.email === undefined && p.email) d.email = p.email;
        aviso = aviso || `Ya tengo a *${p.name}* de una factura anterior 👍`;
      }
    }
    d.receptor = r;
    return aviso;
  }

  private aplicarConstancia(d: Datos, texto: string): string {
    const c = leerConstancia(texto);
    d.origen = 'CONSTANCIA';
    d.receptor = {
      ...(c.rfc ? { rfc: c.rfc } : {}),
      ...(c.nombre ? { nombre: c.nombre } : {}),
      ...(c.codigoPostal ? { codigoPostal: c.codigoPostal } : {}),
      regimen: c.regimenes.length === 1 ? c.regimenes[0] : undefined,
    };
    d.regimenes = c.regimenes;
    const leidos = [c.rfc, c.nombre, c.codigoPostal].filter(Boolean).length;
    return leidos === 3 ? 'Ya leí la Constancia de tu cliente 👍' : 'Leí la Constancia, pero no saqué todo.';
  }

  private async leerPdf(base64: string): Promise<string | null> {
    try {
      const r = await pdfParse(Buffer.from(base64, 'base64'), { max: 3 });
      return r.text ?? null;
    } catch (err) {
      this.logger.warn(`no se pudo leer el PDF: ${String(err)}`);
      return null;
    }
  }

  private async borrar(conversationId: string): Promise<void> {
    await this.prisma.invoiceRequest.deleteMany({ where: { conversationId } });
  }
}

function normal(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
