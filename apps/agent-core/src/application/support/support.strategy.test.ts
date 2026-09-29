import assert from 'node:assert/strict';
import test from 'node:test';
import type { LlmPort } from '../ports/llm.port';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import type { OrgScope } from './access-scope.service';
import { DocumentSearchService } from './document-search.service';
import { ReplyWriterService } from './reply-writer.service';
import { SlotExtractorService } from './slot-extractor.service';
import { SupportStrategy, type StrategyContext } from './support.strategy';
import type { Solicitud } from './solicitud.service';
import { clasificar, esPausa, leerNumero } from './message-classifier';

const orgScope: OrgScope = {
  organizationId: 'org-allowed',
  organizationName: 'Constructora Vega',
  windows: [
    { category: 'FACTURA', periodFrom: null, periodTo: null },
    { category: 'CONTRATO', periodFrom: null, periodTo: null },
  ],
  strippedByVerification: [],
};

function emptyRequest(): Solicitud {
  return {
    category: null,
    period: null,
    folio: null,
    organizationId: null,
    opciones: null,
    preguntas: 0,
    preguntado: {},
    ultimaPregunta: null,
    fallos: 0,
    rechazados: [],
    updatedAt: null,
  };
}

class MemoryRequests {
  state = emptyRequest();
  delivery: Record<string, unknown> | null = null;
  closeCalls = 0;
  saveCalls: Partial<Solicitud>[] = [];

  async actual(): Promise<Solicitud> {
    return structuredClone(this.state);
  }

  async guardar(_conversationId: string, patch: Partial<Solicitud>): Promise<Solicitud> {
    this.saveCalls.push(structuredClone(patch));
    this.state = { ...this.state, ...patch, updatedAt: new Date().toISOString() };
    return structuredClone(this.state);
  }

  async cerrar(): Promise<void> {
    this.closeCalls++;
    this.state = emptyRequest();
  }

  async ultimaEntrega(): Promise<Record<string, unknown> | null> {
    return this.delivery;
  }

  async registrarEntrega(_conversationId: string, doc: Record<string, unknown>): Promise<void> {
    this.delivery = {
      documentId: doc.id,
      name: doc.name,
      category: doc.category,
      period: doc.period instanceof Date ? doc.period.toISOString() : null,
      at: new Date().toISOString(),
    };
  }
}

class MemorySearch {
  searches: Array<{ scopes: readonly unknown[]; query: Record<string, unknown> }> = [];
  periodResults = new Map<string, unknown[]>();
  monthLookups: string[] = [];
  monthScopes: Array<readonly unknown[]> = [];
  inventoryScopes: Array<readonly unknown[]> = [];
  byIdCalls: string[] = [];
  readonly contracts = [document('contract-1', 'CONTRATO_A.pdf'), document('contract-2', 'CONTRATO_B.pdf')];
  readonly sixInvoices = [
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  ].map((month, index) => document(`invoice-${index}`, `FACTURA_${month}.pdf`, 'FACTURA', month));

  async search(scopes: readonly unknown[], query: Record<string, unknown>): Promise<unknown[]> {
    this.searches.push({ scopes, query });
    if (query.period instanceof Date) {
      const month = `${query.period.getUTCFullYear()}-${String(query.period.getUTCMonth() + 1).padStart(2, '0')}`;
      const exactMatches = this.periodResults.get(month);
      if (exactMatches) return exactMatches;
    }
    if (query.category === 'CONTRATO' && query.text === null) return this.contracts;
    if (query.category === 'FACTURA' && query.period === null && query.folio === null && query.text === null) {
      return this.sixInvoices;
    }
    return [];
  }

  async mesesDe(scopes: readonly unknown[], category: string): Promise<Array<{ period: Date; count: number }>> {
    this.monthLookups.push(category);
    this.monthScopes.push(scopes);
    return this.sixInvoices.map((doc) => ({ period: doc.period as Date, count: 1 }));
  }

  async inventario(scopes: readonly unknown[]): Promise<[]> {
    this.inventoryScopes.push(scopes);
    return [];
  }

  async byId(id: string): Promise<unknown | null> {
    this.byIdCalls.push(id);
    if (id === 'previous-invoice') return document(id, 'FACTURA_2026-02_V3001.pdf');
    const custom = [...this.periodResults.values()].flat();
    return custom.find((doc) => (doc as { id?: string }).id === id) ??
      this.sixInvoices.find((doc) => doc.id === id) ?? null;
  }
}

function document(
  id: string,
  name: string,
  category: 'FACTURA' | 'CONTRATO' = 'FACTURA',
  month = '2026-03',
): Record<string, unknown> {
  return {
    id,
    name,
    category,
    period: new Date(`${month}-01T00:00:00.000Z`),
    organizationId: orgScope.organizationId,
    driveFileId: `drive-${id}`,
    mimeType: 'application/pdf',
    sizeBytes: 10,
    extractedText: '',
    status: 'INDEXED',
  };
}

function llmForTurn(text: string): Record<string, unknown> {
  if (/cu[aá]les son esos 6 meses/i.test(text)) {
    // Reproduce la extracción problemática que trata el 6 de la pregunta
    // contextual como folio. Una ruta correcta de inventario no debe llegar aquí.
    return {
      categoria: 'NINGUNA', periodo: 'NINGUNO', folio: '6', empresa: 'NINGUNA',
      no_es_documento: false, tipo_mensaje: 'SOLICITUD',
    };
  }
  return {
    categoria: 'NINGUNA', periodo: 'NINGUNO', folio: 'NINGUNO', empresa: 'NINGUNA',
    no_es_documento: true, tipo_mensaje: 'CONSULTA',
  };
}

