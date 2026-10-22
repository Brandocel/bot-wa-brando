import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularPerfil, clienteParaModelo, type PedidoHistorico } from './perfil-cliente';

const TZ = 'America/Mexico_City';
const AHORA = new Date('2026-10-22T18:00:00Z');

function pedido(fecha: string, items: Array<[string, number, string?]>, extra: Partial<PedidoHistorico> = {}): PedidoHistorico {
  return {
    items: items.map(([nombre, cantidad, nota]) => ({ productId: nombre, nombre, precioCents: 10000, cantidad, nota: nota ?? null })),
    deliveryMode: 'DOMICILIO',
    zone: 'Centro',
    address: 'Calle 1',
    customerName: 'Ana',
    totalCents: 25000,
    at: new Date(fecha),
    ...extra,
  };
}

test('en frío: sin pedidos es NUEVO, o PROSPECTO si ya armó algo', () => {
  assert.equal(calcularPerfil([], { ahora: AHORA, timezone: TZ, armoAlgo: false }).etapa, 'NUEVO');
  assert.equal(calcularPerfil([], { ahora: AHORA, timezone: TZ, armoAlgo: true }).etapa, 'PROSPECTO');
});

test('aprende lo de siempre, sus notas, su ritmo y sus hábitos', () => {
  // Viernes a las 20:00 hora de México (02:00 UTC del sábado).
  const historial = [
    pedido('2026-10-03T02:00:00Z', [['Pollo entero', 1, 'sin picante'], ['Refresco', 2]]),
    pedido('2026-10-10T02:00:00Z', [['Pollo entero', 1], ['Papas', 1]]),
    pedido('2026-10-17T02:00:00Z', [['Pollo entero', 1, 'sin picante'], ['Refresco', 2]]),
  ];
  const p = calcularPerfil(historial, { ahora: AHORA, timezone: TZ, armoAlgo: true });
  assert.equal(p.etapa, 'RECURRENTE');
  assert.equal(p.pedidos, 3);
  assert.equal(p.gastoCents, 75000);
  assert.equal(p.frecuenciaDias, 7);
  assert.equal(p.horaHabitual, 20);
  assert.deepEqual(p.diasHabituales, ['vie']);
  assert.equal(p.entregaPreferida, 'DOMICILIO');
  assert.equal(p.zonaPreferida, 'Centro');
  assert.equal(p.preferencias[0]!.producto, 'Pollo entero');
  assert.equal(p.preferencias[0]!.veces, 3);
  assert.deepEqual(p.preferencias[0]!.notas, ['sin picante']);
  assert.equal(p.preferencias[1]!.producto, 'Refresco');
  assert.equal(p.preferencias[1]!.unidades, 4);
});

test('un cliente que ya tardó el doble de lo normal queda EN_RIESGO; a los 90 días, PERDIDO', () => {
  const ritmoSemanal = [pedido('2026-07-01T18:00:00Z', [['Pollo', 1]]), pedido('2026-07-08T18:00:00Z', [['Pollo', 1]])];
  assert.equal(calcularPerfil(ritmoSemanal, { ahora: new Date('2026-08-20T18:00:00Z'), timezone: TZ, armoAlgo: true }).etapa, 'EN_RIESGO');
  assert.equal(calcularPerfil(ritmoSemanal, { ahora: new Date('2026-10-22T18:00:00Z'), timezone: TZ, armoAlgo: true }).etapa, 'PERDIDO');
});

test('recomendación en frío: sin pedidos en la empresa no inventa nada', () => {
  const texto = clienteParaModelo({
    perfil: { etapa: 'NUEVO', pedidos: 0, ultimoPedidoAt: null, entregaPreferida: null, zonaPreferida: null, horaHabitual: null, diasHabituales: [], nombre: null, frecuenciaDias: null },
    preferencias: [], populares: [], acompanantes: [], enCarta: new Set(['Pollo entero']), ahora: AHORA,
  });
  assert.match(texto, /primera vez/);
  assert.doesNotMatch(texto, /MÁS PEDIDO|SUELE/);
});

test('cliente nuevo en empresa con historia: sugiere lo más pedido que siga en la carta', () => {
  const texto = clienteParaModelo({
    perfil: { etapa: 'NUEVO', pedidos: 0, ultimoPedidoAt: null, entregaPreferida: null, zonaPreferida: null, horaHabitual: null, diasHabituales: [], nombre: null, frecuenciaDias: null },
    preferencias: [],
    populares: [{ producto: 'Pollo entero', veces: 40 }, { producto: 'Combo viejo', veces: 30 }, { producto: 'Papas', veces: 20 }],
    acompanantes: [],
    enCarta: new Set(['Pollo entero', 'Papas']),
    ahora: AHORA,
  });
  assert.match(texto, /LO MÁS PEDIDO AQUÍ.*Pollo entero, Papas/);
  assert.doesNotMatch(texto, /Combo viejo/);
});

test('cliente frecuente: lo de siempre con sus notas, hábitos y acompañantes', () => {
  const p = calcularPerfil(
    [
      pedido('2026-10-03T02:00:00Z', [['Pollo entero', 1, 'sin picante']]),
      pedido('2026-10-10T02:00:00Z', [['Pollo entero', 1]]),
    ],
    { ahora: AHORA, timezone: TZ, armoAlgo: true },
  );
  const texto = clienteParaModelo({
    perfil: p,
    preferencias: p.preferencias,
    populares: [],
    acompanantes: [{ producto: 'Pollo entero', veces: 9 }, { producto: 'Refresco', veces: 7 }],
    enCarta: new Set(['Pollo entero', 'Refresco']),
    ahora: AHORA,
  });
  assert.match(texto, /cliente frecuente, se llama Ana; 2 pedidos/);
  assert.match(texto, /LO QUE SUELE PEDIR: 1 × Pollo entero \(2 de 2 veces; sin picante\)/);
  assert.match(texto, /HÁBITOS: entrega domicilio en Centro/);
  assert.match(texto, /LO ACOMPAÑAN CON: Refresco/);
});
