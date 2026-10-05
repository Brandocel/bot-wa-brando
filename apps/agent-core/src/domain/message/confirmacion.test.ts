import assert from 'node:assert/strict';
import test from 'node:test';
import { esConfirmacion } from './confirmacion';

test('cuentan como sí', () => {
  for (const t of [
    'sí', 'Si', 'Simón', 'siii', 'va', 'dale', 'ok', 'Perfecto si así está bien', 'así está bien', 'así',
    'sí, por favor', 'confírmalo', 'va, mándalo', 'de acuerdo', 'órale', 'sale pues', 'si gracias', 'perfecto 👍',
    'esta bien', 'me parece bien', 'sí, así', 'okey gracias', 'eso es todo',
    // Como escriben de verdad.
    'zi', 'ci', 'simom', 'okei', 'oki', 'perfeto', 'esta vien', 'asi esta vien grasias', 'si porfabor', 'klaro', 'sii plis',
  ]) {
    assert.equal(esConfirmacion(t), true, t);
  }
});

test('no cuentan como sí: cambios, dudas o cosas nuevas', () => {
  for (const t of [
    'no', 'sí pero sin cebolla', 'perfecto pero cambia la dirección', 'mejor 2', 'espera', 'sí, a las 3',
    'sí, agrega tortillas', 'si mas salsa', 'hola', '', 'gracias', 'creo', 'quiero factura', 'está mal',
  ]) {
    assert.equal(esConfirmacion(t), false, t);
  }
});
