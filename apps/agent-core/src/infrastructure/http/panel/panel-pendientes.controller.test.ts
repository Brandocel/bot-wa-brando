import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
process.env.GATEWAY_URL ??= 'http://gateway.test';
process.env.GATEWAY_API_KEY ??= 'x';
process.env.OWNER_WA_ID ??= '5219990000000@c.us';

import { PanelPendientesController } from './panel-pendientes.controller';

const hace = (min: number) => new Date(Date.now() - min * 60000);

function prismaFalso() {
  const llamadas: Record<string, unknown[]> = {};
  const anota = (k: string, v: unknown) => { (llamadas[k] ??= []).push(v); };
  return {
    llamadas,
    organization: { findMany: async (a: unknown) => { anota('org', a); return [
      { id: 'org1', name: 'Pollos Pirata', waLineId: 'org_1' },
      { id: 'org2', name: 'Northline', waLineId: null },
    ]; } },
    conversation: { findMany: async () => [
      { chatId: 'linea:org_1:521@c.us', awaiting: 'AGENTE', lastInboundAt: hace(30), handoffUntil: null,
        contact: { id: 'k1', displayName: 'Brando', waId: '521@c.us' },
        tickets: [{ id: 't1', number: 9, subject: 'Llegó frío', state: 'EN_REVISION', priority: 'ALTA' }],
        messages: [{ body: 'Llegó frío', createdAt: hace(30) }] },
      // El mismo contacto por su LID: no se repite.
      { chatId: 'linea:org_1:999@lid', awaiting: 'BOT', lastInboundAt: hace(20), handoffUntil: null,
        contact: { id: 'k1', displayName: 'Brando', waId: '521@c.us' }, tickets: [], messages: [{ body: 'hola?', createdAt: hace(20) }] },
      // Ya lo atiende alguien desde el panel: no es pendiente.
      { chatId: '522@c.us', awaiting: 'AGENTE', lastInboundAt: hace(50), handoffUntil: new Date(Date.now() + 600000),
        contact: { id: 'k2', displayName: 'Ana', waId: '522@c.us' }, tickets: [], messages: [] },
      { chatId: '523@c.us', awaiting: 'BOT', lastInboundAt: hace(5), handoffUntil: null,
        contact: { id: 'k3', displayName: null, waId: '523@c.us' }, tickets: [], messages: [{ body: '¿Tienen envío?', createdAt: hace(5) }] },
    ] },
    order: { findMany: async (a: unknown) => { anota('order', a); return [
      { id: 'o1', number: 8, organizationId: 'org1', customerName: 'Juan Ruiz', items: [{ nombre: 'Pollo', cantidad: 2 }], totalCents: 51000,
        deliveryMode: 'RECOGER', scheduledFor: null, submittedAt: hace(40), createdAt: hace(45),
        contact: { displayName: 'juan' }, organization: { sales: { prepMinutes: 25 } } },
    ]; } },
    invoice: { findMany: async (a: unknown) => { anota('invoice', a); return [
      { id: 'f1', organizationId: 'org1', status: 'POR_APROBAR', error: null, totalCents: 28500, sandbox: true, createdAt: hace(60),
        receptor: { nombre: 'ESCUELA KEMPER URGATE', rfc: 'EKU9003173C9', usoCfdi: 'G03' }, order: { number: 7 } },
    ]; } },
    document: { groupBy: async () => [{ organizationId: 'org2', _count: { _all: 6 }, _min: { indexedAt: hace(300) } }] },
  };
}

const req = (role: string, organizationId: string | null = null) => ({ panelUser: { role, organizationId, email: 'x@y.z' } }) as never;

test('junta chats, pedidos, facturas y documentos; urgente primero y luego lo más viejo', async () => {
  const prisma = prismaFalso();
  const { items } = await new PanelPendientesController(prisma as never).lista(req('ADMIN'));
  assert.deepEqual(items.map((i) => i.id), ['c:linea:org_1:521@c.us', 'd:org2', 'f:f1', 'o:o1', 'c:523@c.us']);

  const [persona, docs, factura, pedido, sinResp] = items;
  assert.equal(persona!.tipo, 'persona');
  assert.equal(persona!.empresa, 'Pollos Pirata');
  assert.equal(persona!.urgente, true);
  assert.equal(persona!.detalle, 'Llegó frío');
  assert.equal(docs!.titulo, '6 documentos sin clasificar');
  assert.equal(factura!.titulo, 'ESCUELA KEMPER URGATE pidió su factura');
  assert.equal(pedido!.titulo, 'Juan hizo el pedido P-8');
  assert.equal(pedido!.detalle, '2 × Pollo');
  assert.equal(pedido!.ref.minutos, 25);
  assert.equal(sinResp!.tipo, 'sin_responder');
  assert.equal(sinResp!.quien, '523');
  assert.equal(sinResp!.empresa, 'Número principal');
});

test('un usuario de empresa solo ve pedidos y facturas de su empresa', async () => {
  const prisma = prismaFalso();
  const { items } = await new PanelPendientesController(prisma as never).lista(req('EMPRESA', 'org1'));
  assert.deepEqual(items.map((i) => i.tipo).sort(), ['factura', 'pedido']);
  assert.deepEqual((prisma.llamadas.order![0] as { where: unknown }).where, { status: 'POR_ACEPTAR', organizationId: 'org1' });
  assert.equal(((prisma.llamadas.invoice![0] as { where: { organizationId: string } }).where).organizationId, 'org1');
});
