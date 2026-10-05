import assert from 'node:assert/strict';
import test from 'node:test';
import { armarConceptos, type OpcionesConceptos } from './conceptos';
import { esConstancia, leerConstancia } from './constancia';
import {
  digitoVerificadorValido,
  erroresDeReceptor,
  errorDePago,
  errorDeRfc,
  normalizarNombre,
  tipoPersona,
  type Receptor,
} from './validacion';

// ── RFC ───────────────────────────────────────────────────────────────

test('dígito verificador: los RFC de prueba del SAT pasan', () => {
  for (const rfc of ['EKU9003173C9', 'XIA190128J61', 'CACX7605101P8', 'IIA040805DZ4', 'KIJ0906199R1', 'FUNK671228PH6']) {
    assert.equal(digitoVerificadorValido(rfc), true, rfc);
  }
});

test('dígito verificador: un carácter cambiado se detecta', () => {
  assert.equal(digitoVerificadorValido('EKU9003173C8'), false);
  assert.equal(digitoVerificadorValido('CACX7605101P9'), false);
  assert.ok(errorDeRfc('EKU9003173C8'));
});

test('RFC: formato, fecha y genéricos', () => {
  assert.equal(tipoPersona('EKU9003173C9'), 'moral');
  assert.equal(tipoPersona('cacx-760510 1p8'), 'fisica');
  assert.equal(tipoPersona('ABC123'), null);
  assert.ok(errorDeRfc('ABC123'));
  assert.ok(errorDeRfc('EKU9013173C9'), 'mes 13');
  assert.equal(errorDeRfc('XAXX010101000'), null);
  assert.equal(errorDeRfc('XEXX010101000'), null);
});

// ── Nombre ────────────────────────────────────────────────────────────

test('nombre: se quita el régimen societario solo a empresas', () => {
  assert.equal(normalizarNombre('Escuela Kemper Urgate, S.A. de C.V.', 'moral'), 'ESCUELA KEMPER URGATE');
  assert.equal(normalizarNombre('Grupo X S.A.P.I. de C.V.', 'moral'), 'GRUPO X');
  assert.equal(normalizarNombre('Taller S. de R.L. de C.V.', 'moral'), 'TALLER');
  assert.equal(normalizarNombre('  juan   pérez sa ', 'fisica'), 'JUAN PÉREZ SA');
});

// ── Receptor ──────────────────────────────────────────────────────────

