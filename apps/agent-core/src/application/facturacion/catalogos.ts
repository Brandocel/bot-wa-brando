/**
 * Catálogos del SAT que el bot necesita para no mandar al PAC algo que va a
 * rebotar. Solo lo que se usa al facturar a un cliente; los catálogos
 * completos (ClaveProdServ tiene ~50 mil claves) los valida el PAC.
 *
 * Fuente: Anexo 20 del CFDI 4.0, catálogos c_RegimenFiscal, c_UsoCFDI y
 * c_FormaPago.
 */

export interface Regimen {
  clave: string;
  nombre: string;
  fisica: boolean;
  moral: boolean;
}

export const REGIMENES: readonly Regimen[] = [
  { clave: '601', nombre: 'General de Ley Personas Morales', fisica: false, moral: true },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos', fisica: false, moral: true },
  { clave: '605', nombre: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', fisica: true, moral: false },
  { clave: '606', nombre: 'Arrendamiento', fisica: true, moral: false },
  { clave: '607', nombre: 'Régimen de Enajenación o Adquisición de Bienes', fisica: true, moral: false },
  { clave: '608', nombre: 'Demás ingresos', fisica: true, moral: false },
  { clave: '610', nombre: 'Residentes en el Extranjero sin Establecimiento Permanente en México', fisica: true, moral: true },
  { clave: '611', nombre: 'Ingresos por Dividendos (socios y accionistas)', fisica: true, moral: false },
  { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales y Profesionales', fisica: true, moral: false },
  { clave: '614', nombre: 'Ingresos por intereses', fisica: true, moral: false },
  { clave: '615', nombre: 'Régimen de los ingresos por obtención de premios', fisica: true, moral: false },
  { clave: '616', nombre: 'Sin obligaciones fiscales', fisica: true, moral: false },
  { clave: '620', nombre: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos', fisica: false, moral: true },
  { clave: '621', nombre: 'Incorporación Fiscal', fisica: true, moral: false },
  { clave: '622', nombre: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', fisica: false, moral: true },
  { clave: '623', nombre: 'Opcional para Grupos de Sociedades', fisica: false, moral: true },
  { clave: '624', nombre: 'Coordinados', fisica: false, moral: true },
  { clave: '625', nombre: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', fisica: true, moral: false },
  { clave: '626', nombre: 'Régimen Simplificado de Confianza', fisica: true, moral: true },
];

export interface UsoCfdi {
  clave: string;
  nombre: string;
  fisica: boolean;
  moral: boolean;
  /** Regímenes del RECEPTOR con los que el SAT acepta este uso. */
  regimenes: readonly string[];
}

/** Regímenes que pueden deducir gastos e inversiones (G01–G03, I01–I08). */
const DE_NEGOCIO = ['601', '603', '606', '612', '620', '621', '622', '623', '624', '625', '626'];
/** Deducciones personales (D01–D10): solo personas físicas con estos regímenes. */
const PERSONALES = ['605', '606', '607', '608', '611', '612', '614', '615', '625'];
const TODOS = REGIMENES.map((r) => r.clave);

export const USOS_CFDI: readonly UsoCfdi[] = [
  { clave: 'G01', nombre: 'Adquisición de mercancías', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'G02', nombre: 'Devoluciones, descuentos o bonificaciones', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'G03', nombre: 'Gastos en general', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I01', nombre: 'Construcciones', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I02', nombre: 'Mobiliario y equipo de oficina por inversiones', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I03', nombre: 'Equipo de transporte', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I04', nombre: 'Equipo de cómputo y accesorios', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I05', nombre: 'Dados, troqueles, moldes, matrices y herramental', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I06', nombre: 'Comunicaciones telefónicas', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I07', nombre: 'Comunicaciones satelitales', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'I08', nombre: 'Otra maquinaria y equipo', fisica: true, moral: true, regimenes: DE_NEGOCIO },
  { clave: 'D01', nombre: 'Honorarios médicos, dentales y gastos hospitalarios', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D02', nombre: 'Gastos médicos por incapacidad o discapacidad', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D03', nombre: 'Gastos funerales', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D04', nombre: 'Donativos', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D05', nombre: 'Intereses reales por créditos hipotecarios (casa habitación)', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D06', nombre: 'Aportaciones voluntarias al SAR', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D07', nombre: 'Primas por seguros de gastos médicos', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D08', nombre: 'Gastos de transportación escolar obligatoria', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D09', nombre: 'Depósitos en cuentas para el ahorro o planes de pensiones', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'D10', nombre: 'Pagos por servicios educativos (colegiaturas)', fisica: true, moral: false, regimenes: PERSONALES },
  { clave: 'S01', nombre: 'Sin efectos fiscales', fisica: true, moral: true, regimenes: TODOS },
  { clave: 'CP01', nombre: 'Pagos', fisica: true, moral: true, regimenes: TODOS },
  { clave: 'CN01', nombre: 'Nómina', fisica: true, moral: false, regimenes: ['605'] },
];

/** Formas de pago que tiene sentido ofrecer en una venta por WhatsApp. */
export const FORMAS_PAGO: Readonly<Record<string, string>> = {
  '01': 'Efectivo',
  '02': 'Cheque nominativo',
  '03': 'Transferencia electrónica de fondos',
  '04': 'Tarjeta de crédito',
  '05': 'Monedero electrónico',
  '06': 'Dinero electrónico',
  '08': 'Vales de despensa',
  '28': 'Tarjeta de débito',
  '29': 'Tarjeta de servicios',
  '99': 'Por definir',
};

/** Motivos de cancelación del SAT. */
export const MOTIVOS_CANCELACION: Readonly<Record<string, string>> = {
  '01': 'Comprobante emitido con errores con relación',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global',
};

export function regimen(clave: string): Regimen | undefined {
  return REGIMENES.find((r) => r.clave === clave);
}

export function usoCfdi(clave: string): UsoCfdi | undefined {
  return USOS_CFDI.find((u) => u.clave === clave);
}
