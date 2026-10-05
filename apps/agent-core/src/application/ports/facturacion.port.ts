import type { Concepto } from '../facturacion/conceptos';
import type { Receptor } from '../facturacion/validacion';

/**
 * PORT hacia el PAC. Hoy lo cumple Factura.com; cambiar de proveedor es
 * escribir otro adaptador, no tocar el flujo de facturación.
 *
 * Cada llamada lleva las credenciales de la empresa EMISORA: cada empresa
 * timbra con su propio RFC y su propio CSD, y una factura de la empresa A
 * nunca debe salir con las llaves de la B.
 */

export interface CredencialesPac {
  apiKey: string;
  secretKey: string;
  sandbox: boolean;
}

export interface Serie {
  id: number;
  nombre: string;
  tipo: string;
  activa: boolean;
}

export interface CfdiNuevo {
  receptor: Receptor;
  conceptos: Concepto[];
  serieId: number;
  formaPago: string;
  metodoPago: 'PUE' | 'PPD';
  lugarExpedicion?: string | null;
  /** Correo de la empresa, para registrar al cliente si él no dio uno (el PAC lo exige). */
  emailRespaldo?: string | null;
  /** Referencia propia (id de la factura en la base) para encontrarla en el PAC. */
  referencia: string;
}

export interface CfdiTimbrado {
  uidProveedor: string;
  uuid: string;
  serie: string | null;
  folio: string | null;
  fechaTimbrado: string | null;
}

export interface CancelacionResultado {
  /** El SAT puede dejarla "en proceso" mientras el receptor acepta. */
  estado: 'cancelada' | 'en_proceso';
  detalle: string;
}

/** Error que el PAC devolvió con mensaje entendible (CFDI40xxx, datos del receptor...). */
export class ErrorPac extends Error {
  constructor(
    message: string,
    /** false = no se sabe si llegó a timbrar (red, timeout): NO reintentar a ciegas. */
    readonly definitivo: boolean,
  ) {
    super(message);
  }
}

export interface FacturacionPort {
  series(cred: CredencialesPac): Promise<Serie[]>;
  timbrar(cred: CredencialesPac, cfdi: CfdiNuevo): Promise<CfdiTimbrado>;
  descargar(cred: CredencialesPac, uidProveedor: string, formato: 'pdf' | 'xml'): Promise<Buffer>;
  cancelar(cred: CredencialesPac, uidProveedor: string, motivo: string, folioSustituto?: string | null): Promise<CancelacionResultado>;
}

export const FACTURACION_PORT = Symbol('FacturacionPort');