class ObservedSlotExtractor extends SlotExtractorService {
  readonly calls: string[] = [];

  override async extract(
    text: string,
    options: Parameters<SlotExtractorService['extract']>[1] = {},
  ) {
    this.calls.push(text);
    return super.extract(text, options);
  }
}

function makeHarness() {
  const requests = new MemoryRequests();
  const search = new MemorySearch();
  const escalations: unknown[] = [];
  const delivered: unknown[] = [];
  const llmCalls: string[] = [];
  const draftCalls: string[] = [];
  const writerCalls: string[] = [];
  const scopes = [orgScope];
  const llm: LlmPort = {
    extract: async (input) => {
      llmCalls.push(input.user);
      return input.validate(llmForTurn(input.user));
    },
    draft: async (input) => {
      draftCalls.push(input.user);
      return null;
    },
  };
  const replyWriter = new ReplyWriterService(llm);
  const slots = new ObservedSlotExtractor(llm);
  const strategy = new SupportStrategy(
    {
      resolve: async () => ({ decision: 'ALLOW', decidedBy: 'test', scopes }),
      denialFor: () => null,
      audit: async () => undefined,
    } as never,
    slots,
    search as never,
    { deliver: async (...args: unknown[]) => { delivered.push(args); return { ok: true }; } } as never,
    {
      abrirEscalado: async (input: unknown) => {
        escalations.push(input);
        return { ticket: { id: 'ticket-1', number: 900 }, agente: null };
      },
      casoEnRevision: async () => null,
    } as never,
    requests as never,
    { recent: async () => [] } as never,
    {
      write: async (...args: Parameters<ReplyWriterService['write']>) => {
        writerCalls.push(args[0].fallback);
        return replyWriter.write(...args);
      },
    } as never,
  );

  const ctx: StrategyContext = { contactId: 'contact-1', conversationId: 'conversation-1' };
  const handle = (text: string) => strategy.handle({
    id: `message-${llmCalls.length}-${search.searches.length}`,
    chatId: 'chat-1',
    senderId: 'sender-1',
    senderName: 'Prueba',
    body: text,
    kind: 'TEXT',
    isFromMe: false,
    isSelfChat: false,
    raw: {},
  } as IncomingMessage, ctx);

  return { handle, requests, search, escalations, delivered, llmCalls, draftCalls, extractCalls: slots.calls, writerCalls, scopes };
}

test('las opciones de contratos se responden como inventario y no filtran "decir disponibles"', async () => {
  const h = makeHarness();
  const reply = await h.handle('¿Me puedes decir qué contratos tengo disponibles?');

  assert.ok(reply);
  assert.equal(h.extractCalls.length, 0);
  assert.equal(h.llmCalls.length, 0);
  assert.match(reply.text, /CONTRATO_A\.pdf/);
  assert.equal(h.extractCalls.includes('¿Me puedes decir qué contratos tengo disponibles?'), false);
  assert.equal(h.llmCalls.includes('¿Me puedes decir qué contratos tengo disponibles?'), false);
  assert.ok(h.search.searches.some(({ query }) => query.category === 'CONTRATO' && query.text === null));
  assert.equal(h.search.searches.some(({ query }) => query.text === 'decir disponibles'), false);
});

test('la pregunta por los seis meses usa inventario sin ticket ni reintento de detalle', async () => {
  const h = makeHarness();
  await h.handle('Solo necesito la factura de marzo de 2026.');
  const before = structuredClone(h.requests.state);
  const extractCallsBeforeFollowup = h.extractCalls.length;
  const llmCallsBeforeFollowup = h.llmCalls.length;

  const reply = await h.handle('¿Cuáles son esos 6 meses?');

  assert.ok(reply);
  assert.equal(h.extractCalls.length, extractCallsBeforeFollowup);
  assert.equal(h.llmCalls.length, llmCallsBeforeFollowup);
  assert.match(reply.text, /septiembre de 2025|octubre de 2025|febrero de 2026/i);
  assert.equal(h.extractCalls.includes('¿Cuáles son esos 6 meses?'), false);
  assert.equal(h.llmCalls.includes('¿Cuáles son esos 6 meses?'), false);
  assert.deepEqual(h.search.monthLookups, ['FACTURA']);
  assert.deepEqual(h.search.monthScopes, [[orgScope]]);
  assert.equal(h.escalations.length, 0);
  assert.equal(h.requests.state.preguntas, before.preguntas);
  assert.equal(h.requests.state.ultimaPregunta, before.ultimaPregunta);
  assert.equal(h.requests.state.fallos, before.fallos);
});

test('empezar de nuevo borra la solicitud completa y el turno siguiente no hereda datos', async () => {
  const h = makeHarness();
  h.requests.state = {
    ...emptyRequest(),
    category: 'CONTRATO',
    period: '2025-12-01T00:00:00.000Z',
    folio: 'V3001',
    organizationId: 'org-allowed',
    opciones: [{ n: 1, tipo: 'documento', id: 'old-doc', nombre: 'OLD.pdf' }],
    preguntas: 2,
    preguntado: { detalle: true },
    ultimaPregunta: 'detalle',
    fallos: 1,
    rechazados: ['old-doc'],
    updatedAt: new Date().toISOString(),
  };

  await h.handle('Empecemos de nuevo. Ignora lo anterior.');

  assert.equal(h.escalations.length, 0);
  assert.deepEqual(h.requests.state, emptyRequest());
  assert.equal(h.requests.closeCalls, 1);
  h.search.searches = [];
  await h.handle('Necesito marzo de 2026.');
  assert.equal(h.search.searches.some(({ query }) => query.category === 'CONTRATO' || query.folio === 'V3001'), false);
});

