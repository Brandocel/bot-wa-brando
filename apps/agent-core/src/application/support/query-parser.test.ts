import assert from 'node:assert/strict';
import test from 'node:test';
import { esCierre, esInventario, preguntaMeses } from './message-classifier';
import { palabrasClave, parseQuery } from './query-parser';
import { dividirPedidos, leerVariasOpciones } from './pedidos';

// Un solo pedido no se parte aunque traiga comas o "y".
for (const text of [
  'hola buenos días, me pasas la factura de octubre',
  'la factura con folio A100',
  'no era febrero, era marzo',
  'gracias, es todo',
  'la factura de octubre y ya',
]) {
  test(`"${text}" es un solo pedido`, () => {
    assert.equal(dividirPedidos(text), null);
  });
}

test('"facturas y contratos de agosto": el mes dicho al final vale para los dos', () => {
  const r = dividirPedidos('facturas y contratos de agosto de 2026');
  assert.deepEqual(
    r?.pedidos.map((p) => [p.category, p.period?.toISOString().slice(0, 7)]),
    [['FACTURA', '2026-08'], ['CONTRATO', '2026-08']],
  );
});

test('"de noviembre a febrero" cruza el cambio de año', () => {
  const r = dividirPedidos('las facturas de noviembre de 2025 a febrero de 2026');
  assert.deepEqual(
    r?.pedidos.map((p) => p.period?.toISOString().slice(0, 7)),
    ['2025-11', '2025-12', '2026-01', '2026-02'],
  );
});

test('varias opciones de una lista', () => {
  // Rectificaciones: lo de después del "no," es lo que quiere.
  // "No, la 3" es elegir una: sigue por leerNumero(), no se lee como exclusión.
  assert.equal(leerVariasOpciones('No, la 3'), null);
  assert.deepEqual(leerVariasOpciones('la 2 no, la 3'), { incluir: [3], excluir: [2] });
  assert.deepEqual(leerVariasOpciones('No, las dos'), { incluir: [1, 2], excluir: [] });
  assert.deepEqual(leerVariasOpciones('la 2 no'), { incluir: [], excluir: [2] });
  assert.equal(leerVariasOpciones('no, gracias'), null);
  assert.deepEqual(leerVariasOpciones('la 1 y la 3'), [1, 3]);
  assert.deepEqual(leerVariasOpciones('las dos'), [1, 2]);
  assert.equal(leerVariasOpciones('todas'), 'todas');
  assert.equal(leerVariasOpciones('la 2'), null, 'una sola va por el camino de siempre');
  assert.equal(leerVariasOpciones('dame un segundo'), null, 'es una pausa, no la opción 2');
});

for (const [text, incluir, excluir] of [
  ['La 1, no la 3', [1], [3]],
  ['La 1 pero no la 3', [1], [3]],
  ['La 2, excepto la 1', [2], [1]],
  ['La 1 y la 2, pero no la 3', [1, 2], [3]],
  ['Todas menos la 3', 'todas', [3]],
  ['Todas excepto la 2', 'todas', [2]],
  ['Todas menos la 1 y la 3', 'todas', [1, 3]],
  ['La primera y la segunda, excepto la tercera', [1, 2], [3]],
  ['La 1, no la 1', [1], [1]],
  ['No la 3', [], [3]],
  ['Todas menos la 10', 'todas', [10]],
  ['Todas excepto la 0', 'todas', [0]],
] as const) {
  test(`selección con exclusiones: "${text}" separa inclusiones y exclusiones`, () => {
    assert.deepEqual(leerVariasOpciones(text), { incluir, excluir });
  });
}

for (const [text, expected] of [
  ['La 1 y la 2', [1, 2]],
  ['Solo la 1', null],
  ['No, mejor la 2', null],
  ['Todas', 'todas'],
  ['Todas por favor', 'todas'],
  ['Ahora la 3 y la 4', [3, 4]],
  ['Y la 5', null],
  ['La factura de marzo, excepto la 2', null],
  ['El folio A100, no la 3', null],
] as const) {
  test(`selección sin regresión: "${text}" conserva su ruta`, () => {
    assert.deepEqual(leerVariasOpciones(text), expected);
  });
}

