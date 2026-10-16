import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { firmaValida, formulario } from '../../infrastructure/pagos/stripe.client';
import { PlanService, type StripePort } from './plan.service';

/** Prisma de mentira: solo la tabla Suscripcion y una organización. */
function prismaFalso() {
  const filas = new Map<string, any>();
  const por = (where: any) =>
    where.organizationId
      ? filas.get(where.organizationId)
      : [...filas.values()].find((f) => f.stripeSubscriptionId === where.stripeSubscriptionId);
  const aplicar = (fila: any, data: any) => {
    for (const [k, v] of Object.entries(data)) fila[k] = (v as any)?.increment ? fila[k] + (v as any).increment : v;
    return fila;
  };
  return {
    filas,
    organization: {
      findUnique: async ({ where }: any) => ({ id: where.id, name: 'ALAN', plan: filas.get(where.id) ?? null }),
    },
    suscripcion: {
      findUnique: async ({ where }: any) => por(where) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const f = filas.get(where.organizationId);
        if (f) return aplicar(f, update);
        const nueva = { estado: 'PENDIENTE', mesesPagados: 0, stripeSubscriptionId: null, stripeScheduleId: null, ultimoCobroId: null, ...create };
        filas.set(where.organizationId, nueva);
        return nueva;
      },
      update: async ({ where, data }: any) => aplicar(por(where), data),
      count: async ({ where }: any) =>
        [...filas.entries()].filter(
          ([id, f]) => id !== where.organizationId.not && f.estado !== 'CANCELADA' && f.pruebaHasta > where.pruebaHasta.gt,
        ).length,
      updateMany: async ({ where, data }: any) => {
        const f = por(where);
        if (f) aplicar(f, data);
        return { count: f ? 1 : 0 };
      },
    },
  };
}

function stripeFalso(conPrueba = false) {
  const llamadas: Array<{ metodo: string; ruta: string; params?: any }> = [];
  const api: StripePort = {
    pedir: (async (metodo: string, ruta: string, params?: any) => {
      llamadas.push({ metodo, ruta, params });
      if (ruta.startsWith('products/')) return { id: ruta.slice(9) };
      if (ruta === 'tax_rates') return metodo === 'GET' ? { data: [] } : { id: 'txr_iva' };
      if (ruta === 'prices') return metodo === 'GET' ? { data: [] } : { id: `price_${params.lookup_key}` };
      if (ruta === 'checkout/sessions') return { url: 'https://checkout.stripe.com/c/pay/x' };
      if (ruta === 'subscription_schedules') return { id: 'sub_sched_1', phases: [{ start_date: 100, end_date: 200, trial_end: conPrueba ? 200 : null }] };
      return {};
    }) as StripePort['pedir'],
  };
  return { api, llamadas };
}

async function conLiga(conFactura = false) {
  const prisma = prismaFalso();
  const stripe = stripeFalso();
  const plan = new PlanService(prisma as any, stripe.api);
  await plan.crearLiga('org_alan', conFactura);
  return { prisma, stripe, plan };
}

test('la liga cobra el mes 1 con IVA', async () => {
  const { stripe, prisma } = await conLiga();
  const sesion = stripe.llamadas.find((l) => l.ruta === 'checkout/sessions')!;
  assert.deepEqual(sesion.params.line_items, [{ price: 'price_persona_m1', quantity: 1, tax_rates: ['txr_iva'] }]);
  assert.equal(prisma.filas.get('org_alan').estado, 'PENDIENTE');
});

test('al pagar arma la escalera de cinco escalones y suelta en el piso', async () => {
  const { stripe, prisma, plan } = await conLiga(true);
  await plan.manejarEvento({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: 'org_alan', subscription: 'sub_1', customer: 'cus_1' } },
  });
  const escalera = stripe.llamadas.find((l) => l.ruta === 'subscription_schedules/sub_sched_1')!;
  assert.equal(escalera.params.end_behavior, 'release');
  assert.deepEqual(
    escalera.params.phases.map((f: any) => f.items.map((i: any) => i.price)),
    [1, 2, 3, 4, 5].map((m) => [`price_persona_m${m}`, `price_persona_factura_m${m}`]),
  );
  assert.equal(escalera.params.phases[0].end_date, 200);
  assert.equal(prisma.filas.get('org_alan').estado, 'ACTIVA');

  // Stripe reintenta el mismo evento: no se arma otra escalera.
  await plan.manejarEvento({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: 'org_alan', subscription: 'sub_1', customer: 'cus_1' } },
  });
  assert.equal(stripe.llamadas.filter((l) => l.ruta === 'subscription_schedules').length, 1);
});