test('gracias sigue siendo cortesía y no inicia una búsqueda ni llama al redactor', async () => {
  const h = makeHarness();
  const reply = await h.handle('Gracias');

  assert.ok(reply);
  assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
  assert.equal(h.search.searches.length, 0);
  assert.equal(h.writerCalls.length, 0);
});

test('Mándamela de nuevo reenvía la última entrega', async () => {
  const h = makeHarness();
  const last = document('previous-invoice', 'FACTURA_2026-02_V3001.pdf');
  h.requests.delivery = {
    documentId: last.id,
    name: last.name,
    category: 'FACTURA',
    period: (last.period as Date).toISOString(),
    at: new Date().toISOString(),
  };

  const reply = await h.handle('Mándamela de nuevo');

  assert.ok(reply);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.search.searches.length, 0);
});

test('pedir explícitamente una persona sigue creando un escalamiento', async () => {
  const h = makeHarness();
  const reply = await h.handle('Quiero hablar con una persona');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'AGENTE');
  assert.equal(h.escalations.length, 1);
});

test('búsquedas e inventarios reciben solamente el alcance autorizado', async () => {
  const h = makeHarness();
  await h.handle('¿Qué documentos tienes?');

  assert.equal(h.search.inventoryScopes.length, 1);
  assert.ok(h.search.inventoryScopes.every((scopes) => scopes.length === 1 && scopes[0] === orgScope));
});

test('DocumentSearchService compila filtros de empresa/categoría desde el alcance y descarta empresas ajenas', async () => {
  let capturedWhere: Record<string, unknown> | undefined;
  let capturedInventoryWhere: Record<string, unknown> | undefined;
  let calls = 0;
  let inventoryCalls = 0;
  const service = new DocumentSearchService({
    document: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        calls++;
        capturedWhere = where;
        return [];
      },
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        inventoryCalls++;
        capturedInventoryWhere = where;
        return [];
      },
    },
  } as never);

  await service.search([orgScope], { category: 'FACTURA', period: null, folio: null, text: null });
  assert.deepEqual(capturedWhere?.OR, [{ organizationId: 'org-allowed', category: 'FACTURA' }]);

  const beforeForeignOrgQuery = calls;
  await service.search([orgScope], {
    category: 'FACTURA', period: null, folio: null, text: null, organizationId: 'org-not-allowed',
  });
  assert.equal(calls, beforeForeignOrgQuery);

  await service.inventario([orgScope]);
  assert.deepEqual(capturedInventoryWhere?.OR, [
    { organizationId: 'org-allowed', category: 'FACTURA' },
    { organizationId: 'org-allowed', category: 'CONTRATO' },
  ]);
  await service.inventario([orgScope], 'org-not-allowed');
  assert.equal(inventoryCalls, 1);
});

// Se crea la pregunta pendiente por el flujo real de Strategy: las seis
// facturas del doble superan MAX_OPCIONES y obligan a preguntar el mes.
async function pendingInvoice() {
  const h = makeHarness();
  const reply = await h.handle('Necesito una factura');
  assert.ok(reply);
  assert.match(reply.text, /mes/i);
  assert.equal(reply.awaiting, 'CLIENTE');
  assert.equal(h.requests.state.category, 'FACTURA');
  assert.equal(h.requests.state.period, null);
  assert.equal(h.requests.state.ultimaPregunta, 'periodo');
  assert.equal(h.requests.state.preguntas, 1);
  assert.deepEqual(h.requests.state.preguntado, { periodo: true });
  assert.equal(h.requests.state.fallos, 0);
  assert.equal(h.escalations.length, 0);
  return h;
}

function pendingEffects(h: ReturnType<typeof makeHarness>) {
  return structuredClone({
    request: h.requests.state,
    saves: h.requests.saveCalls,
    closes: h.requests.closeCalls,
    lastDelivery: h.requests.delivery,
    searches: h.search.searches,
    months: h.search.monthLookups,
    monthScopes: h.search.monthScopes,
    inventories: h.search.inventoryScopes,
    byId: h.search.byIdCalls,
    // abrirEscalado es el punto de creación de tickets en SupportStrategy.
    ticketsAndEscalations: h.escalations,
    deliveries: h.delivered,
  });
}

async function deliverFebruary(h: ReturnType<typeof makeHarness>) {
  const february = document('invoice-february', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02');
  h.search.periodResults.set('2026-02', [february]);
  const reply = await h.handle('Necesito la factura de febrero de 2026');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'NADIE');
  assert.equal(h.delivered.length, 1);
  assert.equal(h.requests.delivery?.documentId, february.id);
  return february;
}

