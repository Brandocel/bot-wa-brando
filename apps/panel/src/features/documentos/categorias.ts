/** Los tipos de documento, en el orden en que se enseñan siempre. */
export const CATEGORIAS = [
  'FACTURA',
  'CONTRATO',
  'COTIZACION',
  'REPORTE',
  'POLIZA',
  'ESTADO_CUENTA',
  'CONTABLE',
  'OTRO',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export const NOMBRE_CATEGORIA: Record<Categoria, string> = {
  FACTURA: 'Facturas',
  CONTRATO: 'Contratos',
  COTIZACION: 'Cotizaciones',
  REPORTE: 'Reportes',
  POLIZA: 'Pólizas',
  ESTADO_CUENTA: 'Estados de cuenta',
  CONTABLE: 'Contables',
  OTRO: 'Otros',
};
