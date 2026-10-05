import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
process.env.GATEWAY_URL ??= 'http://gateway.test';
process.env.GATEWAY_API_KEY ??= 'x';
process.env.OWNER_WA_ID ??= '5219990000000@c.us';

import type { IncomingMessage } from '../../domain/message/incoming-message';
import {
  esNo,
  esSi,
  leerCorreo,
  leerDatosEscritos,
  leerFormaPago,
  leerRegimen,
  leerUso,
  numeroDePedido,
  pideFactura,
  quiereSalir,
  usosPara,
} from './factura-chat';
import { FacturaChatService } from './factura-chat.service';
import type { NuevaFactura } from './facturacion.service';

// ── Lectura de respuestas ─────────────────────────────────────────────

test('detecta cuando pide factura', () => {
  for (const t of ['quiero factura', 'me la puedes facturar?', 'Necesito FACTURA', 'requiero cfdi', '¿dan factura?']) {
    assert.equal(pideFactura(t), true, t);
  }
  for (const t of ['no necesito factura', 'sin factura', 'quiero 2 pollos']) assert.equal(pideFactura(t), false, t);
});

test('sí, no y salir', () => {
  assert.equal(esSi('Sí'), true);
  assert.equal(esSi('si esta bien'), true);
  assert.equal(esSi('si pero cambia el correo'), false);
  assert.equal(esSi('creo'), false);
  assert.equal(esNo('no, está mal el RFC'), true);
  assert.equal(quiereSalir('ya no'), true);
  assert.equal(quiereSalir('cancelar'), true);
});

test('datos escritos a mano', () => {
  const d = leerDatosEscritos('RFC: cacx-760510-1p8\nNombre: Xochilt Casas Chavez\nCP 36257\nrégimen 612\nxochilt@correo.com');
  assert.deepEqual(d, {
    rfc: 'CACX7605101P8', nombre: 'Xochilt Casas Chavez', codigoPostal: '36257', regimen: '612', email: 'xochilt@correo.com',
  });
});

test('datos escritos: nombre en renglón propio y régimen por nombre', () => {
  const d = leerDatosEscritos('EKU9003173C9\nESCUELA KEMPER URGATE\n42501\nGeneral de ley personas morales');
  assert.equal(d.rfc, 'EKU9003173C9');
  assert.equal(d.nombre, 'ESCUELA KEMPER URGATE');
  assert.equal(d.codigoPostal, '42501');
  assert.equal(d.regimen, '601');
});

test('datos escritos: lo que no viene queda en null', () => {
  const d = leerDatosEscritos('mi rfc es CACX7605101P8');
  assert.equal(d.rfc, 'CACX7605101P8');
  assert.equal(d.nombre, null);
  assert.equal(d.codigoPostal, null);
});

test('régimen por clave o por nombre común', () => {
  assert.equal(leerRegimen('626'), '626');
  assert.equal(leerRegimen('soy resico'), '626');
  assert.equal(leerRegimen('sueldos y salarios'), '605');
  assert.equal(leerRegimen('hola'), null);
});

test('usos según régimen', () => {
  const empresa = usosPara('601', 'EKU9003173C9').map((u) => u.clave);
  assert.ok(empresa.includes('G03'));
  assert.ok(!empresa.includes('D01'));
  const asalariado = usosPara('605', 'CACX7605101P8').map((u) => u.clave);
  assert.ok(!asalariado.includes('G03'));
  assert.ok(asalariado.includes('D01'));
  assert.deepEqual(usosPara('616', 'XAXX010101000').map((u) => u.clave), ['S01']);

  const ops = usosPara('601', 'EKU9003173C9');
  assert.equal(leerUso('1', ops), ops[0]!.clave);
  assert.equal(leerUso('g03', ops), 'G03');
  assert.equal(leerUso('gastos en general', ops), 'G03');
  assert.equal(leerUso('D01', ops), null);
});

test('forma de pago: tarjeta a secas se pregunta', () => {
  assert.equal(leerFormaPago('2'), '03');
  assert.equal(leerFormaPago('por spei'), '03');
  assert.equal(leerFormaPago('efectivo'), '01');
  assert.equal(leerFormaPago('tarjeta de débito'), '28');
  assert.equal(leerFormaPago('con tarjeta'), 'tarjeta');
  assert.equal(leerFormaPago('mañana'), null);
});

test('correo y pedido', () => {
  assert.equal(leerCorreo('Ana@Mail.com'), 'ana@mail.com');
  assert.equal(leerCorreo('no'), 'ninguno');
  assert.equal(leerCorreo('mmm'), null);
  assert.equal(numeroDePedido('P-1042'), 1042);
  assert.equal(numeroDePedido('el pedido 77'), 77);
});

// ── Como escriben de verdad ───────────────────────────────────────────