test('tras entregar febrero, una factura genérica empieza nueva y pregunta el mes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = makeHarness();
  const february = await deliverFebruary(h);

  assert.deepEqual(h.requests.state, emptyRequest());
  assert.equal(h.requests.closeCalls, 1);
  assert.equal(h.requests.delivery?.period, '2026-02-01T00:00:00.000Z');
  const lastDelivery = structuredClone(h.requests.delivery);
  const searchesBefore = h.search.searches.length;

  const reply = await h.handle('Necesito una factura');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'CLIENTE');
  assert.match(reply.text, /mes/i);
  assert.equal(h.search.searches.length, searchesBefore + 1);
  const newQuery = h.search.searches.at(-1)?.query;
  assert.equal(newQuery?.category, 'FACTURA');
  assert.equal(newQuery?.period, null, 'el periodo de la entrega previa no debe heredarse');
  assert.equal(h.requests.state.category, 'FACTURA');
  assert.equal(h.requests.state.period, null);
  assert.equal(h.requests.state.ultimaPregunta, 'periodo');
  assert.equal(h.requests.state.preguntas, 1);
  assert.equal(h.requests.state.fallos, 0);
  assert.equal(h.requests.closeCalls, 1);
  assert.equal(h.requests.delivery?.documentId, february.id);
  assert.deepEqual(h.requests.delivery, lastDelivery);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.escalations.length, 0);
});

test('una respuesta De febrero con solicitud pendiente conserva FACTURA y entrega febrero', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = await pendingInvoice();
  h.search.periodResults.set('2026-02', [document('invoice-february', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02')]);

  const reply = await h.handle('De febrero');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'NADIE');
  assert.equal(h.search.searches.at(-1)?.query.category, 'FACTURA');
  assert.deepEqual(h.search.searches.at(-1)?.query.period, new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(h.requests.delivery?.period, '2026-02-01T00:00:00.000Z');
  assert.deepEqual(h.requests.state, emptyRequest());
});

test('con una solicitud de factura aún pendiente, la misma categoría hereda el febrero almacenado', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = makeHarness();
  h.requests.state = {
    ...emptyRequest(),
    category: 'FACTURA',
    period: '2026-02-01T00:00:00.000Z',
    ultimaPregunta: 'periodo',
    preguntado: { periodo: true },
    preguntas: 1,
    updatedAt: new Date().toISOString(),
  };

  const reply = await h.handle('Necesito una factura');

  assert.ok(reply);
  const reusedFebruary = h.search.searches.find(({ query }) => query.category === 'FACTURA' && query.period !== null);
  assert.ok(reusedFebruary, 'debe haber una búsqueda con el periodo heredado');
  assert.equal(reusedFebruary.query.category, 'FACTURA');
  assert.deepEqual(
    reusedFebruary.query.period,
    new Date('2026-02-01T00:00:00.000Z'),
    'mergeSlots conserva el periodo de la solicitud que sigue abierta',
  );
  assert.equal(h.requests.state.category, 'FACTURA');
  assert.equal(h.requests.state.period, '2026-02-01T00:00:00.000Z');
  assert.equal(h.escalations.length, 0);
});

test('después de entregar febrero, una petición explícita de marzo entrega marzo', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = makeHarness();
  await deliverFebruary(h);
  const march = document('invoice-march', 'FACTURA_2026-03.pdf', 'FACTURA', '2026-03');
  h.search.periodResults.set('2026-03', [march]);

  const reply = await h.handle('Necesito la factura de marzo de 2026');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'NADIE');
  assert.equal(h.search.searches.at(-1)?.query.category, 'FACTURA');
  assert.deepEqual(h.search.searches.at(-1)?.query.period, new Date('2026-03-01T00:00:00.000Z'));
  assert.equal(h.requests.delivery?.documentId, march.id);
  assert.equal(h.requests.delivery?.period, '2026-03-01T00:00:00.000Z');
  assert.equal(h.delivered.length, 2);
  assert.deepEqual(h.requests.state, emptyRequest());
  assert.equal(h.escalations.length, 0);
});

test('Mándamela de nuevo reutiliza y reenvía la última entrega, sin nueva búsqueda', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = makeHarness();
  const february = await deliverFebruary(h);
  h.search.searches = [];
  const closesBeforeResend = h.requests.closeCalls;

  const reply = await h.handle('Mándamela de nuevo');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'NADIE');
  assert.equal(h.search.searches.length, 0);
  assert.deepEqual(h.search.byIdCalls, [february.id]);
  assert.equal(h.delivered.length, 2);
  assert.deepEqual((h.delivered[1] as unknown[])[1], february);
  assert.equal(h.requests.delivery?.documentId, february.id);
  assert.equal(h.requests.closeCalls, closesBeforeResend);
  assert.deepEqual(h.requests.state, emptyRequest());
});

