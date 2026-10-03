import assert from 'node:assert/strict';
import test from 'node:test';
import { abiertoEn, desdeLocal, leerHorario, siguienteApertura } from './horario';
import { aplicar, faltantes, inventaMontos, montosPermitidos, pedidoVacio, resumen, type Accion, type ReglasVenta } from './pedido';
import { leerPresupuesto, montosDePresupuesto } from './presupuesto';
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

test('programar: solo hoy o mañana, a horas en que abre, y no en el pasado', () => {
  const base = pedidoVacio();
  assert.equal(aplicar(base, [accion({ tipo: 'programar', texto: '2026-10-02T12:00' })], carta, reglas, viernesMediodia).pedido.scheduledFor, null, 'ya pasó');
  const ok = aplicar(base, [accion({ tipo: 'programar', texto: '2026-10-03T14:00' })], carta, reglas, viernesMediodia);
  assert.equal(ok.pedido.scheduledFor?.toISOString(), '2026-10-03T19:00:00.000Z', 'mañana sí');

  // "Para el lunes" un viernes: pasado mañana o más lejos no se acepta.
  const lunes = aplicar(base, [accion({ tipo: 'programar', texto: '2026-10-05T14:00' })], carta, reglas, viernesMediodia);
  assert.equal(lunes.pedido.scheduledFor, null);
  assert.deepEqual(lunes.rechazos, ['fecha']);
  assert.ok(lunes.avisos.some((a) => /hoy o para mañana/.test(a)));
  const proximoAnio = aplicar(base, [accion({ tipo: 'programar', texto: '2027-10-01T14:00' })], carta, reglas, viernesMediodia);
  assert.equal(proximoAnio.pedido.scheduledFor, null);
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
  const borradores: Array<string | null> = [];
  const llm = {
    extract: async (input: { validate: (v: unknown) => unknown; user: string }) => input.validate(guion.shift()),
    draft: async () => borradores.shift() ?? null,
  };
  return { prisma, llm, guion, ordenes, mensajes, borradores };
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
  // La lectura viaja en la respuesta y la escribe el caso de uso con su
  // transacción: escribirla aquí bloqueaba el turno (el renglón ya está tomado).
  assert.equal(r1!.lecturaVenta?.salesStage, 'decidiendo');
  assert.equal(h.mensajes.length, 0, 'ventas no escribe el mensaje por su cuenta');

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

test('un producto de solo miércoles no se cierra otro día, pero sí programado para el miércoles si es mañana', () => {
  const conMiercoles = [...carta, { id: 'super', name: 'Súper Miércoles', description: '', section: 'Miércoles', priceCents: 22000, availableDays: ['mie'] }];
  const r = aplicar(pedidoVacio(), [
    accion({ tipo: 'agregar', productoId: 'super', cantidad: 1, texto: 'BBQ' }),
    accion({ tipo: 'entrega', modo: 'RECOGER' }),
    accion({ tipo: 'nombre', texto: 'Ana' }),
  ], conMiercoles, reglas, viernesMediodia);
  assert.ok(r.avisos.some((a) => /solo se vende los miércoles/.test(a)));
  assert.deepEqual(faltantes(r.pedido, reglas, viernesMediodia, conMiercoles), ['dia']);

  // Desde el viernes, el miércoles queda demasiado lejos.
  const lejos = aplicar(r.pedido, [accion({ tipo: 'programar', texto: '2026-10-07T13:00' })], conMiercoles, reglas, viernesMediodia);
  assert.equal(lejos.pedido.scheduledFor, null);

  // El martes sí: el miércoles es mañana.
  const martes = new Date('2026-10-06T18:00:00Z');
  const miercoles = aplicar(r.pedido, [accion({ tipo: 'programar', texto: '2026-10-07T13:00' })], conMiercoles, reglas, martes);
  assert.deepEqual(faltantes(miercoles.pedido, reglas, martes, conMiercoles), []);
});

// ── Fallas vistas en las pruebas del 3 de octubre de 2026 ───────────────

test('una zona a la que no se llega no entra al pedido, ni su dirección (Veracruz)', () => {
  const base = aplicar(pedidoVacio(), [accion({ tipo: 'agregar', productoId: 'medio', cantidad: 1 })], carta, reglas, viernesMediodia).pedido;
  const r = aplicar(base, [accion({ tipo: 'entrega', modo: 'DOMICILIO', texto: 'Calle Polmorón, Veracruz', zona: 'Veracruz' })], carta, reglas, viernesMediodia);
  assert.equal(r.pedido.deliveryMode, null);
  assert.equal(r.pedido.address, null);
  assert.deepEqual(r.rechazos, ['zona']);
  assert.ok(faltantes(r.pedido, reglas, viernesMediodia).includes('entrega'), 'el pedido no se puede cerrar así');
});

test('poner el sabor a lo que ya estaba no lo duplica', () => {
  const r = aplicar(pedidoVacio(), [
    accion({ tipo: 'agregar', productoId: 'entero', cantidad: 2, texto: 'sabor a elegir' }),
    accion({ tipo: 'agregar', productoId: 'entero', cantidad: 2, texto: 'Pastor' }),
  ], carta, reglas, viernesMediodia);
  assert.deepEqual(r.pedido.items.map((i) => [i.productId, i.cantidad, i.nota]), [['entero', 2, 'Pastor']]);
  assert.match(resumen(r.pedido), /Total: \$430/);
});

test('el resumen se lee claro: sin "1 ×" y la cantidad al final', () => {
  const r = aplicar(pedidoVacio(), [
    accion({ tipo: 'agregar', productoId: 'medio', cantidad: 1, texto: 'Pastor' }),
    accion({ tipo: 'agregar', productoId: 'tortillas', cantidad: 2 }),
  ], carta, reglas, viernesMediodia);
  const texto = resumen(r.pedido);
  assert.match(texto, /• Medio pollo \(Pastor\) — \$120/);
  assert.match(texto, /• Tortillas \(1 kg\) ×2 — \$60/);
  assert.doesNotMatch(texto, /\d ×/);
});

test('presupuesto: se lee de lo que dice el cliente, no de cualquier número', () => {
  assert.equal(leerPresupuesto(['Tengo 250']), 25000);
  assert.equal(leerPresupuesto(['Quiero saber si cuesta 120 pesos porque no tengo más']), 12000);
  assert.equal(leerPresupuesto(['dame 2 pollos', 'traigo $300']), 30000, 'el más reciente que diga uno');
  assert.equal(leerPresupuesto(['Para 3 personas', 'Vamos a llevar 2 pollos y medio']), null);
});

test('con presupuesto, las cuentas que salen de la carta se pueden decir', () => {
  const ok = montosPermitidos(pedidoVacio(), carta, reglas);
  for (const m of montosDePresupuesto(carta, 25000)) ok.add(m);
  // Pollo entero ($215) cabe en $250 y sobran $35; medio pollo + 4 tortillas = $240.
  assert.equal(inventaMontos('Con $250 te alcanza el pollo entero de $215 y te sobran $35.', ok), false);
  assert.equal(inventaMontos('Medio pollo y cuatro tortillas: $240.', ok), false);
  assert.equal(inventaMontos('Te lo dejo en $199.', ok), true);
});

const analisis = { quiere: '', pide_o_pregunta: 'otro', ya_sabemos: '', ambiguo: '', regla: '' };

async function ventasDePrueba(
  t: { mock: { timers: { enable: (o: { apis: Array<'Date'>; now: Date }) => void } } },
  tickets: unknown = {},
) {
  t.mock.timers.enable({ apis: ['Date'], now: viernesMediodia });
  const { SalesStrategy } = await import('./sales.strategy');
  const h = arnes();
  const ventas = new SalesStrategy(h.prisma as never, h.llm as never, { recent: async () => [] } as never, tickets as never);
  const negocio = (await ventas.negocioDe('linea:pollos:521555@c.us'))!;
  let n = 0;
  const decir = (body: string) =>
    ventas.handle({ id: `m${++n}`, chatId: 'linea:pollos:521555@c.us', senderId: '521555@c.us', body, kind: 'TEXT' } as never,
      { contactId: 'c1', conversationId: 'conv1' }, negocio);
  return { h, decir };
}

test('si una regla frena algo, no sale el "listo" del modelo: sale la corrección', async (t) => {
  const { h, decir } = await ventasDePrueba(t);
  h.guion.push({
    analisis,
    respuesta: 'Sí, llegamos a Veracruz. Listo, te lo dejamos ahí.',
    acciones: [{ tipo: 'entrega', productoId: '', cantidad: 0, texto: 'Calle Polmorón', modo: 'DOMICILIO', zona: 'Veracruz' }],
    lectura: lectura(60),
  });
  h.borradores.push('Perdón, me equivoqué: a Veracruz no llegamos. ¿Me mandas otra ubicación, lo recoges o lo cancelamos?');
  const r = await decir('¿Llegan hasta Veracruz?');
  assert.doesNotMatch(r!.text, /llegamos a Veracruz|Listo/);
  assert.match(r!.text, /^Perdón, me equivoqué/);
});

test('si la corrección tampoco sirve, va primero el aviso y luego lo que falta (nunca relleno)', async (t) => {
  const { h, decir } = await ventasDePrueba(t);
  h.guion.push({
    analisis,
    respuesta: 'Listo, te lo dejamos en Veracruz.',
    acciones: [{ tipo: 'entrega', productoId: '', cantidad: 0, texto: 'Centro de Veracruz', modo: 'DOMICILIO', zona: 'Veracruz' }],
    lectura: lectura(60),
  });
  const r = await decir('que llegue a Veracruz');
  assert.match(r!.text, /^A esa zona no llegamos a domicilio\./);
  assert.doesNotMatch(r!.text, /Qué más te gustaría agregar/);
});

test('con "tengo 250" el bot puede hablar de lo que alcanza sin que se tire su texto', async (t) => {
  const { h, decir } = await ventasDePrueba(t);
  h.guion.push({
    analisis,
    respuesta: 'Con $250 te alcanza el pollo entero de $215 y te sobran $35. ¿Te late?',
    acciones: [],
    lectura: lectura(45, 'explorando'),
  });
  const r = await decir('Tengo 250');
  assert.equal(r!.text, 'Con $250 te alcanza el pollo entero de $215 y te sobran $35. ¿Te late?');
});

test('al pasar a una persona, el bot pide callarse en el hilo', async (t) => {
  const tickets = { abrirEscalado: async () => ({ ticket: {}, agente: null }) };
  const { h, decir } = await ventasDePrueba(t, tickets);
  h.guion.push({ analisis, respuesta: '', acciones: [{ tipo: 'persona', productoId: '', cantidad: 0, texto: '', modo: '', zona: '' }], lectura: lectura(30) });
  const r = await decir('soy alérgico, ¿qué trae el postre?');
  assert.equal(r!.awaiting, 'AGENTE');
  assert.ok((r!.silencioMs ?? 0) > 0);
});
