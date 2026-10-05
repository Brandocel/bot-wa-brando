/**
 * Los renglones de un pedido convertidos en conceptos de CFDI.
 *
 * Los precios del catálogo son los que paga el cliente, IVA incluido (así
 * se anuncian en México). El CFDI pide el valor ANTES de impuestos, así que
 * se desglosa: 245.00 → 211.206897 + 33.793103 de IVA. Se mandan 6
 * decimales, que es lo que el SAT admite: con 2 el total de la factura se
 * desviaba un centavo del que pagó el cliente.
 */

export interface RenglonFacturable {
  nombre: string;
  precioCents: number;
  cantidad: number;
  /** c_ClaveProdServ del producto; null = la de la empresa por omisión. */
  claveProdServ?: string | null;
  claveUnidad?: string | null;
}

export interface OpcionesConceptos {
  preciosConIva: boolean;
  /** 0.16 general, 0.08 frontera, 0 tasa cero. */
  tasaIva: number;
  claveProdServ: string;
  claveUnidad: string;
  claveProdServEnvio: string;
}

export interface Traslado {
  Base: number;
  Impuesto: '002';
  TipoFactor: 'Tasa';
  TasaOCuota: string;
  Importe: number;
}

/** Forma exacta que pide Factura.com en `Conceptos`. */
export interface Concepto {
  ClaveProdServ: string;
  Cantidad: number;
  ClaveUnidad: string;
  Unidad: string;
  ValorUnitario: number;
  Descripcion: string;
  ObjetoImp: '02';
  Impuestos: { Traslados: Traslado[] };
}

export interface ConceptosArmados {
  conceptos: Concepto[];
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
}

/** Nombre de la unidad para las claves más comunes; el PAC acepta cualquiera con la clave correcta. */
const UNIDADES: Readonly<Record<string, string>> = {
  H87: 'Pieza',
  E48: 'Unidad de servicio',
  ACT: 'Actividad',
  KGM: 'Kilogramo',
  LTR: 'Litro',
  XBX: 'Caja',
  XPK: 'Paquete',
};

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function concepto(
  descripcion: string,
  precioCents: number,
  cantidad: number,
  claveProdServ: string,
  claveUnidad: string,
  o: OpcionesConceptos,
): Concepto {
  const precio = precioCents / 100;
  const valorUnitario = r6(o.preciosConIva ? precio / (1 + o.tasaIva) : precio);
  const base = r6(valorUnitario * cantidad);
  return {
    ClaveProdServ: claveProdServ,
    Cantidad: cantidad,
    ClaveUnidad: claveUnidad,
    Unidad: UNIDADES[claveUnidad] ?? claveUnidad,
    ValorUnitario: valorUnitario,
    Descripcion: descripcion.slice(0, 1000),
    ObjetoImp: '02',
    Impuestos: {
      Traslados: [{
        Base: base,
        Impuesto: '002',
        TipoFactor: 'Tasa',
        TasaOCuota: o.tasaIva.toFixed(6),
        Importe: r6(base * o.tasaIva),
      }],
    },
  };
}

export function armarConceptos(
  renglones: readonly RenglonFacturable[],
  envioCents: number,
  o: OpcionesConceptos,
): ConceptosArmados {
  const conceptos = renglones
    .filter((r) => r.cantidad > 0 && r.precioCents > 0)
    .map((r) => concepto(r.nombre, r.precioCents, r.cantidad, r.claveProdServ || o.claveProdServ, r.claveUnidad || o.claveUnidad, o));
  if (envioCents > 0) conceptos.push(concepto('Servicio de entrega', envioCents, 1, o.claveProdServEnvio, 'E48', o));

  // Igual que el SAT: se suma con todos los decimales y se redondea al final.
  const base = conceptos.reduce((n, c) => n + c.Impuestos.Traslados[0]!.Base, 0);
  const iva = conceptos.reduce((n, c) => n + c.Impuestos.Traslados[0]!.Importe, 0);
  const subtotalCents = Math.round(base * 100);
  const ivaCents = Math.round(iva * 100);
  return { conceptos, subtotalCents, ivaCents, totalCents: subtotalCents + ivaCents };
}