for (const social of ['Hola, buenos días', '¿Cómo estás?']) {
  test(`pendiente + "${social}": cortesía determinista sin efectos ni reintentos`, async () => {
    const h = await pendingInvoice();
    const before = pendingEffects(h);
    const extractionBefore = [...h.extractCalls];
    const llmBefore = [...h.llmCalls];
    const writerBefore = [...h.writerCalls];

    assert.deepEqual(clasificar(social), {
      tipo: 'CORTESIA', motivo: null, molesto: false, fuente: 'reglas',
    });
    const reply = await h.handle(social);

    assert.ok(reply);
    assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
    assert.equal(reply.clasificacion?.fuente, 'reglas');
    assert.equal(reply.awaiting, 'CLIENTE');
    assert.deepEqual(h.extractCalls, extractionBefore, 'no debe llamar al extractor');
    assert.deepEqual(h.llmCalls, llmBefore, 'no debe llamar al LLM');
    assert.deepEqual(h.writerCalls, writerBefore, 'no debe llamar al redactor');
    assert.equal(h.requests.state.preguntas, before.request.preguntas);
    assert.equal(h.requests.state.fallos, before.request.fallos);
    assert.deepEqual(h.requests.state.preguntado, before.request.preguntado);
    // Incluye todos los slots, opciones, rechazados y updatedAt, además de
    // las escrituras: detecta también una mutación seguida de restauración.
    assert.deepEqual(pendingEffects(h), before);
  });

  test(`pendiente + "${social}": respuesta social sin repetir la pregunta documental`, async () => {
    const h = await pendingInvoice();
    const reply = await h.handle(social);

    assert.ok(reply);
    assert.ok(reply.text.trim().length > 0, 'debe responder al acto social');
    // Contrato de comportamiento, sin fijar una plantilla ni depender de
    // Math.random(): ninguna variante debe volver a pedir datos del documento.
    assert.doesNotMatch(
      reply.text,
      /\b(mes|periodo|folio|archivo|factura|documento|empresa)\b/i,
      'la cortesía debe responderse sin arrastrar la pregunta pendiente',
    );
    assert.match(reply.text, /hola|buen[oas]*|salud|bien|gusto|aquí|aqui/i);
  });

  test(`continuidad después de "${social}": "De febrero" retoma y entrega la factura pendiente`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
    const h = await pendingInvoice();
    const beforeSocial = pendingEffects(h);
    await h.handle(social);
    assert.deepEqual(pendingEffects(h), beforeSocial);

    // Solo este escenario dispone de una coincidencia exacta para febrero.
    // La comprobación de la consulta evita que el doble oculte pérdida de slots.
    t.mock.method(h.search, 'search', async (scopes: readonly unknown[], query: Record<string, unknown>) => {
      h.search.searches.push({ scopes, query });
      assert.deepEqual(scopes, [orgScope]);
      assert.equal(query.category, 'FACTURA');
      assert.deepEqual(query.period, new Date('2026-02-01T00:00:00.000Z'));
      assert.equal(query.folio, null);
      assert.equal(query.text, null);
      assert.equal(query.organizationId, orgScope.organizationId);
      return [document('february-invoice', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02')];
    });
    const searchesBefore = h.search.searches.length;
    const extractsBefore = h.extractCalls.length;
    const llmBefore = [...h.llmCalls];
    const writerBefore = [...h.writerCalls];
    const savesBefore = h.requests.saveCalls.length;

    const reply = await h.handle('De febrero');

    assert.ok(reply);
    assert.equal(reply.clasificacion?.tipo, 'SOLICITUD');
    assert.equal(reply.awaiting, 'NADIE');
    assert.equal(h.search.searches.length, searchesBefore + 1);
    assert.deepEqual(h.extractCalls.slice(extractsBefore), ['De febrero']);
    assert.deepEqual(h.llmCalls, llmBefore);
    assert.deepEqual(h.writerCalls, writerBefore);
    assert.deepEqual(h.requests.saveCalls.slice(savesBefore), [{
      category: 'FACTURA', period: '2026-02-01T00:00:00.000Z', folio: null,
    }]);
    assert.equal(h.escalations.length, 0);
    assert.equal(h.delivered.length, 1);
    assert.equal(h.requests.delivery?.documentId, 'february-invoice');
    // El cierre ocurre por la entrega completada, nunca por el saludo.
    assert.equal(h.requests.closeCalls, 1);
    assert.deepEqual(h.requests.state, emptyRequest());
  });
}

for (const { message, expected } of [
  { message: 'Buenas tardes', expected: /buenas tardes/i },
  { message: 'Buenas noches', expected: /buenas noches/i },
  { message: 'Hola', expected: /^¡Hola!/ },
  { message: '¿Cómo estás?', expected: /todo bien, gracias|muy bien, gracias/i },
]) {
  test(`respuesta social para "${message}" respeta el saludo y conserva la solicitud`, async () => {
    const h = await pendingInvoice();
    const before = pendingEffects(h);
    const extractsBefore = [...h.extractCalls];
    const llmBefore = [...h.llmCalls];
    const writerBefore = [...h.writerCalls];

    const reply = await h.handle(message);

    assert.ok(reply);
    assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
    assert.match(reply.text, expected);
    assert.deepEqual(pendingEffects(h), before);
    assert.deepEqual(h.extractCalls, extractsBefore);
    assert.deepEqual(h.writerCalls, writerBefore);
    assert.deepEqual(h.llmCalls, llmBefore);
  });
}

test('regresión Gracias sin pendiente: agradecimiento sin extractor, LLM ni efectos', async () => {
  const h = makeHarness();
  const before = pendingEffects(h);
  const reply = await h.handle('Gracias');

  assert.ok(reply);
  assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
  assert.equal(reply.awaiting, 'NADIE');
  assert.match(reply.text, /con gusto|para eso estamos|de nada/i);
  assert.deepEqual(h.extractCalls, []);
  assert.deepEqual(h.llmCalls, []);
  assert.deepEqual(h.draftCalls, []);
  assert.deepEqual(h.writerCalls, []);
  assert.deepEqual(pendingEffects(h), before);
});

test('Gracias con pregunta de mes pendiente responde determinísticamente y conserva toda la Solicitud', async () => {
  const h = await pendingInvoice();
  const stateBefore = pendingEffects(h);
  const extractsBefore = [...h.extractCalls];
  const llmBefore = [...h.llmCalls];
  const draftsBefore = [...h.draftCalls];
  const writersBefore = [...h.writerCalls];

  const reply = await h.handle('Gracias');

  assert.ok(reply);
  assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
  assert.equal(reply.awaiting, 'CLIENTE');
  assert.match(reply.text, /con gusto|para eso estamos|de nada/i);
  assert.deepEqual(h.extractCalls, extractsBefore);
  assert.deepEqual(h.llmCalls, llmBefore);
  assert.deepEqual(h.draftCalls, draftsBefore);
  assert.deepEqual(h.writerCalls, writersBefore);
  assert.deepEqual(pendingEffects(h), stateBefore);
});

test('De febrero continúa y entrega la solicitud después de Gracias con pregunta pendiente', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = await pendingInvoice();
  const february = document('invoice-february', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02');
  h.search.periodResults.set('2026-02', [february]);
  const stateBeforeThanks = pendingEffects(h);

  const thanks = await h.handle('Gracias');

  assert.ok(thanks);
  assert.equal(thanks.clasificacion?.tipo, 'CORTESIA');
  assert.deepEqual(pendingEffects(h), stateBeforeThanks);
  assert.deepEqual(h.extractCalls, ['Necesito una factura']);
  assert.deepEqual(h.llmCalls, []);
  assert.deepEqual(h.draftCalls, []);
  assert.deepEqual(h.writerCalls, []);
  const searchesBeforeContinuation = h.search.searches.length;
  const draftsBeforeContinuation = h.draftCalls.length;
  const extractCallsBeforeContinuation = h.extractCalls.length;

  const continuation = await h.handle('De febrero');

  assert.ok(continuation);
  assert.equal(continuation.awaiting, 'NADIE');
  assert.equal(h.search.searches.length, searchesBeforeContinuation + 1);
  assert.deepEqual(h.search.searches.at(-1)?.query.period, new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(h.requests.delivery?.documentId, february.id);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.draftCalls.length, draftsBeforeContinuation);
  assert.equal(h.extractCalls.length, extractCallsBeforeContinuation + 1);
  assert.deepEqual(h.requests.state, emptyRequest());
  assert.equal(h.escalations.length, 0);
});

test('Ok sigue confirmando la única opción antes de la respuesta rápida de acuses', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = makeHarness();
  const onlyOption = document('only-option', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02');
  h.search.periodResults.set('2026-02', [onlyOption]);
  h.requests.state = {
    ...emptyRequest(),
    category: 'FACTURA',
    period: '2026-02-01T00:00:00.000Z',
    opciones: [{ n: 1, tipo: 'documento', id: String(onlyOption.id), nombre: String(onlyOption.name) }],
    updatedAt: new Date().toISOString(),
  };

  const reply = await h.handle('Ok');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'NADIE');
  assert.equal(reply.text, '');
  assert.deepEqual(h.search.byIdCalls, [onlyOption.id]);
  assert.equal(h.delivered.length, 1);
  assert.deepEqual((h.delivered[0] as unknown[])[1], onlyOption);
  assert.deepEqual(h.extractCalls, []);
  assert.deepEqual(h.llmCalls, []);
  assert.deepEqual(h.draftCalls, []);
  assert.deepEqual(h.writerCalls, []);
  assert.deepEqual(h.requests.state, emptyRequest());
});

