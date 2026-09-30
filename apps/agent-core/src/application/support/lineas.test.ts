import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatDeLinea,
  lineaDeEmpresa,
  prefijoDeLinea,
  separarChat,
} from '../../domain/message/linea';

// config.ts exige estas variables al cargarse; en el test no se usan.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
process.env.GATEWAY_URL ??= 'http://gateway.test';
process.env.GATEWAY_API_KEY ??= 'x';
process.env.OWNER_WA_ID ??= '5219990000000@c.us';

// ── Identificador de conversación por línea ─────────────────────────────

test('el número principal conserva el chatId de siempre', () => {
  assert.equal(chatDeLinea(null, '521555@c.us'), '521555@c.us');
  assert.equal(chatDeLinea('principal', '521555@c.us'), '521555@c.us');
  assert.deepEqual(separarChat('521555@c.us'), { linea: null, chat: '521555@c.us' });
});

test('por la línea de una empresa, la misma persona es otra conversación', () => {
  const vega = chatDeLinea('org_vega', '521555@c.us');
  const pollos = chatDeLinea('org_pollos', '521555@c.us');
  assert.notEqual(vega, pollos);
  assert.deepEqual(separarChat(vega), { linea: 'org_vega', chat: '521555@c.us' });
  assert.ok(vega.startsWith(prefijoDeLinea('org_vega')));
});

test('el id de línea de una empresa es seguro como nombre de carpeta', () => {
  assert.match(lineaDeEmpresa('cmg1abc.../x'), /^[a-z0-9_-]+$/i);
});

// ── Entrada: el mapper arma la conversación por línea ───────────────────

test('el mapper arma el chat por línea y nunca lo toma como chat del dueño', async () => {
  const { OpenWaMessageMapper } = await import('../../infrastructure/whatsapp/open-wa.mapper');
  const mapper = new OpenWaMessageMapper();
  const base = {
    id: 'org_vega_false_521555@c.us_ABC',
    chatId: '521555@c.us',
    from: '521555@c.us',
    to: '5219981112222@c.us',
    sender: { id: '521555@c.us' },
    chat: { id: '521555@c.us', contact: { isMe: true } },
    type: 'chat',
    body: 'hola',
    t: 1,
  };

  const deLinea = mapper.toDomain({ ...base, linea: 'org_vega' })!;
  assert.equal(deLinea.chatId, 'linea:org_vega:521555@c.us');
  assert.equal(deLinea.senderId, '521555@c.us', 'los permisos siguen yendo por el número de quien escribe');
  assert.equal(deLinea.isSelfChat, false);

  const principal = mapper.toDomain({ ...base, linea: 'principal' })!;
  assert.equal(principal.chatId, '521555@c.us');
});

// ── Salida: el adaptador manda por la línea correcta ────────────────────

test('la respuesta sale por el mismo número por el que escribieron', async () => {
  const { GatewayMessagingAdapter } = await import('../../infrastructure/whatsapp/gateway-messaging.adapter');
  const llamadas: { url: string; body: Record<string, unknown> }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messageId: 'm1' }), { status: 200 });
  }) as typeof fetch;

  try {
    const adapter = new GatewayMessagingAdapter();
    await adapter.sendText('linea:org_vega:521555@c.us', 'hola');
    await adapter.sendText('521555@c.us', 'hola');
    await adapter.sendFile('linea:org_vega:521555@c.us', { filename: 'f.pdf', base64: 'data:application/pdf;base64,AA==' });
  } finally {
    globalThis.fetch = original;
  }

  assert.deepEqual(llamadas[0]!.body, { to: '521555@c.us', linea: 'org_vega', text: 'hola' });
  assert.deepEqual(llamadas[1]!.body, { to: '521555@c.us', text: 'hola' }, 'el principal, sin línea');
  assert.equal(llamadas[2]!.body.to, '521555@c.us');
  assert.equal(llamadas[2]!.body.linea, 'org_vega');
});

// ── Seguridad: por la línea de una empresa, solo esa empresa ────────────

function prismaDeMembresias() {
  const consultas: Record<string, unknown>[] = [];
  const membresias = [
    { organizationId: 'vega', organization: { id: 'vega', name: 'Constructora Vega' } },
    { organizationId: 'pollos', organization: { id: 'pollos', name: 'Pollos Pirata' } },
  ].map((m) => ({ ...m, role: 'MANAGER', verifiedAt: new Date(), grants: [] }));

  return {
    consultas,
    organization: {
      findUnique: async ({ where }: { where: { waLineId: string } }) =>
        where.waLineId === 'org_vega' ? { id: 'vega' } : null,
    },
    membership: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        consultas.push(where);
        return where.organizationId
          ? membresias.filter((m) => m.organizationId === where.organizationId)
          : membresias;
      },
    },
  };
}

test('una persona de dos empresas, por el número principal ve las dos', async () => {
  const { AccessScopeService } = await import('./access-scope.service');
  const svc = new AccessScopeService(prismaDeMembresias() as never);
  const r = await svc.resolve('521555@c.us', '521555@c.us');
  assert.deepEqual(r.scopes.map((s) => s.organizationId).sort(), ['pollos', 'vega']);
});

test('la misma persona, por el número de Vega, solo ve Vega', async () => {
  const { AccessScopeService } = await import('./access-scope.service');
  const prisma = prismaDeMembresias();
  const svc = new AccessScopeService(prisma as never);
  const r = await svc.resolve('521555@c.us', 'linea:org_vega:521555@c.us');
  assert.equal(r.decision, 'ALLOW');
  assert.deepEqual(r.scopes.map((s) => s.organizationId), ['vega']);
  assert.equal(prisma.consultas[0]!.organizationId, 'vega', 'se filtra en la consulta, no después');
});

test('una línea que ya no es de ninguna empresa no da acceso a nada', async () => {
  const { AccessScopeService } = await import('./access-scope.service');
  const svc = new AccessScopeService(prismaDeMembresias() as never);
  const r = await svc.resolve('521555@c.us', 'linea:org_borrada:521555@c.us');
  assert.equal(r.decision, 'DENY_NO_MEMBERSHIP');
  assert.deepEqual(r.scopes, []);
});

// ── El dueño solo es dueño en el número principal ───────────────────────

test('los comandos de dueño no corren desde el número de una empresa', async () => {
  const { AuthorizationFilter } = await import('../pipeline/filters/authorization.filter');
  const prisma = { contact: { findUnique: async () => null } };
  const filtro = new AuthorizationFilter(prisma as never);
  const dueno = process.env.OWNER_WA_ID!;

  const principal = { message: { senderId: dueno, chatId: dueno }, role: null, stoppedBy: null, stopReason: null };
  await filtro.handle(principal as never, async () => undefined);
  assert.equal(principal.role, 'OWNER');

  const enLinea = { message: { senderId: dueno, chatId: `linea:org_vega:${dueno}` }, role: null, stoppedBy: null, stopReason: null };
  await filtro.handle(enLinea as never, async () => undefined);
  assert.equal(enLinea.role, 'PROSPECT');
});
