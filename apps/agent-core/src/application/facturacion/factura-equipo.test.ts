import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
process.env.GATEWAY_URL ??= 'http://gateway.test';
process.env.GATEWAY_API_KEY ??= 'x';
process.env.OWNER_WA_ID ??= '5219990000000@c.us';

import type { IncomingMessage } from '../../domain/message/incoming-message';
import { leerConceptos, pideEmitirFactura } from './factura-chat';
import { FacturaEquipoService } from './factura-equipo.service';

test('emitir factura vs pedir un documento', () => {
  for (const t of ['factura para Juan', 'hazme una factura', 'facturar a ACME', 'kiero facturar', 'genera fatura', 'ocupo faturar', 'facturale a Pedro']) {
    assert.equal(pideEmitirFactura(t), true, t);
  }
  for (const t of ['mandame la factura de marzo', 'la factura de septiembre porfa', 'quiero factura', 'tienes mi factura?', 'facturas de enero']) {
    assert.equal(pideEmitirFactura(t), false, t);
  }
});

test('conceptos con monto al final', () => {
  assert.deepEqual(leerConceptos('Banquete 50 personas $3,500\n2 x Pollo entero 255\nServicio de entrega - 80.50'), [
    { descripcion: 'Banquete 50 personas', cantidad: 1, precioCents: 350000 },
    { descripcion: 'Pollo entero', cantidad: 2, precioCents: 25500 },
    { descripcion: 'Servicio de entrega', cantidad: 1, precioCents: 8050 },
  ]);
  assert.deepEqual(leerConceptos('Consultoría por $12 000 pesos'), [{ descripcion: 'Consultoría', cantidad: 1, precioCents: 1200000 }]);
  assert.equal(leerConceptos('hola'), null);
  assert.equal(leerConceptos('$500'), null, 'sin descripción no');
});

interface Membresia { canInvoice: boolean; verifiedAt: Date | null; organization: { id: string; name: string; invoicing: { enabled: boolean; pricesIncludeTax: boolean } | null } }