for (const acuse of ['Ok', 'Va', 'Entendido', 'Perfecto', 'Listo']) {
  test('acuse ' + acuse + ': LLM, redactor, estado y continuidad del periodo pendiente sin cambios', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
    const h = await pendingInvoice();
    const february = document('invoice-february', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02');
    h.search.periodResults.set('2026-02', [february]);
    const stateBefore = pendingEffects(h);
    const extractsBefore = [...h.extractCalls];
    const llmBefore = [...h.llmCalls];
    const draftsBefore = [...h.draftCalls];
    const writersBefore = [...h.writerCalls];

    const reply = await h.handle(acuse);

    assert.ok(reply);
    assert.equal(clasificar(acuse).tipo, 'CORTESIA');
    assert.equal(clasificar(acuse).fuente, 'reglas');
    assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
    assert.equal(reply.awaiting, 'CLIENTE');
    assert.equal(reply.text, '', 'el acuse simple no genera otra respuesta');
    assert.deepEqual(h.extractCalls, extractsBefore);
    assert.deepEqual(h.llmCalls, llmBefore);
    assert.equal(h.writerCalls.length, writersBefore.length);
    assert.equal(h.draftCalls.length, draftsBefore.length);
    assert.deepEqual(pendingEffects(h), stateBefore, 'el acuse no modifica ni consume Solicitud');

    const searchesBeforeContinuation = h.search.searches.length;
    const draftsBeforeContinuation = h.draftCalls.length;
    const llmBeforeContinuation = [...h.llmCalls];
    const continuation = await h.handle('De febrero');

    assert.ok(continuation);
    assert.equal(continuation.awaiting, 'NADIE');
    assert.equal(h.search.searches.length, searchesBeforeContinuation + 1);
    assert.deepEqual(h.search.searches.at(-1)?.query.period, new Date('2026-02-01T00:00:00.000Z'));
    assert.deepEqual(h.llmCalls, llmBeforeContinuation, 'el mes se extrae por reglas');
    assert.equal(h.draftCalls.length, draftsBeforeContinuation);
    assert.equal(h.requests.delivery?.documentId, february.id);
    assert.equal(h.delivered.length, 1);
    assert.deepEqual(h.requests.state, emptyRequest());
    assert.equal(h.escalations.length, 0);
  });
}

