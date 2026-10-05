import { Injectable, Logger } from '@nestjs/common';
import type { InvoiceRequest, Prisma } from '@prisma/client';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { pesos } from '../sales/pedido';
import type { StrategyContext, StrategyReply } from '../support/support.strategy';
import { FORMAS_PAGO, regimen, usoCfdi } from './catalogos';
import { esConstancia, leerConstancia } from './constancia';
import {
  datosEnTexto,
  esNo,
  esSi,
  leerCorreo,
  leerDatosEscritos,
  leerFormaPago,
  leerRegimen,
  leerUso,
  listaPagos,
  listaRegimenes,
  listaUsos,
  numeroDePedido,
  opcion,
  pideFactura,
  quiereSalir,
  usosPara,
} from './factura-chat';
import { FacturacionService } from './facturacion.service';
import { errorDeRfc, erroresDeReceptor, normalizarNombre, tipoPersona, type Receptor } from './validacion';

/** Una plática de factura sin terminar caduca: el cliente pudo irse. */
const VIGENCIA_MS = 24 * 60 * 60 * 1000;
const MAX_INTENTOS = 3;
const VENDIDO = ['ACEPTADO', 'ENTREGADO'] as const;

type Paso = 'PEDIDO' | 'PERFIL' | 'DATOS' | 'REGIMEN' | 'USO' | 'PAGO' | 'TARJETA' | 'CORREO' | 'CONFIRMAR';

interface Datos {
  orderId?: string;
  pedido?: { number: number; totalCents: number };
  opciones?: Array<{ id: string; number: number; totalCents: number }>;
  receptor?: Partial<Receptor>;
  regimenes?: string[];
  origen?: 'CONSTANCIA' | 'MANUAL';
  formaPago?: string;
  /** null = no quiso correo; undefined = no se ha preguntado. */
  email?: string | null;
}

interface Negocio {
  organizationId: string;
  nombre: string;
}

/**
 * La plática de "quiero factura" por la línea de una empresa.
 *
 * Son preguntas cerradas, una a la vez: qué compra, sus datos fiscales (de
 * preferencia la Constancia en PDF, que es lo que el SAT compara), el uso
 * del CFDI, cómo pagó y a qué correo. Al final se le enseña todo y solo
 * con su "sí" se arma la factura, que la empresa aprueba antes de timbrar.
 *
 * No usa el modelo: cada respuesta se lee con reglas, y lo que no se
 * entiende con certeza se vuelve a preguntar. Facturar con un RFC mal
 * leído es peor que una pregunta de más.
 */
@Injectable()
export class FacturaChatService {
  private readonly logger = new Logger(FacturaChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
  ) {}

  /** null = este mensaje no es de factura y sigue a la venta. */
  async atender(message: IncomingMessage, ctx: StrategyContext, negocio: Negocio): Promise<StrategyReply | null> {
    const texto = message.body.trim();
    let req = await this.prisma.invoiceRequest.findUnique({ where: { conversationId: ctx.conversationId } });
    // Una factura que está emitiendo el personal de la empresa no es de esta plática.
    if ((req?.data as { modo?: string } | null)?.modo === 'empresa') return null;
    if (req && req.expiresAt < new Date()) {
      await this.borrar(ctx.conversationId);
      req = null;
    }

    const pdf = message.attachment?.mimetype === 'application/pdf' ? message.attachment : null;
    const textoPdf = pdf ? await this.leerPdf(pdf.base64) : null;
    const traeConstancia = !!textoPdf && esConstancia(textoPdf);

    if (!req) {
      if (!pideFactura(texto) && !traeConstancia) return null;
      return this.empezar(ctx, negocio, traeConstancia ? textoPdf : null);
    }

    if (quiereSalir(texto)) {
      await this.borrar(ctx.conversationId);
      return { text: 'Va, dejamos la factura por ahora. Si la necesitas después, solo dime "quiero factura" 🙂', awaiting: 'CLIENTE' };
    }

    const datos = (req.data ?? {}) as Datos;
    const r = await this.paso(req, datos, texto, textoPdf, negocio);
    if (r) return r;

    // No se entendió la respuesta.
    if (req.tries + 1 >= MAX_INTENTOS) {
      await this.borrar(ctx.conversationId);
      return {
        text: 'Perdón, no logré entender los datos 🙏 Le pido a alguien del equipo que te ayude con tu factura por aquí.',
        awaiting: 'AGENTE',
      };
    }
    await this.prisma.invoiceRequest.update({ where: { conversationId: req.conversationId }, data: { tries: { increment: 1 } } });
    return { text: this.pregunta(req.step as Paso, datos, true), awaiting: 'CLIENTE' };
  }