test('pide factura aunque lo escriba mal', () => {
  for (const t of ['kiero fatura', 'ocupo factua', 'me la facturas?', 'nesesito factira porfa', 'FACTURA!!']) {
    assert.equal(pideFactura(t), true, t);
  }
  assert.equal(pideFactura('no ocupo fatura'), false);
});

test('forma de pago con faltas', () => {
  assert.equal(leerFormaPago('efectibo'), '01');
  assert.equal(leerFormaPago('tranferencia'), '03');
  assert.equal(leerFormaPago('le hice deposito'), '03');
  assert.equal(leerFormaPago('con targeta'), 'tarjeta');
  assert.equal(leerFormaPago('devito'), '28');
  assert.equal(leerFormaPago('la dos'), '03');
});

test('uso con faltas o clave mal tecleada', () => {
  const ops = usosPara('601', 'EKU9003173C9');
  assert.equal(leerUso('gastos en jeneral', ops), 'G03');
  assert.equal(leerUso('g 03', ops), 'G03');
  assert.equal(leerUso('g3', ops), 'G03');
  assert.equal(leerUso('el primero', ops), ops[0]!.clave);
});

test('régimen con faltas', () => {
  assert.equal(leerRegimen('rezico'), '626');
  assert.equal(leerRegimen('soy asalariado'), '605');
  assert.equal(leerRegimen('actividades empresariales'), '612');
  assert.equal(leerRegimen('jeneral de ley'), '601');
});

test('correo con espacios y dominio mal escrito', () => {
  assert.equal(leerCorreo('brando @ gmial .com'), 'brando@gmail.com');
  assert.equal(leerCorreo('ana@hotmal.con'), 'ana@hotmail.com');
  assert.equal(leerCorreo('Nop'), 'ninguno');
  assert.equal(leerCorreo('solo por whats'), 'ninguno');
  assert.equal(leerCorreo('ninguno'), 'ninguno');
});

test('RFC con O en lugar de cero y separado', () => {
  assert.equal(leerDatosEscritos('mi rfc eku 9OO317 3c9').rfc, 'EKU9003173C9');
  assert.equal(leerDatosEscritos('cp 42 501').codigoPostal, '42501');
});

test('salir y no, mal escritos', () => {
  assert.equal(quiereSalir('cancelalo'), true);
  assert.equal(quiereSalir('kancela'), true);
  assert.equal(quiereSalir('ya no gracias'), true);
  assert.equal(quiereSalir('no gracias'), true);
  assert.equal(quiereSalir('no, el rfc está mal'), false);
  assert.equal(esNo('nop'), true);
  assert.equal(esNo('esta mal el nombre'), true);
  assert.equal(esNo('incorecto'), true);
});

// ── La plática completa contra una base falsa ─────────────────────────

function baseFalsa(opts: { ordenes?: Array<{ id: string; number: number; totalCents: number; status: string }>; perfil?: object | null; enabled?: boolean }) {
  const reqs = new Map<string, Record<string, unknown>>();
  const propuestas: NuevaFactura[] = [];
  const prisma = {
    invoiceRequest: {
      findUnique: async ({ where }: { where: { conversationId: string } }) => reqs.get(where.conversationId) ?? null,
      upsert: async ({ where, create }: { where: { conversationId: string }; create: Record<string, unknown> }) => {
        reqs.set(where.conversationId, { tries: 0, ...create });
      },
      update: async ({ where, data }: { where: { conversationId: string }; data: Record<string, unknown> }) => {
        const r = reqs.get(where.conversationId)!;
        const tries = data.tries as unknown;
        reqs.set(where.conversationId, {
          ...r, ...data,
          tries: typeof tries === 'object' && tries ? (r.tries as number) + 1 : (tries ?? r.tries),
          data: data.data ? JSON.parse(JSON.stringify(data.data)) : r.data,
        });
      },
      deleteMany: async ({ where }: { where: { conversationId: string } }) => { reqs.delete(where.conversationId); },
    },
    invoicingSettings: { findUnique: async () => ({ enabled: opts.enabled ?? true, maxDaysAfterSale: 30 }) },
    order: { findMany: async () => opts.ordenes ?? [{ id: 'o1', number: 1042, totalCents: 24500, status: 'ENTREGADO' }] },
    fiscalProfile: { findFirst: async () => opts.perfil ?? null },
  };
  const facturacion = {
    proponer: async (n: NuevaFactura) => { propuestas.push(n); return { ok: true, factura: {} }; },
  };
  const svc = new FacturaChatService(prisma as never, facturacion as never);
  const ctx = { contactId: 'c1', conversationId: 'conv1' };
  const negocio = { organizationId: 'org1', nombre: 'Pollos Pirata' };
  const decir = async (body: string, attachment?: IncomingMessage['attachment']) =>
    svc.atender({ body, kind: attachment ? 'DOCUMENT' : 'TEXT', attachment } as IncomingMessage, ctx as never, negocio);
  return { decir, reqs, propuestas };
}

