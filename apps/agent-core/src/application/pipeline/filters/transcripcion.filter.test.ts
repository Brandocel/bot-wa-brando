import assert from 'node:assert/strict';
import test from 'node:test';
import { paraVoz } from '../../../infrastructure/voz/voz.service';
import { TranscripcionFilter } from './transcripcion.filter';
import type { PipelineContext } from '../pipeline';

function correr(transcripcion: string | null, kind = 'AUDIO', mimetype = 'audio/ogg') {
  const filtro = new TranscripcionFilter({ transcribir: async () => transcripcion } as never);
  const ctx = {
    message: { kind, body: '', attachment: { mimetype, filename: 'nota', base64: 'AAAA' } },
    stoppedBy: null,
  } as unknown as PipelineContext;
  let paso = false;
  return filtro.handle(ctx, async () => { paso = true; }).then(() => ({ ctx, paso }));
}

test('una nota de voz transcrita sigue como texto y marcada como voz', async () => {
  const { ctx, paso } = await correr('mándame la constancia de alta de Abner');
  assert.equal(paso, true);
  assert.equal(ctx.message.kind, 'TEXT');
  assert.equal(ctx.message.body, 'mándame la constancia de alta de Abner');
  assert.equal(ctx.message.esVoz, true);
  assert.equal(ctx.message.attachment, null);
});

test('sin transcripción el audio sigue como audio (el flujo pide escribirlo)', async () => {
  const { ctx, paso } = await correr(null);
  assert.equal(paso, true);
  assert.equal(ctx.message.kind, 'AUDIO');
  assert.equal(ctx.message.esVoz, undefined);
});

test('un PDF no se intenta transcribir', async () => {
  const { ctx } = await correr('no debería', 'DOCUMENT', 'application/pdf');
  assert.equal(ctx.message.kind, 'DOCUMENT');
});

test('lo que se lee en voz va sin asteriscos, viñetas ni enlaces', () => {
  assert.equal(
    paraVoz('Encontré *2* constancias:\n• *1.* Alta Abner\n\n• *2.* Alta Raymundo https://x.mx/a'),
    'Encontré 2 constancias:\n1. Alta Abner\n2. Alta Raymundo',
  );
});

test('las pistas llevan empresa, titulares y productos, sin repetidos ni basura', async () => {
  const { armarPistas } = await import('../../support/pistas-voz.service');
  assert.equal(
    armarPistas('Somos del Mundo', ['Abner Neftali García', 'Abner Neftali García', 'IMSS', 'x'], ['Pollo entero']),
    'Somos del Mundo. Abner Neftali García, IMSS. Pollo entero',
  );
});

test('la transcripción usa las pistas de la cuenta', async () => {
  let recibidas = '';
  const filtro = new TranscripcionFilter(
    { transcribir: async (_a: unknown, p: string) => { recibidas = p; return 'hola'; } } as never,
    undefined,
    { para: async () => 'Abner Neftali' } as never,
  );
  const ctx = { message: { kind: 'AUDIO', body: '', chatId: 'c', attachment: { mimetype: 'audio/ogg', filename: 'n', base64: 'AA' } } } as unknown as PipelineContext;
  await filtro.handle(ctx, async () => undefined);
  assert.equal(recibidas, 'Abner Neftali');
});