  // ── Inicio ──────────────────────────────────────────────────────────

  private async empezar(ctx: StrategyContext, negocio: Negocio, textoConstancia: string | null): Promise<StrategyReply> {
    const s = await this.prisma.invoicingSettings.findUnique({ where: { organizationId: negocio.organizationId } });
    if (!s?.enabled) {
      return {
        text: `Por ahora no puedo hacer facturas por aquí 🙏 Le aviso a ${negocio.nombre} para que te ayude con ella.`,
        awaiting: 'AGENTE',
      };
    }

    const desde = new Date(Date.now() - s.maxDaysAfterSale * 24 * 3600 * 1000);
    const ordenes = await this.prisma.order.findMany({
      where: {
        organizationId: negocio.organizationId,
        contactId: ctx.contactId,
        status: { in: [...VENDIDO, 'POR_ACEPTAR'] },
        createdAt: { gte: desde },
        invoices: { none: { status: { in: ['POR_APROBAR', 'TIMBRANDO', 'TIMBRADA'] } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, number: true, totalCents: true, status: true },
    });
    const vendidas = ordenes.filter((o) => (VENDIDO as readonly string[]).includes(o.status));

    if (vendidas.length === 0) {
      const pendiente = ordenes.find((o) => o.status === 'POR_ACEPTAR');
      return {
        text: pendiente
          ? `Tu pedido *P-${pendiente.number}* todavía está por aceptarse. En cuanto ${negocio.nombre} lo acepte, me pides la factura y te la preparo 🙂`
          // También es la respuesta a "¿dan factura?" antes de comprar.
          : `Sí damos factura 🧾 Se pide hasta ${s.maxDaysAfterSale} días después de la compra. ` +
            'No veo una compra tuya pendiente de facturar: cuando tengas tu pedido aceptado, me dices "quiero factura" y te la preparo.',
        awaiting: 'CLIENTE',
      };
    }

    const datos: Datos = {};
    if (vendidas.length === 1) {
      datos.orderId = vendidas[0]!.id;
      datos.pedido = { number: vendidas[0]!.number, totalCents: vendidas[0]!.totalCents };
    } else {
      datos.opciones = vendidas.map((o) => ({ id: o.id, number: o.number, totalCents: o.totalCents }));
    }

    // Llegó la Constancia de entrada: ya se tienen los datos.
    let paso: Paso;
    let aviso = '';
    if (textoConstancia) {
      aviso = this.aplicarConstancia(datos, textoConstancia);
      paso = datos.orderId ? this.siguienteDeDatos(datos) : 'PEDIDO';
    } else if (!datos.orderId) {
      paso = 'PEDIDO';
    } else {
      paso = (await this.cargarPerfil(datos, negocio.organizationId, ctx.contactId)) ? 'PERFIL' : 'DATOS';
    }

    await this.prisma.invoiceRequest.upsert({
      where: { conversationId: ctx.conversationId },
      create: {
        conversationId: ctx.conversationId, organizationId: negocio.organizationId, contactId: ctx.contactId,
        step: paso, data: datos as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + VIGENCIA_MS),
      },
      update: { step: paso, data: datos as Prisma.InputJsonValue, tries: 0, expiresAt: new Date(Date.now() + VIGENCIA_MS) },
    });

    const intro = datos.pedido
      ? `Claro, te preparo la factura de tu pedido *P-${datos.pedido.number}* (${pesos(datos.pedido.totalCents)}) 🧾`
      : 'Claro, te preparo la factura 🧾';
    return { text: [intro, aviso, this.pregunta(paso, datos)].filter(Boolean).join('\n\n'), awaiting: 'CLIENTE' };
  }

  // ── Pasos ───────────────────────────────────────────────────────────

  /** Aplica la respuesta al paso actual. null = no se entendió. */
  private async paso(req: InvoiceRequest, d: Datos, texto: string, textoPdf: string | null, negocio: Negocio): Promise<StrategyReply | null> {
    const paso = req.step as Paso;
    let aviso = '';

    // Una Constancia vale en cualquier paso antes de confirmar: es la mejor fuente.
    if (textoPdf && paso !== 'CONFIRMAR') {
      if (!esConstancia(textoPdf)) {
        return this.avanzar(req, d, paso, 'Ese PDF no parece tu Constancia de Situación Fiscal 🤔 La descargas en sat.gob.mx (o en la app SAT Móvil).');
      }
      aviso = this.aplicarConstancia(d, textoPdf);
      return this.avanzar(req, d, d.orderId ? this.siguienteDeDatos(d) : 'PEDIDO', aviso);
    }

    switch (paso) {
      case 'PEDIDO': {
        const ops = d.opciones ?? [];
        const n = opcion(texto, ops.length);
        const num = n ? ops[n - 1]!.number : numeroDePedido(texto);
        const elegido = ops.find((o) => o.number === num);
        if (!elegido) return null;
        d.orderId = elegido.id;
        d.pedido = { number: elegido.number, totalCents: elegido.totalCents };
        delete d.opciones;
        if (d.receptor?.rfc) return this.avanzar(req, d, this.siguienteDeDatos(d));
        const hayPerfil = await this.cargarPerfil(d, negocio.organizationId, req.contactId);
        return this.avanzar(req, d, hayPerfil ? 'PERFIL' : 'DATOS');
      }

      case 'PERFIL': {
        if (esSi(texto)) return this.avanzar(req, d, this.siguienteDeDatos(d));
        if (esNo(texto)) {
          d.receptor = {};
          d.regimenes = undefined;
          delete d.email;
          return this.avanzar(req, d, 'DATOS');
        }
        return null;
      }

      case 'DATOS': {
        const e = leerDatosEscritos(texto);
        if (!e.rfc && !e.nombre && !e.codigoPostal && !e.regimen && !e.email) return null;
        d.receptor = {
          ...d.receptor,
          ...(e.rfc ? { rfc: e.rfc } : {}),
          ...(e.nombre ? { nombre: e.nombre } : {}),
          ...(e.codigoPostal ? { codigoPostal: e.codigoPostal } : {}),
          ...(e.regimen ? { regimen: e.regimen } : {}),
        };
        if (e.email) d.email = e.email;
        d.origen = d.origen ?? 'MANUAL';
        const errRfc = d.receptor.rfc ? errorDeRfc(d.receptor.rfc) : null;
        if (errRfc) {
          delete d.receptor.rfc;
          aviso = errRfc;
        }
        return this.avanzar(req, d, this.siguienteDeDatos(d), aviso);
      }

      case 'REGIMEN': {
        const ops = d.regimenes ?? [];
        const n = opcion(texto, ops.length);
        const reg = n ? ops[n - 1]! : leerRegimen(texto);
        if (!reg || !regimen(reg)) return null;
        d.receptor = { ...d.receptor, regimen: reg };
        return this.avanzar(req, d, this.siguienteDeDatos(d));
      }

      case 'USO': {
        const uso = leerUso(texto, usosPara(d.receptor!.regimen!, d.receptor!.rfc!));
        if (!uso) return null;
        d.receptor = { ...d.receptor, usoCfdi: uso };
        return this.avanzar(req, d, this.siguienteDeDatos(d));
      }

      case 'PAGO': {
        const forma = leerFormaPago(texto);
        if (!forma) return null;
        if (forma === 'tarjeta') return this.avanzar(req, d, 'TARJETA');
        d.formaPago = forma;
        return this.avanzar(req, d, this.siguienteDeDatos(d));
      }

      case 'TARJETA': {
        const forma = leerFormaPago(texto);
        const n = opcion(texto, 2);
        const elegida = n === 1 ? '28' : n === 2 ? '04' : forma === '28' || forma === '04' ? forma : null;
        if (!elegida) return null;
        d.formaPago = elegida;
        return this.avanzar(req, d, this.siguienteDeDatos(d));
      }

      case 'CORREO': {
        const c = leerCorreo(texto);
        // "Simón", "sí porfa": quiere correo pero no lo escribió.
        if (!c && esSi(texto)) {
          return { text: '¿A qué correo te la mando? Escríbelo completo, por ejemplo nombre@gmail.com', awaiting: 'CLIENTE' };
        }
        if (!c) return null;
        d.email = c === 'ninguno' ? null : c;
        return this.avanzar(req, d, 'CONFIRMAR');
      }

      case 'CONFIRMAR': {
        if (esNo(texto)) {
          d.receptor = {};
          d.regimenes = undefined;
          delete d.formaPago;
          return this.avanzar(req, d, 'DATOS', 'Va, corregimos.');
        }
        if (!esSi(texto)) return null;
        return this.confirmar(req, d, negocio);
      }
    }
  }

  private async confirmar(req: InvoiceRequest, d: Datos, negocio: Negocio): Promise<StrategyReply> {
    const r = await this.facturacion.proponer({
      organizationId: req.organizationId,
      contactId: req.contactId,
      orderId: d.orderId!,
      receptor: { ...(d.receptor as Receptor), email: d.email ?? null },
      formaPago: d.formaPago!,
      metodoPago: 'PUE',
      origen: d.origen ?? 'MANUAL',
    });

    if (!r.ok) {
      this.logger.warn(`factura no armada para ${req.conversationId}: ${r.errores.join(' | ')}`);
      d.receptor = {};
      d.regimenes = undefined;
      delete d.formaPago;
      return this.avanzar(req, d, 'DATOS', `No pude armarla:\n• ${r.errores.join('\n• ')}`);
    }

    await this.borrar(req.conversationId);
    return {
      text: `¡Listo! ✅ Tu factura quedó en revisión con ${negocio.nombre}. En cuanto la aprueben te llega aquí mismo en PDF y XML.`,
      awaiting: 'CLIENTE',
    };
  }

  // ── Apoyo ───────────────────────────────────────────────────────────

  /** Qué falta después de tener (o corregir) datos, en orden. */
  private siguienteDeDatos(d: Datos): Paso {
    if (!d.orderId) return 'PEDIDO';
    const r = d.receptor ?? {};
    if (!r.rfc || !r.nombre || !r.codigoPostal) return 'DATOS';
    if (!r.regimen) return (d.regimenes?.length ?? 0) > 1 ? 'REGIMEN' : 'DATOS';
    if (!r.usoCfdi) {
      const usos = usosPara(r.regimen, r.rfc);
      if (usos.length === 1) r.usoCfdi = usos[0]!.clave;
      else return 'USO';
    }
    if (!d.formaPago) return 'PAGO';
    if (d.email === undefined) return 'CORREO';
    return 'CONFIRMAR';
  }

  private async avanzar(req: InvoiceRequest, d: Datos, paso: Paso, aviso = ''): Promise<StrategyReply> {
    // El nombre se le enseña como irá en la factura ("ACME SA DE CV" → "ACME").
    if (d.receptor?.nombre && d.receptor.rfc) d.receptor.nombre = normalizarNombre(d.receptor.nombre, tipoPersona(d.receptor.rfc));
    // Antes de confirmar se valida todo junto: un uso que no va con el
    // régimen se detecta aquí y no en el SAT.
    if (paso === 'CONFIRMAR') {
      const errores = erroresDeReceptor({ ...(d.receptor as Receptor), email: d.email ?? null });
      if (errores.length) {
        d.receptor = { ...d.receptor, usoCfdi: undefined };
        paso = 'USO';
        aviso = [aviso, ...errores].filter(Boolean).join('\n');
      }
    }
    await this.prisma.invoiceRequest.update({
      where: { conversationId: req.conversationId },
      data: { step: paso, data: d as Prisma.InputJsonValue, tries: 0, expiresAt: new Date(Date.now() + VIGENCIA_MS) },
    });
    return { text: [aviso, this.pregunta(paso, d)].filter(Boolean).join('\n\n'), awaiting: 'CLIENTE' };
  }

  private pregunta(paso: Paso, d: Datos, otraVez = false): string {
    const r = d.receptor ?? {};
    const perdon = otraVez ? 'Perdón, no te entendí. ' : '';
    switch (paso) {
      case 'PEDIDO':
        return `${perdon}¿De cuál pedido es la factura?\n` +
          (d.opciones ?? []).map((o, i) => `${i + 1}. P-${o.number} — ${pesos(o.totalCents)}`).join('\n');
      case 'PERFIL':
        return `${perdon}¿La hago con los mismos datos de la vez pasada?\n${datosEnTexto(r)}` +
          (r.usoCfdi ? `\n• Uso: ${usoCfdi(r.usoCfdi)?.nombre ?? r.usoCfdi}` : '') + '\n\nResponde *sí* o *no*.';
      case 'DATOS': {
        const faltan = [
          !r.rfc && 'RFC',
          !r.nombre && 'nombre o razón social (tal como sale en tu Constancia)',
          !r.codigoPostal && 'código postal fiscal',
          !r.regimen && 'régimen fiscal',
        ].filter(Boolean) as string[];
        if (faltan.length === 4) {
          return `${perdon}Mándame tu *Constancia de Situación Fiscal* en PDF y saco tus datos de ahí. ` +
            'Si no la tienes a la mano, escríbeme tu RFC, nombre o razón social, código postal y régimen fiscal.';
        }
        return `${perdon}Me falta: ${faltan.join(', ')}. Escríbemelo, o mándame tu Constancia en PDF.`;
      }
      case 'REGIMEN':
        return `${perdon}Tienes varios regímenes. ¿Con cuál facturo?\n${listaRegimenes(d.regimenes ?? [])}`;
      case 'USO':
        return `${perdon}¿Para qué vas a usar la factura? (uso del CFDI)\n${listaUsos(usosPara(r.regimen!, r.rfc!))}\n\nSi no sabes, casi siempre es *Gastos en general*.`;
      case 'PAGO':
        return `${perdon}¿Cómo pagaste?\n${listaPagos()}`;
      case 'TARJETA':
        return `${perdon}¿Fue tarjeta de débito o de crédito?\n1. Débito\n2. Crédito`;
      case 'CORREO':
        return `${perdon}¿Te la mando también a tu correo? Escríbelo, o dime *no* y solo te llega por aquí.`;
      case 'CONFIRMAR':
        return 'Revisa que esté bien:\n' +
          (d.pedido ? `• Pedido: P-${d.pedido.number} — ${pesos(d.pedido.totalCents)}\n` : '') +
          `${datosEnTexto(r)}\n` +
          `• Uso: ${usoCfdi(r.usoCfdi ?? '')?.nombre ?? r.usoCfdi} (${r.usoCfdi})\n` +
          `• Pago: ${FORMAS_PAGO[d.formaPago ?? ''] ?? d.formaPago}\n` +
          `• Correo: ${d.email ?? 'solo por WhatsApp'}\n\n` +
          '¿Así la pido? Responde *sí* o *no*.';
    }
  }

  /** Datos de la Constancia al pedido; devuelve qué decirle si faltó algo. */
  private aplicarConstancia(d: Datos, texto: string): string {
    const c = leerConstancia(texto);
    d.origen = 'CONSTANCIA';
    d.receptor = {
      ...d.receptor,
      ...(c.rfc ? { rfc: c.rfc } : {}),
      ...(c.nombre ? { nombre: c.nombre } : {}),
      ...(c.codigoPostal ? { codigoPostal: c.codigoPostal } : {}),
      regimen: c.regimenes.length === 1 ? c.regimenes[0] : d.receptor?.regimen,
      usoCfdi: undefined,
    };
    d.regimenes = c.regimenes;
    const leidos = [c.rfc, c.nombre, c.codigoPostal].filter(Boolean).length;
    return leidos === 3 ? 'Ya leí tu Constancia 👍' : 'Leí tu Constancia, pero no saqué todo.';
  }

  /** El último perfil fiscal del cliente con esta empresa, para no pedirlo otra vez. */
  private async cargarPerfil(d: Datos, organizationId: string, contactId: string): Promise<boolean> {
    const p = await this.prisma.fiscalProfile.findFirst({
      where: { organizationId, contactId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!p) return false;
    d.receptor = {
      rfc: p.rfc, nombre: normalizarNombre(p.name, tipoPersona(p.rfc)), codigoPostal: p.zip, regimen: p.regimen, usoCfdi: p.usoCfdi,
    };
    d.origen = p.source === 'CONSTANCIA' ? 'CONSTANCIA' : 'MANUAL';
    if (p.email) d.email = p.email;
    return true;
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
