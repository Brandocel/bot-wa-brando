import assert from 'node:assert/strict';
import test from 'node:test';
import { esInventario, preguntaMeses } from './message-classifier';
import { palabrasClave, parseQuery } from './query-parser';

test('no recuerda el nombre no aporta "recuerdo" como filtro libre', () => {
  const query = parseQuery('No recuerdo el nombre');
  assert.equal(query.text?.includes('recuerdo') ?? false, false);
  assert.equal(palabrasClave('No recuerdo el nombre').includes('recuerdo'), false);
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
