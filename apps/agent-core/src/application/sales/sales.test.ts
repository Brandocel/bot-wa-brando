import assert from 'node:assert/strict';
import test from 'node:test';
import { abiertoEn, desdeLocal, leerHorario, siguienteApertura } from './horario';
import { aplicar, faltantes, inventaMontos, montosPermitidos, pedidoVacio, resumen, type Accion, type ReglasVenta } from './pedido';
import { mezclar } from './lectura';

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
process.env.GATEWAY_URL ??= 'http://gateway.test';
process.env.GATEWAY_API_KEY ??= 'x';
process.env.OWNER_WA_ID ??= '5219990000000@c.us';

const TZ = 'America/Cancun'; // UTC-5 todo el año
const horario = leerHorario({
  lun: [['11:00', '21:00']], mar: [['11:00', '21:00']], mie: [['11:00', '21:00']], jue: [['11:00', '21:00']],
  vie: [['11:00', '21:00']], sab: [['11:00', '21:00']], dom: [],
});
const reglas: ReglasVenta = {
  deliveryModes: ['RECOGER', 'DOMICILIO'],
  zonas: [{ nombre: 'Centro', costoCents: 3000 }],
  minOrderCents: 0,
  horario,
  timezone: TZ,
  prepMinutes: 30,
};
const carta = [
  { id: 'entero', name: 'Pollo entero', description: 'rinde para 4', section: 'Pollos', priceCents: 21500 },
  { id: 'medio', name: 'Medio pollo', description: '', section: 'Pollos', priceCents: 12000 },
  { id: 'tortillas', name: 'Tortillas (1 kg)', description: '', section: 'Complementos', priceCents: 3000 },
];
// Viernes 2 de octubre de 2026, 1:00 pm en Cancún.
const viernesMediodia = new Date('2026-10-02T18:00:00Z');
const accion = (a: Partial<Accion> & { tipo: Accion['tipo'] }): Accion =>
  ({ productoId: '', cantidad: 0, texto: '', modo: '', zona: '', ...a });

// ── Horario ─────────────────────────────────────────────────────────────

test('horario: abierto, cerrado y la siguiente apertura en la hora del negocio', () => {
  assert.equal(abiertoEn(horario, viernesMediodia, TZ), true);
  const viernesNoche = new Date('2026-10-03T03:00:00Z'); // vie 10 pm local
  assert.equal(abiertoEn(horario, viernesNoche, TZ), false);
  // El domingo cierra: después del sábado en la noche abre el lunes a las 11.
  const sabadoNoche = new Date('2026-10-04T03:00:00Z');
  assert.equal(siguienteApertura(horario, sabadoNoche, TZ)?.toISOString(), '2026-10-05T16:00:00.000Z');
  assert.equal(desdeLocal('2026-10-02T19:30', TZ)?.toISOString(), '2026-10-03T00:30:00.000Z');
});

// ── Pedido ──────────────────────────────────────────────────────────────

test('el pedido solo acepta productos de la carta y con su precio real', () => {
  const r = aplicar(pedidoVacio(), [
    accion({ tipo: 'agregar', productoId: 'entero', cantidad: 1 }),
    accion({ tipo: 'agregar', productoId: 'inventado', cantidad: 3 }),
    accion({ tipo: 'agregar', productoId: 'tortillas', cantidad: 2 }),
  ], carta, reglas, viernesMediodia);

  assert.deepEqual(r.pedido.items.map((i) => [i.productId, i.cantidad, i.precioCents]), [['entero', 1, 21500], ['tortillas', 2, 3000]]);
  assert.equal(r.avisos.length, 1);
  assert.match(resumen(r.pedido), /Total: \$275/);
});

test('entrega a domicilio cobra la zona; una zona que no existe no se acepta', () => {
  const base = aplicar(pedidoVacio(), [accion({ tipo: 'agregar', productoId: 'medio', cantidad: 1 })], carta, reglas, viernesMediodia).pedido;
  const ok = aplicar(base, [accion({ tipo: 'entrega', modo: 'DOMICILIO', texto: 'Calle 5 #12', zona: 'centro' })], carta, reglas, viernesMediodia);
  assert.equal(ok.pedido.deliveryCents, 3000);
  assert.equal(ok.pedido.zone, 'Centro');

  const lejos = aplicar(base, [accion({ tipo: 'entrega', modo: 'DOMICILIO', texto: 'Playa', zona: 'Tulum' })], carta, reglas, viernesMediodia);
  assert.equal(lejos.pedido.zone, null);
  assert.ok(lejos.avisos.some((a) => /no llegamos/.test(a)));

  const paqueteria = aplicar(base, [accion({ tipo: 'entrega', modo: 'PAQUETERIA' })], carta, reglas, viernesMediodia);
  assert.equal(paqueteria.pedido.deliveryMode, null, 'un modo que la empresa no maneja no se aplica');
});

