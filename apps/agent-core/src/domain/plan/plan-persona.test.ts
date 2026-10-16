import assert from 'node:assert/strict';
import test from 'node:test';
import { clavePrecio, cobroDelMes, escalonDe } from './plan-persona';

test('baja cada mes y se queda en el piso desde el quinto', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 24].map((m) => cobroDelMes(m, false).subtotal),
    [869, 768, 669, 569, 469, 469, 469],
  );
});

test('el IVA va encima', () => {
  assert.deepEqual(cobroDelMes(1, false), { subtotal: 869, iva: 139.04, total: 1008.04 });
  assert.deepEqual(cobroDelMes(5, false), { subtotal: 469, iva: 75.04, total: 544.04 });
});

test('facturación suma su propio escalón', () => {
  assert.equal(cobroDelMes(1, true).subtotal, 869 + 259);
  assert.equal(cobroDelMes(9, true).subtotal, 469 + 139);
});

test('un mes inválido cuenta como el primero', () => {
  assert.equal(escalonDe(0), 0);
  assert.equal(escalonDe(-3), 0);
});

test('claves de precio', () => {
  assert.equal(clavePrecio('base', 0), 'persona_m1');
  assert.equal(clavePrecio('factura', 4), 'persona_factura_m5');
});