for (const text of [
  'No recuerdo el nombre',
  'No me acuerdo del nombre',
  'No sé el folio',
  'No conozco el nombre del archivo',
]) {
  test(`"${text}" no aporta filtros de búsqueda`, () => {
    assert.deepEqual(parseQuery(text), {
      category: null, period: null, folio: null, text: null,
    });
    assert.deepEqual(palabrasClave(text), []);
  });
}

test('pedir el acuerdo de confidencialidad conserva las palabras del documento', () => {
  const text = 'Necesito el acuerdo de confidencialidad';
  assert.equal(parseQuery(text).text, 'acuerdo confidencialidad');
  assert.deepEqual(palabrasClave(text), ['acuerdo', 'confidencialidad']);
});

test('buscar un acuerdo comercial conserva "acuerdo" como palabra clave', () => {
  assert.ok(palabrasClave('Busca el acuerdo comercial').includes('acuerdo'));
  assert.match(parseQuery('Busca el acuerdo comercial').text ?? '', /\bacuerdo comercial\b/);
});

test('desconocer el nombre no descarta una descripción útil del documento', () => {
  const text = 'No conozco el nombre del archivo. Necesito el acuerdo de confidencialidad';
  assert.equal(parseQuery(text).text, 'acuerdo confidencialidad');
  assert.deepEqual(palabrasClave(text), ['acuerdo', 'confidencialidad']);
});

test('preguntar qué contratos hay disponibles se reconoce como inventario', () => {
  const text = '¿Me puedes decir qué contratos tengo disponibles?';
  assert.equal(esInventario(text), true);
});

test('la pregunta por contratos no deja "decir disponibles" como texto de búsqueda', () => {
  const text = '¿Me puedes decir qué contratos tengo disponibles?';
  assert.equal(parseQuery(text).text?.includes('decir disponibles') ?? false, false);
});

test('cambiar de contrato a factura no conserva "olvida" como filtro', () => {
  const query = parseQuery('Olvida lo del contrato. Necesito la factura de marzo de 2026.');
  assert.equal(query.category, 'FACTURA');
  assert.equal(query.period?.toISOString().slice(0, 7), '2026-03');
  assert.equal(query.text?.includes('olvida') ?? false, false);
});

test('la pregunta contextual por los seis meses se reconoce como inventario de meses', () => {
  const text = '¿Cuáles son esos 6 meses?';
  assert.equal(esInventario(text), true);
});

test('la pregunta contextual por los seis meses se reconoce como consulta de periodos', () => {
  const text = '¿Cuáles son esos 6 meses?';
  assert.equal(preguntaMeses(text), true);
});

test('FACTURA más mes y año conserva los tres datos estructurados', () => {
  const query = parseQuery('Solo necesito la factura de marzo de 2026.');
  assert.equal(query.category, 'FACTURA');
  assert.equal(query.period?.toISOString().slice(0, 7), '2026-03');
  assert.equal(query.text, null);
});

for (const text of [
  'La factura que tengo pendiente',
  '¿Qué folio tiene la factura que tengo?',
  '¿Cuál cotización tienes de enero?',
]) {
  test(`"${text}" es una búsqueda, no una pregunta de inventario`, () => {
    assert.equal(esInventario(text), false);
  });
}

for (const text of ['¿Cuáles contratos tienes disponibles?', 'Hola, ¿qué opciones tengo?', '¿Qué contratos hay?']) {
  test(`"${text}" se reconoce como inventario`, () => {
    assert.equal(esInventario(text), true);
  });
}

test('pedir documentos de ciertos meses no es preguntar qué meses hay', () => {
  assert.equal(preguntaMeses('Quiero que me pases los meses pendientes'), false);
  assert.equal(preguntaMeses('Hola, ¿qué meses tienes?'), true);
});

test('desconocer el folio se detecta igual en llamadas repetidas', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(parseQuery('No sé el folio').text, null);
  }
});

for (const text of ['es todo', 'no gracias', 'ya está', 'ya está, gracias', 'con eso basta']) {
  test(`"${text}" cierra la conversación`, () => {
    assert.equal(esCierre(text), true);
  });
}

for (const text of [
  '¿ya está?',
  'ya está?',
  'nada más quería saber si ya está',
  'ya está lista',
  'cuándo ya está',
]) {
  test(`"${text}" pregunta por el pedido, no lo cierra`, () => {
    assert.equal(esCierre(text), false);
  });
}
