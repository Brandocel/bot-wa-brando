import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Lo poco de Stripe que usa el plan, a mano sobre fetch: son cinco
 * llamadas y una firma, no vale el SDK entero en el árbol.
 *
 * La versión de la API va fija para que un cambio en la cuenta no mueva
 * la forma de las respuestas sin que nos enteremos.
 */
const API = 'https://api.stripe.com/v1/';
const VERSION = '2024-06-20';

export type Parametros = { [k: string]: string | number | boolean | null | undefined | Parametros | Parametros[] | string[] };

/** `{ a: { b: [{ c: 1 }] } }` → `a[b][0][c]=1`, como lo pide Stripe. */
export function formulario(params: Parametros, prefijo = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) =>
        typeof x === 'object' ? formulario(x, `${clave}[${i}]`, out) : out.append(`${clave}[${i}]`, String(x)),
      );
    } else if (typeof v === 'object') {
      formulario(v, clave, out);
    } else {
      out.append(clave, String(v));
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(
    mensaje: string,
    readonly status: number,
  ) {
    super(mensaje);
  }
}

export class StripeClient {
  constructor(private readonly llave: string) {}

  async pedir<T = Record<string, any>>(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, params?: Parametros): Promise<T> {
    const cuerpo = params ? formulario(params).toString() : '';
    const url = metodo === 'GET' && cuerpo ? `${API}${ruta}?${cuerpo}` : API + ruta;
    const res = await fetch(url, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${this.llave}`,
        'Stripe-Version': VERSION,
        ...(metodo === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: metodo === 'POST' ? cuerpo : undefined,
    });
    const datos = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new StripeError(datos?.error?.message ?? `Stripe respondió ${res.status}`, res.status);
    return datos as T;
  }
}

/**
 * Comprueba la cabecera `Stripe-Signature` de un webhook. Sin esto
 * cualquiera podría avisar "ya pagó" a la URL pública.
 */
export function firmaValida(cuerpo: Buffer | string, cabecera: string | undefined, secreto: string, ahora = Date.now()): boolean {
  if (!cabecera) return false;
  const partes = cabecera.split(',').map((p) => p.trim().split('='));
  const t = partes.find(([k]) => k === 't')?.[1];
  const firmas = partes.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !firmas.length) return false;
  // Cinco minutos de tolerancia, como el SDK: frena reenvíos de un evento viejo.
  if (Math.abs(ahora / 1000 - Number(t)) > 300) return false;

  const esperada = createHmac('sha256', secreto).update(`${t}.${cuerpo.toString()}`).digest();
  return firmas.some((f) => {
    const dada = Buffer.from(f, 'hex');
    return dada.length === esperada.length && timingSafeEqual(dada, esperada);
  });
}