test('programar: solo a horas en que abre, y no en el pasado', () => {
  const base = pedidoVacio();
  assert.equal(aplicar(base, [accion({ tipo: 'programar', texto: '2026-10-04T13:00' })], carta, reglas, viernesMediodia).pedido.scheduledFor, null, 'domingo cerrado');
  assert.equal(aplicar(base, [accion({ tipo: 'programar', texto: '2026-10-02T12:00' })], carta, reglas, viernesMediodia).pedido.scheduledFor, null, 'ya pasó');
  const ok = aplicar(base, [accion({ tipo: 'programar', texto: '2026-10-05T14:00' })], carta, reglas, viernesMediodia);
  assert.equal(ok.pedido.scheduledFor?.toISOString(), '2026-10-05T19:00:00.000Z');
});

test('faltantes: qué pide antes de cerrar, y cerrado obliga a programar', () => {
  const p = aplicar(pedidoVacio(), [accion({ tipo: 'agregar', productoId: 'entero', cantidad: 1 })], carta, reglas, viernesMediodia).pedido;
  assert.deepEqual(faltantes(p, reglas, viernesMediodia), ['entrega', 'nombre']);
  const domingo = new Date('2026-10-04T18:00:00Z');
  assert.ok(faltantes(p, reglas, domingo).includes('horario'));
});

test('un monto que no está en la carta ni en el pedido se detecta como inventado', () => {
  const p = aplicar(pedidoVacio(), [accion({ tipo: 'agregar', productoId: 'entero', cantidad: 1 })], carta, reglas, viernesMediodia).pedido;
  const ok = montosPermitidos(p, carta, reglas);
  assert.equal(inventaMontos('El pollo entero cuesta $215 y rinde para 4.', ok), false);
  assert.equal(inventaMontos('Te lo dejo en $199, ¿va?', ok), true);
});

// ── Lectura ─────────────────────────────────────────────────────────────

test('la probabilidad mezcla la lectura con lo que de verdad lleva el pedido', () => {
  const entusiasta = { emocion: 'entusiasmado' as const, intensidad: 4, etapa: 'explorando' as const, probabilidad: 80, senal: '' };
  assert.equal(mezclar(entusiasta, 0, { cancelo: false, enviado: false }), 48, 'sin carrito, el entusiasmo solo no basta');
  assert.equal(mezclar(entusiasta, 90, { cancelo: false, enviado: false }), 84);
  assert.equal(mezclar({ ...entusiasta, emocion: 'molesto', intensidad: 5 }, 70, { cancelo: false, enviado: false }), 40);
  assert.ok(mezclar({ ...entusiasta, etapa: 'no_compra' }, 70, { cancelo: false, enviado: false }) <= 10);
  assert.equal(mezclar(entusiasta, 0, { cancelo: false, enviado: true }), 100);
});

// ── Conversación completa, con el modelo simulado ───────────────────────

function arnes() {
  const ordenes: Array<Record<string, unknown>> = [];
  const mensajes: Array<Record<string, unknown>> = [];
  const prisma = {
    organization: {
      findUnique: async () => ({
        id: 'pollos', name: 'Pollos Pirata', active: true, products: carta,
        sales: { enabled: true, businessType: 'pollos asados', pitch: '', hours: {
          lun: [['11:00', '21:00']], mar: [['11:00', '21:00']], mie: [['11:00', '21:00']], jue: [['11:00', '21:00']],
          vie: [['11:00', '21:00']], sab: [['11:00', '21:00']] }, timezone: TZ,
          deliveryModes: ['RECOGER', 'DOMICILIO'], zones: [{ nombre: 'Centro', costo: 30 }], prepMinutes: 30, minOrder: 0 },
      }),
    },
    order: {
      findFirst: async () => ordenes.find((o) => o.status === 'ARMANDO') ?? null,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const o = { id: 'o' + ordenes.length, number: 1042 + ordenes.length, status: 'ARMANDO', confirmPending: false, ...data };
        ordenes.push(o); return o;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const o = ordenes.find((x) => x.id === where.id)!; Object.assign(o, data); return o;
      },
    },
    message: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { mensajes.push(data); } },
  };
  const guion: Array<Record<string, unknown>> = [];
  const llm = {
    extract: async (input: { validate: (v: unknown) => unknown; user: string }) => input.validate(guion.shift()),
    draft: async () => null,
  };
  return { prisma, llm, guion, ordenes, mensajes };
}

