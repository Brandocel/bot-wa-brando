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