const empresa: Receptor = { rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', codigoPostal: '42501', regimen: '601', usoCfdi: 'G03' };
const persona: Receptor = { rfc: 'CACX7605101P8', nombre: 'XOCHILT CASAS CHAVEZ', codigoPostal: '36257', regimen: '612', usoCfdi: 'G03' };

test('receptor válido no tiene errores', () => {
  assert.deepEqual(erroresDeReceptor(empresa), []);
  assert.deepEqual(erroresDeReceptor(persona), []);
  assert.deepEqual(erroresDeReceptor({ ...persona, regimen: '605', usoCfdi: 'D01' }), []);
});

test('receptor: régimen que no corresponde al tipo de persona', () => {
  assert.ok(erroresDeReceptor({ ...empresa, regimen: '612' }).some((e) => /solo para personas físicas/.test(e)));
  assert.ok(erroresDeReceptor({ ...persona, regimen: '601' }).some((e) => /solo para empresas/.test(e)));
});

test('receptor: uso incompatible con el régimen', () => {
  // Un asalariado (605) no deduce gastos en general.
  assert.ok(erroresDeReceptor({ ...persona, regimen: '605', usoCfdi: 'G03' }).some((e) => /no se puede usar G03/.test(e)));
  // Una empresa no tiene deducciones personales.
  assert.ok(erroresDeReceptor({ ...empresa, usoCfdi: 'D01' }).some((e) => /solo para personas físicas/.test(e)));
});

test('receptor: código postal y correo', () => {
  assert.ok(erroresDeReceptor({ ...empresa, codigoPostal: '4250' }).some((e) => /5 dígitos/.test(e)));
  assert.ok(erroresDeReceptor({ ...empresa, email: 'no-es-correo' }).some((e) => /correo/.test(e)));
});

test('receptor: RFC genérico con el nombre del cliente, sus reglas', () => {
  const sinRfc: Receptor = { rfc: 'XAXX010101000', nombre: 'Juan Pérez', codigoPostal: '77500', regimen: '616', usoCfdi: 'S01' };
  assert.deepEqual(erroresDeReceptor(sinRfc), []);
  assert.ok(erroresDeReceptor({ ...sinRfc, usoCfdi: 'G03' }).length > 0);
  assert.ok(erroresDeReceptor({ ...sinRfc, regimen: '612' }).length > 0);
});

test('receptor: "PUBLICO EN GENERAL" es solo para la factura global (CFDI40130)', () => {
  const global: Receptor = { rfc: 'XAXX010101000', nombre: 'PÚBLICO EN GENERAL', codigoPostal: '77500', regimen: '616', usoCfdi: 'S01' };
  assert.ok(erroresDeReceptor(global).some((e) => /factura global/.test(e)));
});

test('pago: PUE necesita forma real, PPD va con 99', () => {
  assert.equal(errorDePago('03', 'PUE'), null);
  assert.equal(errorDePago('99', 'PPD'), null);
  assert.ok(errorDePago('99', 'PUE'));
  assert.ok(errorDePago('03', 'PPD'));
  assert.ok(errorDePago('77', 'PUE'));
});

// ── Constancia ────────────────────────────────────────────────────────

const CSF_FISICA = `CONSTANCIA DE SITUACIÓN FISCAL
CÉDULA DE IDENTIFICACIÓN FISCAL
Datos de Identificación del Contribuyente:
RFC:CACX7605101P8
CURP:CACX760510MGTSHC04
Nombre (s):XOCHILT
Primer Apellido:CASAS
Segundo Apellido:CHAVEZ
Fecha inicio de operaciones:01 DE ENERO DE 2010
Datos del domicilio registrado
Código Postal:36257Tipo de Vialidad:CALLE
Regímenes:
Régimen Fecha Inicio Fecha Fin
Régimen de Incorporación Fiscal 01/01/2014 31/12/2021
Régimen de las Personas Físicas con Actividades Empresariales y Profesionales 01/01/2022
Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios 01/01/2010
Obligaciones:
Entero de retenciones mensuales de ISR por sueldos y salarios`;

const CSF_MORAL = `CÉDULA DE IDENTIFICACIÓN FISCAL
RFC: EKU9003173C9
Denominación/Razón Social:ESCUELA KEMPER URGATE
Régimen Capital:SOCIEDAD ANONIMA DE CAPITAL VARIABLE
Código Postal: 42501
Regímenes:
Régimen General de Ley Personas Morales 17/03/1990`;

test('constancia de persona física', () => {
  assert.equal(esConstancia(CSF_FISICA), true);
  const d = leerConstancia(CSF_FISICA);
  assert.equal(d.rfc, 'CACX7605101P8');
  assert.equal(d.nombre, 'XOCHILT CASAS CHAVEZ');
  assert.equal(d.codigoPostal, '36257');
  // El 621 tiene fecha de fin: ya no está vigente.
  assert.deepEqual(d.regimenes, ['612', '605']);
});

test('constancia de empresa', () => {
  const d = leerConstancia(CSF_MORAL);
  assert.equal(d.rfc, 'EKU9003173C9');
  assert.equal(d.nombre, 'ESCUELA KEMPER URGATE');
  assert.equal(d.codigoPostal, '42501');
  assert.deepEqual(d.regimenes, ['601']);
});

test('un texto que no es constancia no se confunde', () => {
  assert.equal(esConstancia('Factura A-123 por $500'), false);
  assert.deepEqual(leerConstancia('hola').regimenes, []);
});

// ── Conceptos ─────────────────────────────────────────────────────────

const opciones: OpcionesConceptos = {
  preciosConIva: true, tasaIva: 0.16, claveProdServ: '90101501', claveUnidad: 'H87', claveProdServEnvio: '78102203',
};

test('conceptos: el total de la factura es lo que pagó el cliente', () => {
  for (const [precio, cantidad] of [[24500, 1], [12000, 3], [3000, 7], [9999, 2], [1, 1]] as const) {
    const a = armarConceptos([{ nombre: 'x', precioCents: precio, cantidad }], 0, opciones);
    assert.equal(a.totalCents, precio * cantidad, `${precio}×${cantidad}`);
  }
});

test('conceptos: desglosa IVA y agrega el envío', () => {
  const a = armarConceptos(
    [{ nombre: 'Pollo entero', precioCents: 21500, cantidad: 2 }, { nombre: 'Tortillas', precioCents: 3000, cantidad: 1, claveProdServ: '50221300', claveUnidad: 'KGM' }],
    3000,
    opciones,
  );
  assert.equal(a.conceptos.length, 3);
  assert.equal(a.totalCents, 21500 * 2 + 3000 + 3000);
  const [pollo, tortillas, envio] = a.conceptos;
  assert.equal(pollo!.ClaveProdServ, '90101501');
  assert.equal(pollo!.ValorUnitario, 185.344828);
  assert.equal(pollo!.Impuestos.Traslados[0]!.TasaOCuota, '0.160000');
  assert.equal(tortillas!.ClaveUnidad, 'KGM');
  assert.equal(tortillas!.Unidad, 'Kilogramo');
  assert.equal(envio!.ClaveProdServ, '78102203');
  assert.equal(a.subtotalCents + a.ivaCents, a.totalCents);
});

test('conceptos: precios sin IVA se suman encima', () => {
  const a = armarConceptos([{ nombre: 'Servicio', precioCents: 100000, cantidad: 1 }], 0, { ...opciones, preciosConIva: false });
  assert.equal(a.subtotalCents, 100000);
  assert.equal(a.ivaCents, 16000);
  assert.equal(a.totalCents, 116000);
});