for (const cierre of ['Es todo', 'Con eso basta', 'Ya está']) {
  test(`${cierre} abandona solo la Solicitud pendiente sin invocar extractores ni redactor`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
    const h = await pendingInvoice();
    const lastDelivery = {
      documentId: 'previous-invoice',
      name: 'FACTURA_2026-01.pdf',
      category: 'FACTURA',
      period: '2026-01-01T00:00:00.000Z',
      at: new Date().toISOString(),
    };
    h.requests.delivery = structuredClone(lastDelivery);
    const extractsBefore = [...h.extractCalls];
    const llmBefore = [...h.llmCalls];
    const draftsBefore = [...h.draftCalls];
    const writersBefore = [...h.writerCalls];
    const searchesBefore = [...h.search.searches];
    const savesBefore = [...h.requests.saveCalls];

    const reply = await h.handle(cierre);

    assert.ok(reply);
    assert.equal(clasificar(cierre).tipo, 'CORTESIA');
    assert.equal(clasificar(cierre).fuente, 'reglas');
    assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
    assert.equal(reply.awaiting, 'NADIE');
    assert.match(reply.text, /lo dejamos aqu[ií]/i);
    assert.deepEqual(h.extractCalls, extractsBefore);
    assert.deepEqual(h.llmCalls, llmBefore);
    assert.deepEqual(h.writerCalls, writersBefore);
    assert.deepEqual(h.draftCalls, draftsBefore);
    assert.deepEqual(h.search.searches, searchesBefore);
    assert.equal(h.requests.closeCalls, 1);
    assert.deepEqual(h.requests.state, emptyRequest());
    assert.deepEqual(h.requests.saveCalls, savesBefore);
    assert.deepEqual(h.requests.delivery, lastDelivery, 'cerrar Solicitud conserva la última entrega');
    assert.deepEqual(h.escalations, []);
    assert.deepEqual(h.delivered, []);
  });
}

test('De febrero después de cerrar no retoma la Solicitud anterior', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = await pendingInvoice();
  await h.handle('Es todo');
  assert.deepEqual(h.requests.state, emptyRequest());

  const searchesBefore = h.search.searches.length;
  const reply = await h.handle('De febrero');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'CLIENTE');
  assert.match(reply.text, /documento/i);
  assert.equal(h.search.searches.length, searchesBefore + 1);
  assert.notEqual(h.search.searches.at(-1)?.query.category, 'FACTURA');
  assert.equal(h.requests.state.category, null);
  assert.equal(h.requests.state.period, '2026-02-01T00:00:00.000Z');
  assert.equal(h.requests.state.ultimaPregunta, 'categoria');
  assert.deepEqual(h.delivered, []);
  assert.equal(h.escalations.length, 0);
});

test('una nueva petición explícita funciona después de cerrar la Solicitud anterior', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
  const h = await pendingInvoice();
  await h.handle('Ya está');
  assert.deepEqual(h.requests.state, emptyRequest());
  const february = document('new-invoice-february', 'FACTURA_2026-02_nueva.pdf', 'FACTURA', '2026-02');
  h.search.periodResults.set('2026-02', [february]);

  const reply = await h.handle('Necesito una factura de febrero');

  assert.ok(reply);
  assert.equal(reply.awaiting, 'NADIE');
  assert.equal(h.search.searches.at(-1)?.query.category, 'FACTURA');
  assert.deepEqual(h.search.searches.at(-1)?.query.period, new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(h.requests.delivery?.documentId, february.id);
  assert.equal(h.delivered.length, 1);
  assert.deepEqual(h.requests.state, emptyRequest());
  assert.equal(h.escalations.length, 0);
});

const pausasCaracterizadas = [
  'Espera',
  'Un momento',
  'Ahorita te digo',
  'Déjame ver',
  'Dame un segundo',
  'Espérame',
  'Espera tantito',
  'Un momentito',
  'Dame un momento',
  'Dame un segundo por favor',
  'Déjame checar',
  'Aguanta tantito',
  'Ahorita veo',
];

for (const pausa of pausasCaracterizadas) {
  test(`pausa "${pausa}" conserva la Solicitud pendiente y permite continuar con Febrero`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-15T12:00:00.000Z') });
    const h = await pendingInvoice();
    const february = document('invoice-february', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02');
    h.search.periodResults.set('2026-02', [february]);
    const stateBefore = pendingEffects(h);
    const extractsBefore = [...h.extractCalls];
    const llmBefore = [...h.llmCalls];
    const draftsBefore = [...h.draftCalls];
    const writersBefore = [...h.writerCalls];

    const reply = await h.handle(pausa);

    assert.ok(reply);
    assert.equal(clasificar(pausa).tipo, 'CORTESIA');
    assert.equal(clasificar(pausa).fuente, 'reglas');
    assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
    assert.equal(reply.awaiting, 'CLIENTE');
    assert.equal(reply.text, 'Claro, tómate tu tiempo.');
    assert.deepEqual(h.extractCalls, extractsBefore);
    assert.deepEqual(h.llmCalls, llmBefore);
    assert.deepEqual(h.writerCalls, writersBefore);
    assert.deepEqual(h.draftCalls, draftsBefore);
    assert.deepEqual(pendingEffects(h), stateBefore, 'la pausa no modifica Solicitud ni inicia acciones documentales');

    const searchesBeforeContinuation = h.search.searches.length;
    const llmBeforeContinuation = [...h.llmCalls];
    const draftsBeforeContinuation = h.draftCalls.length;
    const continuation = await h.handle('Febrero');

    assert.ok(continuation);
    assert.equal(continuation.awaiting, 'NADIE');
    assert.equal(h.search.searches.length, searchesBeforeContinuation + 1);
    assert.deepEqual(h.search.searches.at(-1)?.query.period, new Date('2026-02-01T00:00:00.000Z'));
    assert.deepEqual(h.llmCalls, llmBeforeContinuation, 'el mes se extrae por reglas');
    assert.equal(h.draftCalls.length, draftsBeforeContinuation);
    assert.equal(h.requests.delivery?.documentId, february.id);
    assert.equal(h.delivered.length, 1);
    assert.deepEqual(h.requests.state, emptyRequest());
    assert.equal(h.escalations.length, 0);
  });
}

