import { Injectable } from '@nestjs/common';
import {
  ErrorPac,
  type CancelacionResultado,
  type CfdiNuevo,
  type CfdiTimbrado,
  type CredencialesPac,
  type FacturacionPort,
  type Serie,
} from '../../application/ports/facturacion.port';
import type { Receptor } from '../../application/facturacion/validacion';

/** Valor fijo que Factura.com pide en todas las llamadas. */
const F_PLUGIN = '9d4095c8f7ed5785cb14c0e3b033eeb8252416ed';
const TIMEOUT_MS = 45_000;

interface ClienteFc {
  UID: string;
  RFC: string;
  RazonSocial: string;
  CodigoPostal: string;
  RegimenId: string;
  UsoCFDI: string;
  Contacto?: { Email?: string };
}

/**
 * ADAPTER de Factura.com (API v4 para CFDI, v1 para clientes).
 *
 * Factura.com exige que el receptor exista como "cliente" de la empresa
 * antes de timbrar, así que timbrar son dos pasos: asegurar el cliente
 * con los datos de HOY (el cliente pudo cambiar de régimen o domicilio) y
 * luego crear el CFDI con su UID.
 */
@Injectable()
export class FacturaComAdapter implements FacturacionPort {
  async series(cred: CredencialesPac): Promise<Serie[]> {
    const r = await this.llamar<{ status: string; data?: Array<Record<string, unknown>> }>(cred, 'GET', '/v4/series');
    if (r.status !== 'success') throw new ErrorPac(mensajeDe(r) ?? 'No se pudieron leer las series', true);
    return (r.data ?? []).map((s) => ({
      id: Number(s.SerieID),
      nombre: String(s.SerieName ?? ''),
      tipo: String(s.SerieType ?? ''),
      activa: String(s.SerieStatus ?? '').toLowerCase() === 'activa',
    }));
  }

  async timbrar(cred: CredencialesPac, cfdi: CfdiNuevo): Promise<CfdiTimbrado> {
    const uidCliente = await this.asegurarCliente(cred, cfdi.receptor, cfdi.emailRespaldo ?? null);

    const body = {
      Receptor: { UID: uidCliente },
      TipoDocumento: 'factura',
      Conceptos: cfdi.conceptos,
      UsoCFDI: cfdi.receptor.usoCfdi,
      Serie: cfdi.serieId,
      FormaPago: cfdi.formaPago,
      MetodoPago: cfdi.metodoPago,
      Moneda: 'MXN',
      ...(cfdi.lugarExpedicion ? { LugarExpedicion: cfdi.lugarExpedicion } : {}),
      NumOrder: cfdi.referencia,
      // El PDF y el XML los manda el bot por WhatsApp; el correo de
      // Factura.com sale además solo si el cliente dio uno.
      EnviarCorreo: !!cfdi.receptor.email,
    };

    let r: Record<string, unknown>;
    try {
      r = await this.llamar(cred, 'POST', '/v4/cfdi40/create', body);
    } catch (err) {
      // Se cayó la red o venció el tiempo DESPUÉS de mandar: el CFDI pudo
      // haberse timbrado. Reintentar a ciegas podría duplicar la factura.
      if (err instanceof ErrorPac) throw err;
      throw new ErrorPac(`Sin respuesta de Factura.com (${String(err)}). Revisa en su panel si se timbró antes de reintentar.`, false);
    }

    if (r.response !== 'success') throw new ErrorPac(mensajeDe(r) ?? 'Factura.com rechazó la factura', true);
    const sat = (r.SAT ?? {}) as Record<string, unknown>;
    const inv = (r.INV ?? {}) as Record<string, unknown>;
    const uuid = String(r.UUID ?? sat.UUID ?? '');
    const uid = String(r.uid ?? r.invoice_uid ?? '');
    if (!uuid || !uid) throw new ErrorPac('Factura.com respondió sin UUID. Revisa en su panel antes de reintentar.', false);

    return {
      uidProveedor: uid,
      uuid,
      serie: inv.Serie != null ? String(inv.Serie) : null,
      folio: inv.Folio != null ? String(inv.Folio) : null,
      fechaTimbrado: sat.FechaTimbrado != null ? String(sat.FechaTimbrado) : null,
    };
  }

