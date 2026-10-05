import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado de las llaves de Factura.com de cada empresa.
 *
 * Con esas llaves cualquiera timbra facturas a nombre de la empresa. En la
 * base van cifradas (AES-256-GCM) con una llave que vive solo en el entorno
 * (FACTURACION_SECRET): un respaldo de la base filtrado no basta para
 * facturar.
 */

const PREFIJO = 'v1';

function llave(secreto: string): Buffer {
  const k = Buffer.from(secreto, 'hex');
  if (k.length !== 32) throw new Error('FACTURACION_SECRET debe ser de 64 caracteres hexadecimales (32 bytes)');
  return k;
}

export function cifrar(texto: string, secreto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', llave(secreto), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [PREFIJO, iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
}

export function descifrar(cifrado: string, secreto: string): string {
  const [v, iv, tag, datos] = cifrado.split(':');
  if (v !== PREFIJO || !iv || !tag || !datos) throw new Error('llave cifrada con formato desconocido');
  const d = createDecipheriv('aes-256-gcm', llave(secreto), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}
