import assert from 'node:assert/strict';
import test from 'node:test';
import { numeroDeOpcion, parecida } from './texto-flexible';

test('misma palabra mal escrita', () => {
  for (const [mal, bien] of [
    ['efectibo', 'efectivo'], ['tranferencia', 'transferencia'], ['trasferencia', 'transferencia'], ['tarjta', 'tarjeta'],
    ['targeta', 'tarjeta'], ['devito', 'debito'], ['credto', 'credito'], ['fatura', 'factura'], ['factua', 'factura'],
    ['grasias', 'gracias'], ['zi', 'si'], ['ci', 'si'], ['simom', 'simon'], ['rezico', 'resico'], ['jeneral', 'general'],
  ] as const) {
    assert.equal(parecida(mal, bien), true, `${mal} ≈ ${bien}`);
  }
});

test('palabras cortas no se confunden', () => {
  assert.equal(parecida('no', 'si'), false);
  assert.equal(parecida('va', 'ya'), false);
  assert.equal(parecida('mal', 'mas'), false);
  assert.equal(parecida('debito', 'credito'), false);
});

test('opción por número, palabra u ordinal', () => {
  assert.equal(numeroDeOpcion('2', 4), 2);
  assert.equal(numeroDeOpcion('2.', 4), 2);
  assert.equal(numeroDeOpcion('la 2', 4), 2);
  assert.equal(numeroDeOpcion('la dos porfa', 4), 2);
  assert.equal(numeroDeOpcion('opcion uno', 4), 1);
  assert.equal(numeroDeOpcion('el primero', 4), 1);
  assert.equal(numeroDeOpcion('2️⃣', 4), 2);
  assert.equal(numeroDeOpcion('5', 4), null);
  assert.equal(numeroDeOpcion('1 y 2', 4), null);
  assert.equal(numeroDeOpcion('2 pollos', 4), null);
});
