import assert from 'node:assert/strict';
import test from 'node:test';
import { prometeEnvio } from './reply-writer.service';

test('se descarta lo que da por hecho un envío que nadie hizo', () => {
  for (const t of [
    'Te envío los 45 documentos de alta de empleados de octubre de 2026.',
    'Los 45 documentos ya están en camino a tu chat, revisa que hayan llegado correctamente.',
    'Claro, puedo ayudarte con lo que necesites mientras llegan los documentos.',
    'No tengo control sobre los tiempos de entrega por WhatsApp, pero normalmente llegan en segundos.',
    'Ya te los mandé hace un momento.',
    'Te los voy a enviar enseguida.',
  ]) {
    assert.equal(prometeEnvio(t), true, t);
  }
});

test('lo que no promete nada pasa', () => {
  for (const t of [
    'Claro, dime qué documento necesitas: el tipo, el nombre o el mes.',
    'Soy el asistente automático de documentos. ¿Qué te busco?',
    'Todavía no te he mandado nada; dime cuál necesitas y te lo busco.',
  ]) {
    assert.equal(prometeEnvio(t), false, t);
  }
});