function pendingDocumentOptions() {
  const h = makeHarness();
  const documentA = document('option-a', 'FACTURA_A.pdf', 'FACTURA', '2026-01');
  const documentB = document('option-b', 'FACTURA_B.pdf', 'FACTURA', '2026-02');
  h.search.periodResults.set('options', [documentA, documentB]);
  h.requests.state = {
    ...emptyRequest(),
    category: 'FACTURA',
    opciones: [
      { n: 1, tipo: 'documento', id: String(documentA.id), nombre: String(documentA.name) },
      { n: 2, tipo: 'documento', id: String(documentB.id), nombre: String(documentB.name) },
    ],
    updatedAt: new Date().toISOString(),
  };
  return { h, documentA, documentB };
}

for (const pausa of pausasCaracterizadas) {
  test(`"${pausa}" con dos opciones abiertas conserva la lista y no elige ni entrega`, async () => {
    const { h } = pendingDocumentOptions();
    const stateBefore = pendingEffects(h);

    const reply = await h.handle(pausa);

    assert.ok(reply);
    assert.equal(clasificar(pausa).tipo, 'CORTESIA');
    assert.equal(reply.clasificacion?.tipo, 'CORTESIA');
    assert.equal(reply.awaiting, 'CLIENTE');
    assert.equal(reply.text, 'Claro, tómate tu tiempo.');
    if (pausa.startsWith('Dame un segundo')) assert.equal(leerNumero(pausa), 2);
    assert.deepEqual(h.search.byIdCalls, []);
    assert.deepEqual(h.delivered, []);
    assert.equal(h.requests.closeCalls, 0);
    assert.equal(h.requests.delivery, null);
    assert.deepEqual(h.extractCalls, []);
    assert.deepEqual(h.llmCalls, []);
    assert.deepEqual(h.writerCalls, []);
    assert.deepEqual(h.draftCalls, []);
    assert.deepEqual(pendingEffects(h), stateBefore);
    assert.equal(h.escalations.length, 0);
  });
}

test('después de pausar opciones abiertas, "2" selecciona Documento B normalmente', async () => {
  const { h, documentB } = pendingDocumentOptions();

  const pause = await h.handle('Dame un segundo por favor');
  assert.ok(pause);
  assert.equal(pause.awaiting, 'CLIENTE');
  assert.deepEqual(h.search.byIdCalls, []);
  assert.deepEqual(h.delivered, []);
  const stateAfterPause = pendingEffects(h);
  assert.equal(h.requests.state.opciones?.length, 2);

  const selection = await h.handle('2');

  assert.ok(selection);
  assert.equal(selection.awaiting, 'NADIE');
  assert.deepEqual(h.search.byIdCalls, [documentB.id]);
  assert.equal(h.delivered.length, 1);
  assert.deepEqual((h.delivered[0] as unknown[])[1], documentB);
  assert.equal(h.requests.delivery?.documentId, documentB.id);
  assert.equal(h.requests.closeCalls, 1);
  assert.deepEqual(h.requests.state.opciones, stateAfterPause.request.opciones);
});

for (const seleccion of ['2', 'la 2', 'el segundo', 'la segunda opción']) {
  test(`selección explícita "${seleccion}" continúa siendo compatible con opciones abiertas`, async () => {
    const { h, documentB } = pendingDocumentOptions();
    assert.equal(leerNumero(seleccion), 2);

    const reply = await h.handle(seleccion);

    assert.ok(reply);
    assert.equal(reply.awaiting, 'NADIE');
    assert.deepEqual(h.search.byIdCalls, [documentB.id]);
    assert.equal(h.delivered.length, 1);
    assert.deepEqual((h.delivered[0] as unknown[])[1], documentB);
    assert.equal(h.requests.delivery?.documentId, documentB.id);
  });
}

for (const frase of [
  'el segundo',
  'la segunda opción',
  'necesito el segundo documento',
  'dame el segundo documento',
]) {
  test(`frase de selección/documento "${frase}" no se reconoce como PAUSA`, async () => {
    const { h, documentB } = pendingDocumentOptions();

    assert.equal(esPausa(frase), false);
    assert.equal(leerNumero(frase), 2);
    const reply = await h.handle(frase);

    assert.ok(reply);
    assert.deepEqual(h.search.byIdCalls, [documentB.id]);
    assert.equal(h.delivered.length, 1);
    assert.equal(h.requests.delivery?.documentId, documentB.id);
  });
}
