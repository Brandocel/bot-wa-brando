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
  ].map((m) => ({
    ...m,
    id: `m-${m.organizationId}`,
    role: 'MANAGER',
    verifiedAt: new Date(),
    fullName: 'Ana Ruiz Soto',
    nameConfirmedAt: new Date(),
    grants: [],
  }));

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

// ── Nombre completo y titular ───────────────────────────────────────────

function prismaDeUnaMembresia(m: Record<string, unknown>) {
  const actualizadas: unknown[] = [];
  const base = {
    id: 'm1',
    organizationId: 'vega',
    organization: { id: 'vega', name: 'Constructora Vega' },
    role: 'VIEWER',
    verifiedAt: new Date(),
    fullName: 'Ana Ruiz Soto',
    nameConfirmedAt: new Date(),
    grants: [{ category: 'FACTURA', periodFrom: null, periodTo: null }],
    ...m,
  };
  return {
    actualizadas,
    organization: { findUnique: async () => null },
    membership: {
      findMany: async () => [base],
      updateMany: async (args: unknown) => { actualizadas.push(args); return { count: 1 }; },
    },
  };
}

test('sin nombre confirmado, la membresía no abre nada y pide el nombre', async () => {
  const { AccessScopeService } = await import('./access-scope.service');
  const svc = new AccessScopeService(prismaDeUnaMembresia({ nameConfirmedAt: null }) as never);
  const r = await svc.resolve('521555@c.us', '521555@c.us');
  assert.equal(r.decision, 'NEEDS_NAME');
  assert.deepEqual(r.scopes, []);
  assert.equal(r.pendientesNombre?.[0]?.fullName, 'Ana Ruiz Soto');
});

test('un cliente (VIEWER) solo ve lo que va a su nombre; un MANAGER, toda su empresa', async () => {
  const { AccessScopeService } = await import('./access-scope.service');
  const viewer = await new AccessScopeService(prismaDeUnaMembresia({}) as never).resolve('521555@c.us');
  assert.equal(viewer.decision, 'ALLOW');
  assert.deepEqual(viewer.scopes[0]!.titular, ['ana', 'ruiz', 'soto']);

  const manager = await new AccessScopeService(prismaDeUnaMembresia({ role: 'MANAGER' }) as never).resolve('521555@c.us');
  assert.equal(manager.scopes[0]!.titular, undefined);
});

test('confirmar el nombre: sin acentos ni orden, pero completo', async () => {
  const { AccessScopeService } = await import('./access-scope.service');
  const prisma = prismaDeUnaMembresia({ nameConfirmedAt: null });
  const svc = new AccessScopeService(prisma as never);
  const { pendientesNombre } = await svc.resolve('521555@c.us');

  assert.deepEqual(await svc.confirmarNombre(pendientesNombre!, 'Ana Ruiz'), []);
  assert.equal(prisma.actualizadas.length, 0);

  const ok = await svc.confirmarNombre(pendientesNombre!, 'soto ana RUÍZ');
  assert.equal(ok.length, 1);
  assert.equal(prisma.actualizadas.length, 1);
});

test('el filtro del cliente va al WHERE: A1 no alcanza el documento de A2', async () => {
  const { DocumentSearchService } = await import('./document-search.service');
  const consultas: Record<string, unknown>[] = [];
  const prisma = { document: { findMany: async ({ where }: { where: Record<string, unknown> }) => { consultas.push(where); return []; } } };
  const svc = new DocumentSearchService(prisma as never);
  await svc.search(
    [{
      organizationId: 'vega', organizationName: 'Vega', strippedByVerification: [],
      windows: [{ category: 'FACTURA', periodFrom: null, periodTo: null }],
      titular: ['ana', 'ruiz'],
    }],
    { category: 'FACTURA', period: null, folio: 'C3001', text: null },
  );
  const json = JSON.stringify(consultas[0]);
  assert.match(json, /"holderKey":\{"contains":" ana "\}/);
  assert.match(json, /"holderKey":\{"contains":" ruiz "\}/);
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

// ── Panel de empresa: cerrado por defecto ───────────────────────────────

async function guardPara(rol: string, paraEmpresa: boolean) {
  const { PanelGuard } = await import('../../infrastructure/http/panel/panel.guard');
  const identidad = { id: 'u', email: 'u@x.mx', name: 'U', role: rol, organizationId: rol === 'EMPRESA' ? 'vega' : null, organizationName: null };
  const guard = new PanelGuard(
    { resolve: async () => identidad } as never,
    { getAllAndOverride: () => paraEmpresa } as never,
  );
  const req: Record<string, unknown> = { headers: { cookie: 'panel_session=t' } };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null };
  return guard.canActivate(ctx as never);
}

test('un usuario de empresa no entra a rutas que no están marcadas para empresas', async () => {
  await assert.rejects(guardPara('EMPRESA', false), /no está disponible/);
  assert.equal(await guardPara('EMPRESA', true), true);
  assert.equal(await guardPara('ADMIN', false), true, 'el equipo sigue entrando a todo');
});

test('la empresa solo toca números suyos, y lo sensible pide el doble paso', async () => {
  const { PanelApiController } = await import('../../infrastructure/http/panel/panel-api.controller');
  const auditoria: unknown[] = [];
  const verificados: string[] = [];
  const prisma = {
    membership: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        ({ id: where.id, organizationId: where.id === 'de-vega' ? 'vega' : 'pollos', contact: { waId: '521@c.us' } }),
    },
    accessAudit: { create: async (a: unknown) => { auditoria.push(a); } },
  };
  const directory = { verifyMember: async (id: string) => { verificados.push(id); } };
  const ctrl = new PanelApiController(prisma as never, {} as never, directory as never, {} as never, {} as never, {} as never, {} as never);
  const req = { panelUser: { role: 'EMPRESA', organizationId: 'vega', email: 'paula@vega.mx' } };

  await assert.rejects(ctrl.verifyNumber(req as never, { id: 'de-pollos', confirmo: true, nota: 'le llamé y confirmó' }), /no existe/);
  await assert.rejects(ctrl.verifyNumber(req as never, { id: 'de-vega' }), /confirma que hablaste/);
  assert.deepEqual(verificados, []);

  await ctrl.verifyNumber(req as never, { id: 'de-vega', confirmo: true, nota: 'le llamé y confirmó' });
  assert.deepEqual(verificados, ['de-vega']);
  assert.match(JSON.stringify(auditoria[0]), /PANEL_VERIFICAR.*panel: paula@vega\.mx/);
});