test('cada cobro cuenta una vez y el siguiente baja de escalón', async () => {
  const { prisma, plan } = await conLiga();
  await plan.manejarEvento({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: 'org_alan', subscription: 'sub_1' } },
  });
  const cobro = { type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', amount_paid: 100804 } } };
  await plan.manejarEvento(cobro);
  await plan.manejarEvento(cobro);
  assert.equal(prisma.filas.get('org_alan').mesesPagados, 1);
  assert.equal((await plan.vista('org_alan')).suscripcion!.siguiente.subtotal, 768);
});

test('el primer cobro antes que la liga se liga por la metadata', async () => {
  const { prisma, plan } = await conLiga();
  await plan.manejarEvento({
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_1',
        amount_paid: 100804,
        parent: { subscription_details: { subscription: 'sub_9', metadata: { organizationId: 'org_alan' } } },
      },
    },
  });
  assert.equal(prisma.filas.get('org_alan').stripeSubscriptionId, 'sub_9');
  assert.equal(prisma.filas.get('org_alan').mesesPagados, 1);
});

test('si cancela y vuelve, la liga nueva empieza en el mes 1', async () => {
  const { plan } = await conLiga();
  await plan.manejarEvento({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'org_alan', subscription: 'sub_1' } } });
  await plan.manejarEvento({ type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', amount_paid: 1 } } });
  await plan.manejarEvento({ type: 'invoice.paid', data: { object: { id: 'in_2', subscription: 'sub_1', amount_paid: 1 } } });
  await assert.rejects(plan.crearLiga('org_alan', false), /ya tiene un plan activo/);

  await plan.manejarEvento({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  await plan.crearLiga('org_alan', false);
  const vista = await plan.vista('org_alan');
  assert.equal(vista.suscripcion!.mesesPagados, 0);
  assert.equal(vista.suscripcion!.siguiente.subtotal, 869);
});

test('formulario anida como Stripe', () => {
  assert.equal(
    decodeURIComponent(formulario({ a: [{ b: 1, c: ['x'] }], d: { e: true }, f: undefined }).toString()),
    'a[0][b]=1&a[0][c][0]=x&d[e]=true',
  );
});

test('firma del webhook', () => {
  const cuerpo = '{"id":"evt_1"}';
  const t = 1_700_000_000;
  const v1 = createHmac('sha256', 'whsec_x').update(`${t}.${cuerpo}`).digest('hex');
  assert.equal(firmaValida(cuerpo, `t=${t},v1=${v1}`, 'whsec_x', t * 1000), true);
  assert.equal(firmaValida(cuerpo, `t=${t},v1=${v1}`, 'whsec_otro', t * 1000), false);
  assert.equal(firmaValida(cuerpo, `t=${t},v1=${v1}`, 'whsec_x', (t + 600) * 1000), false);
});

test('mes gratis: hasta 3 a la vez y una sola vez por cuenta', async () => {
  const prisma = prismaFalso();
  const plan = new PlanService(prisma as any, null);
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const id of ['org_a', 'org_b', 'org_c']) await plan.darPrueba(id, ayer);
  await assert.rejects(plan.darPrueba('org_d', new Date()), /Ya hay 3 personas/);
  await assert.rejects(plan.darPrueba('org_a', new Date()), /ya tuvo su mes gratis/);
  const vista = await plan.vista('org_a');
  assert.equal(vista.suscripcion!.estado, 'PRUEBA');
  assert.equal(vista.suscripcion!.prueba!.vencida, false);
});

test('una fecha que ya dejó atrás el mes gratis no se acepta', async () => {
  const plan = new PlanService(prismaFalso() as any, null);
  await assert.rejects(plan.darPrueba('org_a', new Date('2026-01-01')), /ya habría terminado/);
});

test('la liga en el mes gratis no cobra hasta que acaba, y luego empieza en el mes 1', async () => {
  const prisma = prismaFalso();
  const stripe = stripeFalso(true);
  const plan = new PlanService(prisma as any, stripe.api);
  await plan.darPrueba('org_alan', new Date());
  await plan.crearLiga('org_alan', false);
  const sesion = stripe.llamadas.find((l) => l.ruta === 'checkout/sessions')!;
  assert.equal(sesion.params.subscription_data.trial_end, Math.floor(prisma.filas.get('org_alan').pruebaHasta.getTime() / 1000));

  await plan.manejarEvento({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'org_alan', subscription: 'sub_1' } } });
  const fases = stripe.llamadas.find((l) => l.ruta === 'subscription_schedules/sub_sched_1')!.params.phases;
  assert.equal(fases[0].trial, true);
  assert.deepEqual(
    fases.slice(1).map((f: any) => f.items[0].price),
    [1, 2, 3, 4, 5].map((m) => `price_persona_m${m}`),
  );
});
