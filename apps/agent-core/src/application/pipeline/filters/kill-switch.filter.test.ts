import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone } from '../../../domain/contact/phone';
import { KillSwitchFilter } from './kill-switch.filter';
import type { PipelineContext } from '../pipeline';

function correr(opts: { paused?: boolean; solo?: string[]; senderId: string; role?: string }) {
  const flags = { isPaused: async () => opts.paused ?? false, soloNumeros: async () => opts.solo ?? [] };
  const filtro = new KillSwitchFilter(flags as never);
  const ctx = { message: { senderId: opts.senderId }, role: opts.role ?? 'PROSPECT' } as unknown as PipelineContext;
  let paso = false;
  return filtro.handle(ctx, async () => { paso = true; }).then(() => paso);
}

const LISTA = ['9984862017', '9982210316'].map((n) => normalizePhone(n).waId);

test('los números de la lista se escriben como llegan de WhatsApp', () => {
  assert.deepEqual(LISTA, ['5219984862017@c.us', '5219982210316@c.us']);
});

test('con lista: solo pasan esos números', async () => {
  assert.equal(await correr({ solo: LISTA, senderId: '5219984862017@c.us' }), true);
  assert.equal(await correr({ solo: LISTA, senderId: '5219982210316@c.us' }), true);
  assert.equal(await correr({ solo: LISTA, senderId: '5215511112222@c.us' }), false);
  // Un LID que no se pudo resolver a número no está en la lista: no se le contesta.
  assert.equal(await correr({ solo: LISTA, senderId: '108817861898421@lid' }), false);
});

test('el dueño siempre pasa, y sin lista pasan todos', async () => {
  assert.equal(await correr({ solo: LISTA, senderId: '5215511112222@c.us', role: 'OWNER' }), true);
  assert.equal(await correr({ senderId: '5215511112222@c.us' }), true);
  assert.equal(await correr({ paused: true, senderId: '5219984862017@c.us' }), false);
});
