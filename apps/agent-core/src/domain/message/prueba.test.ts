import assert from 'node:assert/strict';
import test from 'node:test';
import { chatDeLinea } from './linea';
import { chatDePrueba, esChatDePrueba } from './prueba';

test('el chat de prueba se reconoce en el principal y en una línea', () => {
  assert.equal(esChatDePrueba(chatDePrueba(null, '5219982180042@c.us')), true);
  assert.equal(esChatDePrueba(chatDePrueba('org_alan', '5219982180042@c.us')), true);
});

test('un chat real nunca pasa por prueba', () => {
  assert.equal(esChatDePrueba('5219982180042@c.us'), false);
  assert.equal(esChatDePrueba(chatDeLinea('org_alan', '5219982180042@c.us')), false);
});
