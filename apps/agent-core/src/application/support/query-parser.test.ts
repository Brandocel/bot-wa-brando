import assert from 'node:assert/strict';
import test from 'node:test';
import { esCierre, esInventario, preguntaMeses } from './message-classifier';
import { palabrasClave, parseQuery } from './query-parser';

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