  async descargar(cred: CredencialesPac, uidProveedor: string, formato: 'pdf' | 'xml'): Promise<Buffer> {
    const res = await fetch(`${base(cred)}/v4/cfdi40/${encodeURIComponent(uidProveedor)}/${formato}`, {
      headers: encabezados(cred),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new ErrorPac(`No se pudo descargar el ${formato.toUpperCase()} (HTTP ${res.status})`, true);
    const buf = Buffer.from(await res.arrayBuffer());
    // Un error llega como JSON con 200; un PDF empieza con %PDF y un XML con <.
    const inicio = buf.subarray(0, 5).toString('utf8');
    if (formato === 'pdf' && inicio !== '%PDF-') throw new ErrorPac(`Factura.com no devolvió un PDF: ${buf.subarray(0, 200).toString('utf8')}`, true);
    if (formato === 'xml' && !inicio.trimStart().startsWith('<')) throw new ErrorPac(`Factura.com no devolvió un XML: ${buf.subarray(0, 200).toString('utf8')}`, true);
    return buf;
  }

  async cancelar(cred: CredencialesPac, uidProveedor: string, motivo: string, folioSustituto?: string | null): Promise<CancelacionResultado> {
    const r = await this.llamar<Record<string, unknown>>(cred, 'POST', `/v4/cfdi40/${encodeURIComponent(uidProveedor)}/cancel`, {
      motivo,
      ...(folioSustituto ? { folioSustituto } : {}),
    });
    if (r.response !== 'success') throw new ErrorPac(mensajeDe(r) ?? 'Factura.com no pudo cancelar', true);
    const texto = JSON.stringify(r);
    // 201 = cancelada; con aceptación del receptor queda "en proceso".
    const enProceso = /en proceso|pendiente/i.test(texto) && !/EstatusUUID["':>\s]*201/.test(texto);
    return { estado: enProceso ? 'en_proceso' : 'cancelada', detalle: String(r.message ?? '') };
  }

  // ── Clientes ────────────────────────────────────────────────────────

  /** El UID del receptor en Factura.com, creándolo o actualizándolo para que coincida con la Constancia. */
  private async asegurarCliente(cred: CredencialesPac, receptor: Receptor, emailRespaldo: string | null): Promise<string> {
    // Factura.com no registra un cliente sin correo. Si el cliente no dio
    // uno, va el de la empresa (y no se le manda correo: ver EnviarCorreo).
    const email = receptor.email || emailRespaldo;
    if (!email) throw new ErrorPac('Factura.com pide un correo para el cliente. Captura el correo de la empresa en la configuración de facturación.', true);
    const datos = {
      rfc: receptor.rfc,
      razons: receptor.nombre,
      codpos: receptor.codigoPostal,
      regimen: receptor.regimen,
      usocfdi: receptor.usoCfdi,
      email,
      pais: 'MEX',
    };

    const existente = await this.clientePorRfc(cred, receptor.rfc);
    if (existente) {
      const igual = existente.RazonSocial.trim().toUpperCase() === receptor.nombre.toUpperCase()
        && existente.CodigoPostal === receptor.codigoPostal
        && existente.RegimenId === receptor.regimen
        && existente.UsoCFDI === receptor.usoCfdi
        && (!receptor.email || existente.Contacto?.Email === receptor.email);
      if (igual) return existente.UID;
      const r = await this.llamar<{ status: string; Data?: ClienteFc }>(cred, 'POST', `/v1/clients/${encodeURIComponent(existente.UID)}/update`, datos);
      if (r.status !== 'success' || !r.Data?.UID) throw new ErrorPac(mensajeDe(r) ?? 'No se pudo actualizar al cliente en Factura.com', true);
      return r.Data.UID;
    }

    const r = await this.llamar<{ status: string; Data?: ClienteFc }>(cred, 'POST', '/v1/clients/create', datos);
    if (r.status !== 'success' || !r.Data?.UID) throw new ErrorPac(mensajeDe(r) ?? 'No se pudo registrar al cliente en Factura.com', true);
    return r.Data.UID;
  }

  private async clientePorRfc(cred: CredencialesPac, rfc: string): Promise<ClienteFc | null> {
    try {
      const r = await this.llamar<{ status: string; Data?: ClienteFc }>(cred, 'GET', `/v1/clients/${encodeURIComponent(rfc)}`);
      return r.status === 'success' && r.Data?.UID ? r.Data : null;
    } catch (err) {
      // "No existe" llega como error; cualquier otro fallo se verá al crear.
      if (err instanceof ErrorPac) return null;
      throw err;
    }
  }

  // ── HTTP ────────────────────────────────────────────────────────────

  private async llamar<T>(cred: CredencialesPac, metodo: 'GET' | 'POST', ruta: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base(cred)}${ruta}`, {
      method: metodo,
      headers: encabezados(cred),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await res.text();
    let json: unknown;
    try { json = JSON.parse(texto); } catch {
      throw new ErrorPac(`Factura.com respondió algo que no es JSON (HTTP ${res.status}): ${texto.slice(0, 200)}`, res.status < 500);
    }
    if (res.status === 401 || res.status === 403) throw new ErrorPac('Las llaves de Factura.com no son válidas para esta empresa.', true);
    if (!res.ok) throw new ErrorPac(mensajeDe(json) ?? `Factura.com respondió HTTP ${res.status}`, res.status < 500);
    return json as T;
  }
}

function base(cred: CredencialesPac): string {
  return cred.sandbox ? 'https://sandbox.factura.com/api' : 'https://api.factura.com';
}

function encabezados(cred: CredencialesPac): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'F-PLUGIN': F_PLUGIN,
    'F-Api-Key': cred.apiKey,
    'F-Secret-Key': cred.secretKey,
  };
}

/**
 * Factura.com manda algunos errores con HTML ("<strong>No puedes
 * facturar</strong>") y con UTF-8 leído como Latin-1 ("facturaciÃ³n").
 * Se dejan en texto limpio: este mensaje se enseña en el panel.
 */
export function limpiarMensaje(m: string): string {
  let t = m.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (/Ã[\x80-\xBF¡-¿]/.test(t)) {
    const reparado = Buffer.from(t, 'latin1').toString('utf8');
    if (!reparado.includes('�')) t = reparado;
  }
  return t;
}

/** Factura.com anida el mensaje de error de varias formas; se busca el texto útil. */
function mensajeDe(r: unknown): string | null {
  const m = mensajeCrudo(r);
  return m ? limpiarMensaje(m) : null;
}

function mensajeCrudo(r: unknown): string | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const m = o.message;
  if (typeof m === 'string' && m) return m;
  if (m && typeof m === 'object') {
    const mm = m as Record<string, unknown>;
    const partes = [mm.message, mm.messageDetail].filter((x): x is string => typeof x === 'string' && !!x);
    if (partes.length) return partes.join(' — ');
    // Errores de validación por campo: { email: ["El campo email es requerido"] }.
    const campos = Object.values(mm).flat().filter((x): x is string => typeof x === 'string' && !!x);
    if (campos.length) return campos.join(' ');
  }
  if (typeof o.error === 'string') return o.error;
  return null;
}
