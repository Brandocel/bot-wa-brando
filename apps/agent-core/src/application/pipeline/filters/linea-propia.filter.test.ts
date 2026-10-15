import assert from 'node:assert/strict';
import test from 'node:test';
import { chatDeLinea } from '../../../domain/message/linea';
import { LineaPropiaFilter } from './linea-propia.filter';
import type { PipelineContext } from '../pipeline';

function correr(opts: { kind: 'EMPRESA' | 'PERSONA' | null; linea: string | null; propio: boolean }) {
  const prisma = {
    organization: {
      findUnique: async () => (opts.kind ? { kind: opts.kind } : null),
    },
  };
  const filtro = new LineaPropiaFilter(prisma as never);
  const ctx = {
    message: { chatId: chatDeLinea(opts.linea, '5219982210316@c.us'), isLineSelfChat: opts.propio },
    stoppedBy: null,
  } as unknown as PipelineContext;
  let paso = false;
  return filtro.handle(ctx, async () => { paso = true; }).then(() => paso);
}

test('persona: solo su chat propio llega al bot', async () => {
  assert.equal(await correr({ kind: 'PERSONA', linea: 'org_alan', propio: true }), true);
  assert.equal(await correr({ kind: 'PERSONA', linea: 'org_alan', propio: false }), false);
});

test('empresa: sus clientes sí, su chat propio no', async () => {
  assert.equal(await correr({ kind: 'EMPRESA', linea: 'org_vega', propio: false }), true);
  assert.equal(await correr({ kind: 'EMPRESA', linea: 'org_vega', propio: true }), false);
});

test('el número principal no se toca', async () => {
  assert.equal(await correr({ kind: null, linea: null, propio: false }), true);
});