test('plática completa con datos escritos', async () => {
  const { decir, propuestas, reqs } = baseFalsa({});
  assert.equal(await decir('quiero 2 pollos'), null, 'lo que no es factura sigue a la venta');

  let r = await decir('me das factura?');
  assert.match(r!.text, /P-1042/);
  assert.match(r!.text, /Constancia de Situación Fiscal/);

  r = await decir('RFC EKU9003173C9\nNombre: Escuela Kemper Urgate SA de CV\nCP 42501\nRégimen 601');
  assert.match(r!.text, /Para qué vas a usar/);

  r = await decir('gastos en general');
  assert.match(r!.text, /Cómo pagaste/);

  r = await decir('con tarjeta');
  assert.match(r!.text, /débito o de crédito/);
  r = await decir('1');
  assert.match(r!.text, /correo/);

  r = await decir('no');
  assert.match(r!.text, /Revisa que esté bien/);
  assert.match(r!.text, /ESCUELA KEMPER URGATE/);
  assert.match(r!.text, /Tarjeta de débito/);
  assert.equal(propuestas.length, 0, 'nada se arma sin el sí');

  r = await decir('sí');
  assert.match(r!.text, /Listo/);
  assert.equal(propuestas.length, 1);
  assert.deepEqual(
    { ...propuestas[0]!.receptor },
    { rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', codigoPostal: '42501', regimen: '601', usoCfdi: 'G03', email: null },
  );
  assert.equal(propuestas[0]!.formaPago, '28');
  assert.equal(propuestas[0]!.orderId, 'o1');
  assert.equal(reqs.size, 0);
});

test('un RFC mal escrito se vuelve a pedir', async () => {
  const { decir } = baseFalsa({});
  await decir('quiero factura');
  const r = await decir('RFC EKU9003173C8, Nombre: Escuela Kemper Urgate, CP 42501, régimen 601');
  assert.match(r!.text, /carácter equivocado/);
  assert.match(r!.text, /Me falta: RFC/);
});

test('con perfil guardado solo confirma y pregunta el pago', async () => {
  const { decir } = baseFalsa({
    perfil: { rfc: 'EKU9003173C9', name: 'ESCUELA KEMPER URGATE', zip: '42501', regimen: '601', usoCfdi: 'G03', email: 'a@b.com', source: 'CONSTANCIA' },
  });
  let r = await decir('factura porfa');
  assert.match(r!.text, /mismos datos/);
  r = await decir('si');
  assert.match(r!.text, /Cómo pagaste/);
  r = await decir('transferencia');
  assert.match(r!.text, /Revisa que esté bien/);
  assert.match(r!.text, /a@b.com/);
});

test('varios pedidos: pregunta cuál', async () => {
  const { decir } = baseFalsa({
    ordenes: [
      { id: 'o2', number: 1050, totalCents: 12000, status: 'ACEPTADO' },
      { id: 'o1', number: 1042, totalCents: 24500, status: 'ENTREGADO' },
    ],
  });
  let r = await decir('quiero factura');
  assert.match(r!.text, /De cuál pedido/);
  r = await decir('P-1042');
  assert.match(r!.text, /Constancia/);
});

test('sin compras: contesta que sí factura y cómo', async () => {
  const { decir, reqs } = baseFalsa({ ordenes: [] });
  const r = await decir('¿dan factura?');
  assert.match(r!.text, /Sí damos factura/);
  assert.equal(reqs.size, 0);
});

test('tres respuestas sin entender pasan a una persona', async () => {
  const { decir, reqs } = baseFalsa({});
  await decir('quiero factura');
  await decir('mmm');
  await decir('no sé');
  const r = await decir('???');
  assert.equal(r!.awaiting, 'AGENTE');
  assert.equal(reqs.size, 0);
});

test('"Simón" al correo pregunta cuál, sin contarlo como error', async () => {
  const { decir, reqs } = baseFalsa({});
  await decir('quiero factura');
  await decir('RFC EKU9003173C9\nNombre: Escuela Kemper Urgate\nCP 42501\nRégimen 601');
  await decir('1');
  let r = await decir('transferencia');
  assert.match(r!.text, /correo/);
  r = await decir('Simón');
  assert.match(r!.text, /A qué correo/);
  assert.equal(reqs.get('conv1')!.tries, 0);
  r = await decir('ana@mail.com');
  assert.match(r!.text, /Revisa que esté bien/);
  assert.match(r!.text, /ana@mail.com/);
});

test('"ya no" deja la factura', async () => {
  const { decir, reqs } = baseFalsa({});
  await decir('quiero factura');
  const r = await decir('ya no');
  assert.match(r!.text, /dejamos la factura/);
  assert.equal(reqs.size, 0);
});

test('empresa sin facturación lo pasa a una persona', async () => {
  const { decir } = baseFalsa({ enabled: false });
  const r = await decir('quiero factura');
  assert.equal(r!.awaiting, 'AGENTE');
});
