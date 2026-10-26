import assert from 'node:assert/strict';
import test from 'node:test';
import { HERRAMIENTAS, cobroEmpresa, combinacionValida } from './herramientas';

test('cada herramienta baja cada mes y se queda fija desde el quinto', () => {
  for (const h of HERRAMIENTAS) {
    for (let i = 1; i < 5; i++) assert.ok(h.escalones[i]! < h.escalones[i - 1]!, h.clave);
  }
  const m5 = cobroEmpresa(5, ['DOCUMENTOS']);
  assert.equal(cobroEmpresa(12, ['DOCUMENTOS']).subtotal, m5.subtotal);
});

test('el cobro suma las herramientas contratadas, con IVA encima', () => {
  const c = cobroEmpresa(1, ['DOCUMENTOS', 'FACTURACION']);
  assert.equal(c.subtotal, 1290 + 590);
  assert.equal(c.iva, Math.round((1290 + 590) * 0.16 * 100) / 100);
  assert.equal(c.detalle.length, 2);
});

test('un extra solo no se vende', () => {
  assert.equal(combinacionValida(['VOZ']), false);
  assert.equal(combinacionValida(['VENTAS', 'VOZ']), true);
});