function base(opts: { membresias: Membresia[]; perfil?: object | null; resultado?: object }) {
  const reqs = new Map<string, Record<string, unknown>>();
  const timbradas: unknown[] = [];
  const prisma = {
    invoiceRequest: {
      findUnique: async ({ where }: { where: { conversationId: string } }) => reqs.get(where.conversationId) ?? null,
      upsert: async ({ where, create }: { where: { conversationId: string }; create: Record<string, unknown> }) => {
        reqs.set(where.conversationId, { tries: 0, ...create, data: JSON.parse(JSON.stringify(create.data)) });
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
    membership: { findMany: async () => opts.membresias },
    invoicingSettings: { findUnique: async () => ({ pricesIncludeTax: true }) },
    invoice: { update: async () => ({}) },
  };
  const facturacion = {
    perfilPorRfc: async () => opts.perfil ?? null,
    facturarLibre: async (n: unknown) => {
      timbradas.push(n);
      return opts.resultado ?? { ok: true, factura: { status: 'TIMBRADA', serie: 'F', folio: '12', totalCents: 350000, uuid: 'AAA-111', sandbox: false } };
    },
  };
  const svc = new FacturaEquipoService(prisma as never, facturacion as never);
  const ctx = { contactId: 'c1', conversationId: 'conv1' };
  const decir = (body: string) =>
    svc.atender({ body, kind: 'TEXT', chatId: '5219984862017@c.us', senderId: '5219984862017@c.us' } as IncomingMessage, ctx as never);
  return { decir, reqs, timbradas };
}

const pollos = (extra: Partial<Membresia> = {}): Membresia => ({
  canInvoice: true, verifiedAt: new Date(),
  organization: { id: 'org1', name: 'Pollos Pirata', invoicing: { enabled: true, pricesIncludeTax: true } },
  ...extra,
});

test('el personal emite una factura completa y se timbra con su sí', async () => {
  const { decir, timbradas, reqs } = base({ membresias: [pollos()] });
  assert.equal(await decir('mándame la factura de marzo'), null, 'pedir un documento sigue a soporte');

  let r = await decir('factura para un cliente');
  assert.match(r!.text, /factura de \*Pollos Pirata\*/);
  assert.match(r!.text, /A quién le facturo/);

  r = await decir('RFC EKU9003173C9\nNombre: Escuela Kemper Urgate SA de CV\nCP 42501\nRégimen 601');
  assert.match(r!.text, /qué uso/i);
  r = await decir('1');
  assert.match(r!.text, /Qué le facturas/);
  r = await decir('Banquete 50 personas $3,500');
  assert.match(r!.text, /Cómo pagó/);
  r = await decir('tranferencia');
  assert.match(r!.text, /correo de tu cliente/);
  r = await decir('no');
  assert.match(r!.text, /Revisa la factura de \*Pollos Pirata\*/);
  assert.match(r!.text, /ESCUELA KEMPER URGATE/);
  assert.match(r!.text, /Banquete 50 personas — \$3,500/);
  assert.equal(timbradas.length, 0, 'nada se timbra sin el sí');

  r = await decir('zi');
  assert.match(r!.text, /Timbrada \*F12\*/);
  assert.equal(timbradas.length, 1);
  const n = timbradas[0] as { receptor: { rfc: string; usoCfdi: string }; formaPago: string; conceptos: unknown[]; por: string };
  assert.equal(n.receptor.rfc, 'EKU9003173C9');
  assert.equal(n.receptor.usoCfdi, 'G03');
  assert.equal(n.formaPago, '03');
  assert.equal(n.por, 'whatsapp:5219984862017');
  assert.equal(reqs.size, 0);
});

test('con el RFC de un cliente ya facturado basta', async () => {
  const { decir } = base({
    membresias: [pollos()],
    perfil: { name: 'ESCUELA KEMPER URGATE', zip: '42501', regimen: '601', usoCfdi: 'G03', email: 'a@b.com' },
  });
  const r = await decir('factura para EKU9003173C9');
  assert.match(r!.text, /Ya tengo a \*ESCUELA KEMPER URGATE\*/);
  assert.match(r!.text, /Qué le facturas/);
});

test('corrección directa en el resumen', async () => {
  const { decir } = base({ membresias: [pollos()] });
  await decir('factura para un cliente');
  await decir('RFC EKU9003173C9\nNombre: Escuela Kemper Urgate\nCP 42501\nRégimen 601');
  await decir('1');
  await decir('Banquete $3,500');
  await decir('efectivo');
  let r = await decir('no');
  assert.match(r!.text, /Revisa la factura/);
  r = await decir('Banquete 60 personas $4,200');
  assert.match(r!.text, /Corregido/);
  assert.match(r!.text, /\$4,200/);
});

test('sin permiso: le dice cómo pedirlo', async () => {
  const { decir } = base({ membresias: [pollos({ canInvoice: false })] });
  const r = await decir('hazme una factura');
  assert.match(r!.text, /no tiene permiso/);
});

test('quien no es de ninguna empresa sigue su camino', async () => {
  const { decir } = base({ membresias: [] });
  assert.equal(await decir('hazme una factura'), null);
});

test('varias empresas: pregunta de cuál', async () => {
  const { decir } = base({
    membresias: [pollos(), { ...pollos(), organization: { id: 'org2', name: 'Flores de Paula', invoicing: { enabled: true, pricesIncludeTax: true } } }],
  });
  let r = await decir('factura para un cliente');
  assert.match(r!.text, /De qué empresa/);
  r = await decir('flores');
  assert.match(r!.text, /factura de \*Flores de Paula\*/);
});

test('si el SAT la rechaza se queda en el resumen para corregir', async () => {
  const { decir, reqs } = base({
    membresias: [pollos()],
    resultado: { ok: true, factura: { id: 'f1', status: 'ERROR', error: 'CFDI40145 - El nombre no coincide', totalCents: 1 } },
  });
  await decir('factura para un cliente');
  await decir('RFC EKU9003173C9\nNombre: Escuela Kemper\nCP 42501\nRégimen 601');
  await decir('1');
  await decir('Banquete $3,500');
  await decir('efectivo');
  await decir('no');
  const r = await decir('sí');
  assert.match(r!.text, /CFDI40145/);
  assert.equal((reqs.get('conv1') as { step: string }).step, 'CONFIRMAR');
});
