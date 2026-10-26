import { IVA, escalonDe, type Cobro } from './plan-persona';

/**
 * Las herramientas de Jarvis para empresas, cada una con su escalera de
 * precio: igual que el plan Persona, cada mes que la empresa se queda paga
 * menos, hasta el piso del quinto mes; si cancela y vuelve, empieza otra
 * vez en el mes 1. Montos SIN IVA, en pesos.
 *
 * PROPUESTA: las cifras se ajustan aquí y en jarvis-web
 * (src/content/precios.ts), que tiene que decir lo mismo.
 */

export type ClaveHerramienta = 'DOCUMENTOS' | 'VENTAS' | 'FACTURACION' | 'VOZ';

export interface Herramienta {
  clave: ClaveHerramienta;
  nombre: string;
  /** Qué hace, en una frase para el cliente. */
  descripcion: string;
  /** Mes 1 a 5 en adelante, sin IVA. */
  escalones: readonly [number, number, number, number, number];
  /** Se vende sola o solo como extra de otra. */
  extra: boolean;
}

export const HERRAMIENTAS: readonly Herramienta[] = [
  {
    clave: 'DOCUMENTOS',
    nombre: 'Documentos',
    descripcion: 'Tus clientes piden sus documentos por WhatsApp y el bot se los manda al momento.',
    escalones: [1290, 1140, 990, 840, 690],
    extra: false,
  },
  {
    clave: 'VENTAS',
    nombre: 'Ventas',
    descripcion: 'Toma pedidos por WhatsApp, recuerda lo que le gusta a cada cliente y da seguimiento.',
    escalones: [1490, 1290, 1090, 890, 690],
    extra: false,
  },
  {
    clave: 'FACTURACION',
    nombre: 'Facturación',
    descripcion: 'Timbra facturas (CFDI) desde WhatsApp o el panel.',
    escalones: [590, 520, 450, 380, 310],
    extra: true,
  },
  {
    clave: 'VOZ',
    nombre: 'Voz',
    descripcion: 'Entiende notas de voz y contesta con voz.',
    escalones: [290, 260, 230, 200, 170],
    extra: true,
  },
];

export function herramienta(clave: ClaveHerramienta): Herramienta {
  return HERRAMIENTAS.find((h) => h.clave === clave)!;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Lo que paga una empresa el mes `mes` por las herramientas que tiene. */
export function cobroEmpresa(mes: number, claves: readonly ClaveHerramienta[]): Cobro & { detalle: { clave: ClaveHerramienta; monto: number }[] } {
  const i = escalonDe(mes);
  const detalle = HERRAMIENTAS.filter((h) => claves.includes(h.clave)).map((h) => ({ clave: h.clave, monto: h.escalones[i] }));
  const subtotal = detalle.reduce((n, d) => n + d.monto, 0);
  const iva = centavos(subtotal * IVA);
  return { subtotal, iva, total: centavos(subtotal + iva), detalle };
}

/**
 * Un extra (Facturación, Voz) necesita una herramienta principal: sola no
 * tiene sobre qué trabajar.
 */
export function combinacionValida(claves: readonly ClaveHerramienta[]): boolean {
  const principales = claves.filter((c) => !herramienta(c).extra);
  return claves.length === 0 || principales.length > 0;
}
