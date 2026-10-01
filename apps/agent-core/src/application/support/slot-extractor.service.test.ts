import assert from 'node:assert/strict';
import test from 'node:test';
import type { LlmPort } from '../ports/llm.port';
import { SlotExtractorService } from './slot-extractor.service';

const noDocumentSlots = {
  categoria: 'NINGUNA',
  periodo: 'NINGUNO',
  folio: 'NINGUNO',
  empresa: 'NINGUNA',
  no_es_documento: true,
  tipo_mensaje: 'CONSULTA',
};

function fakeLlm(response: Record<string, unknown>): LlmPort {
  return {
    extract: async (input) => input.validate(response),
    draft: async () => null,
  };
}

test('la extracción no convierte "No recuerdo el nombre" en filtro de búsqueda', async () => {
  const extractor = new SlotExtractorService(fakeLlm({
    ...noDocumentSlots,
    no_es_documento: false,
    tipo_mensaje: 'SOLICITUD',
  }));

  const result = await extractor.extract('No recuerdo el nombre', {
    pendiente: 'detalle',
    enCurso: true,
  });

  assert.equal(result.query.text?.includes('recuerdo') ?? false, false);
});

test('el extractor conserva FACTURA y marzo de 2026 sin usar "olvida" como texto', async () => {
  const extractor = new SlotExtractorService(fakeLlm(noDocumentSlots));
  const result = await extractor.extract(
    'Olvida lo del contrato. Necesito la factura de marzo de 2026.',
    { enCurso: true },
  );

  assert.equal(result.query.category, 'FACTURA');
  assert.equal(result.query.period?.toISOString().slice(0, 7), '2026-03');
  assert.equal(result.query.text?.includes('olvida') ?? false, false);
});

test('las reglas exactas y las erratas inequívocas evitan el LLM', async () => {
  const calls: string[] = [];
  const llm: LlmPort = {
    extract: async (input) => { calls.push(input.user); return null; },
    draft: async () => null,
  };
  const extractor = new SlotExtractorService(llm);
  const exact = await extractor.extract('la factura de marzo de 2026');
  const typo = await extractor.extract('la fatcura de marso de 2026');
  assert.equal(exact.source, 'reglas');
  assert.equal(typo.source, 'reglas');
  assert.equal(typo.query.category, 'FACTURA');
  assert.equal(typo.query.period?.toISOString().slice(0, 7), '2026-03');
  assert.deepEqual(calls, []);
});

test('un caso no resuelto usa el modelo solo para slots validados', async () => {
  const calls: string[] = [];
  const llm: LlmPort = {
    extract: async (input) => {
      calls.push(input.user);
      return input.validate({
        ...noDocumentSlots, categoria: 'FACTURA', no_es_documento: false,
        tipo_mensaje: 'SOLICITUD', documentId: 'forged-id',
      });
    },
    draft: async () => null,
  };
  const result = await new SlotExtractorService(llm).extract('Pásame lo de la luz');
  assert.deepEqual(calls, ['Pásame lo de la luz']);
  assert.equal(result.source, 'modelo');
  assert.equal(result.query.category, 'FACTURA');
  assert.equal('documentId' in result.query, false);
});

test('si el modelo falla, una petición ambigua no adquiere categoría', async () => {
  const result = await new SlotExtractorService(fakeLlm({ categoria: 'inventada' }))
    .extract('Pásame lo de marzo de 2026');
  assert.equal(result.source, 'ninguno');
  assert.equal(result.query.category, null);
  assert.equal(result.query.period?.toISOString().slice(0, 7), '2026-03');
});

test('el modelo no inventa categoría en frases genéricas sin pista documental', async () => {
  const llm = fakeLlm({
    ...noDocumentSlots, categoria: 'FACTURA', no_es_documento: false,
    tipo_mensaje: 'SOLICITUD',
  });
  const extractor = new SlotExtractorService(llm);
  for (const message of ['Pásame lo de marzo de 2026', 'Necesito lo último de marzo de 2026', 'Quiero lo de Roberto']) {
    const result = await extractor.extract(message);
    assert.equal(result.query.category, null, message);
    if (message.includes('marzo')) assert.equal(result.query.period?.toISOString().slice(0, 7), '2026-03');
  }
  assert.equal((await extractor.extract('Pásame la de la luz')).query.category, 'FACTURA');
});

test('"la de marso" conserva el mes con contexto sin inventar categoría nueva', async () => {
  const calls: string[] = [];
  const llm: LlmPort = {
    extract: async (input) => { calls.push(input.user); return input.validate(noDocumentSlots); },
    draft: async () => null,
  };
  const extractor = new SlotExtractorService(llm);
  const pending = await extractor.extract('la de marso de 2026', { enCurso: true });
  const fresh = await extractor.extract('la de marso de 2026');
  assert.equal(pending.source, 'reglas');
  assert.equal(pending.query.category, null);
  assert.equal(pending.query.period?.toISOString().slice(0, 7), '2026-03');
  assert.equal(fresh.query.category, null);
  assert.deepEqual(calls, ['la de marso de 2026']);
});

test('el modelo conserva pistas indirectas con acentos sin aceptar un nombre propio', async () => {
  const llm = fakeLlm({
    ...noDocumentSlots, categoria: 'FACTURA', no_es_documento: false,
    tipo_mensaje: 'SOLICITUD',
  });
  const extractor = new SlotExtractorService(llm);
  assert.equal((await extractor.extract('pásame la de la energía')).query.category, 'FACTURA');
  assert.equal((await extractor.extract('la de la luz')).query.category, 'FACTURA');
  assert.equal((await extractor.extract('lo de Roberto')).query.category, null);
});