const lectura = (probabilidad: number, etapa = 'decidiendo') =>
  ({ emocion: 'interesado', intensidad: 3, etapa, probabilidad, senal: 'pide producto concreto' });

test('venta completa: recomienda, arma, resume con precios reales y solo con "sí" se envía', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: viernesMediodia });
  const { SalesStrategy } = await import('./sales.strategy');
  const h = arnes();
  const ventas = new SalesStrategy(h.prisma as never, h.llm as never, { recent: async () => [] } as never, {} as never);
  const ctx = { contactId: 'c1', conversationId: 'conv1' };
  const msg = (body: string, id: string) => ({ id, chatId: 'linea:pollos:521555@c.us', senderId: '521555@c.us', body, kind: 'TEXT' }) as never;
  const negocio = (await ventas.negocioDe('linea:pollos:521555@c.us'))!;
  assert.ok(negocio, 'la línea de Pollos Pirata vende');

  h.guion.push({
    respuesta: 'Para 4 te recomiendo el pollo entero, rinde bien. ¿Le agrego tortillas?',
    acciones: [{ tipo: 'agregar', productoId: 'entero', cantidad: 1, texto: '', modo: '', zona: '' }],
    lectura: lectura(55),
  });
  const r1 = await ventas.handle(msg('quiero pollo para 4', 'm1'), ctx, negocio);
  assert.match(r1!.text, /Llevas:[\s\S]*Pollo entero — \$215/);
  assert.equal(h.mensajes[0]!.salesStage, 'decidiendo');

  h.guion.push({
    respuesta: 'Perfecto, lo dejo listo.',
    acciones: [
      { tipo: 'agregar', productoId: 'tortillas', cantidad: 1, texto: '', modo: '', zona: '' },
      { tipo: 'entrega', productoId: '', cantidad: 0, texto: '', modo: 'RECOGER', zona: '' },
      { tipo: 'nombre', productoId: '', cantidad: 0, texto: 'Juan Pérez', modo: '', zona: '' },
      { tipo: 'listo', productoId: '', cantidad: 0, texto: '', modo: '', zona: '' },
    ],
    lectura: lectura(85, 'cerrando'),
  });
  const r2 = await ventas.handle(msg('sí, unas tortillas, paso por él, soy Juan Pérez', 'm2'), ctx, negocio);
  assert.match(r2!.text, /Así quedaría tu pedido[\s\S]*Total: \$245[\s\S]*¿Lo confirmo así\?/);
  assert.equal(h.ordenes[0]!.confirmPending, true);
  assert.equal(h.ordenes[0]!.status, 'ARMANDO', 'mostrar el resumen no envía nada');

  const r3 = await ventas.handle(msg('sí, confírmalo', 'm3'), ctx, negocio);
  assert.match(r3!.text, /P-1042.*Pollos Pirata/);
  assert.equal(h.ordenes[0]!.status, 'POR_ACEPTAR');
  assert.equal(h.ordenes[0]!.buyingScore, 100);
});

test('si el modelo inventa un precio, ese texto no sale', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: viernesMediodia });
  const { SalesStrategy } = await import('./sales.strategy');
  const h = arnes();
  const ventas = new SalesStrategy(h.prisma as never, h.llm as never, { recent: async () => [] } as never, {} as never);
  const negocio = (await ventas.negocioDe('linea:pollos:521555@c.us'))!;
  h.guion.push({ respuesta: 'Hoy te lo dejo en $150, oferta especial.', acciones: [], lectura: lectura(40, 'explorando') });
  const r = await ventas.handle({ id: 'm1', chatId: 'linea:pollos:5@c.us', senderId: '5@c.us', body: '¿precio del pollo?', kind: 'TEXT' } as never,
    { contactId: 'c', conversationId: 'v' }, negocio);
  assert.doesNotMatch(r!.text, /\$150/);
});
