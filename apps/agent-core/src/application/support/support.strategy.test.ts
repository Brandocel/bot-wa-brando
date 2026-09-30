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
  catalog: Array<Record<string, unknown>> | null = null;
  periodResults = new Map<string, unknown[]>();
  monthLookups: string[] = [];
  monthScopes: Array<readonly unknown[]> = [];
  inventoryScopes: Array<readonly unknown[]> = [];
  byIdCalls: string[] = [];
  readonly contracts = [document('contract-1', 'CONTRATO_A.pdf'), document('contract-2', 'CONTRATO_B.pdf')];
  readonly sixInvoices = [
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  ].map((month, index) => document(`invoice-${index}`, `FACTURA_${month}.pdf`, 'FACTURA', month));

  /** Resultados por palabra clave exacta ("oxxo"). */
  textResults = new Map<string, unknown[]>();

  private catalogMatches(scopes: readonly unknown[], query: Record<string, unknown>): Array<Record<string, unknown>> {
    return (this.catalog ?? []).filter((doc) =>
      doc.status === 'INDEXED' &&
      scopes.some((scope) => (scope as OrgScope).organizationId === doc.organizationId &&
        (scope as OrgScope).windows.some((window) => window.category === doc.category &&
          (!window.periodFrom || (doc.period as Date) >= window.periodFrom) &&
          (!window.periodTo || (doc.period as Date) <= window.periodTo))) &&
      (!query.organizationId || query.organizationId === doc.organizationId) &&
      (!query.category || query.category === doc.category) &&
      (!(query.period instanceof Date) || query.period.getTime() === (doc.period as Date).getTime()) &&
      (!(query.excludeIds as string[] | undefined)?.includes(doc.id as string)) &&
      (!query.text || String(doc.name).toLowerCase().includes(String(query.text).toLowerCase())),
    );
  }

  async search(scopes: readonly unknown[], query: Record<string, unknown>, limit = 5): Promise<unknown[]> {
    this.searches.push({ scopes, query });
    if (this.catalog) {
      return this.catalogMatches(scopes, query).sort((a, b) => (b.period as Date).getTime() - (a.period as Date).getTime() ||
        String(a.name).localeCompare(String(b.name))).slice(0, limit);
    }
    if (typeof query.text === 'string' && this.textResults.has(query.text)) {
      return this.textResults.get(query.text)!;
    }
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
    if (this.catalog) {
      const counts = new Map<number, { period: Date; count: number }>();
      for (const doc of this.catalogMatches(scopes, { category })) {
        const period = doc.period as Date;
        const key = period.getTime();
        const group = counts.get(key) ?? { period, count: 0 };
        group.count++;
        counts.set(key, group);
      }
      return [...counts.values()].sort((a, b) => b.period.getTime() - a.period.getTime());
    }
    return this.sixInvoices.map((doc) => ({ period: doc.period as Date, count: 1 }));
  }

  async inventario(scopes: readonly unknown[]): Promise<Array<{ category: string; count: number; from: Date; to: Date }>> {
    this.inventoryScopes.push(scopes);
    if (this.catalog) {
      const docs = this.catalogMatches(scopes, {});
      const groups = new Map<string, { category: string; count: number; from: Date; to: Date }>();
      for (const doc of docs) {
        const category = doc.category as string;
        const period = doc.period as Date;
        const group = groups.get(category) ?? { category, count: 0, from: period, to: period };
        group.count++;
        if (period < group.from) group.from = period;
        if (period > group.to) group.to = period;
        groups.set(category, group);
      }
      return [...groups.values()];
    }
    return [];
  }

  async count(scopes: readonly unknown[], query: Record<string, unknown>): Promise<number> {
    if (this.catalog) return this.catalogMatches(scopes, query).length;
    if (query.period instanceof Date) {
      const month = `${query.period.getUTCFullYear()}-${String(query.period.getUTCMonth() + 1).padStart(2, '0')}`;
      return this.periodResults.get(month)?.length ?? 0;
    }
    if (query.category === 'FACTURA' && !query.text) return this.sixInvoices.length;
    if (query.category === 'CONTRATO' && !query.text) return this.contracts.length;
    return this.textResults.get(String(query.text))?.length ?? 0;
  }

  async byId(id: string): Promise<unknown | null> {
    this.byIdCalls.push(id);
    if (this.catalog) return this.catalog.find((doc) => doc.id === id) ?? null;
    if (id === 'previous-invoice') return document(id, 'FACTURA_2026-02_V3001.pdf');
    const custom = [...this.periodResults.values(), ...this.textResults.values()].flat();
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
  readonly results: Array<Awaited<ReturnType<SlotExtractorService['extract']>>> = [];

  override async extract(
    text: string,
    options: Parameters<SlotExtractorService['extract']>[1] = {},
  ) {
    this.calls.push(text);
    const result = await super.extract(text, options);
    this.results.push(structuredClone(result));
    return result;
  }
}

function makeHarness(options: { senderName?: string | null; scopes?: OrgScope[]; history?: Array<{ role: 'cliente' | 'bot'; text: string; at: Date }> } = {}) {
  const requests = new MemoryRequests();
  const search = new MemorySearch();
  const escalations: unknown[] = [];
  const delivered: unknown[] = [];
  const llmCalls: string[] = [];
  const draftCalls: string[] = [];
  const writerCalls: string[] = [];
  const scopes = options.scopes ?? [orgScope];
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
    { recent: async () => options.history ?? [] } as never,
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
    senderName: options.senderName === undefined ? 'Prueba' : options.senderName,
    body: text,
    kind: 'TEXT',
    isFromMe: false,
    isSelfChat: false,
    raw: {},
  } as IncomingMessage, ctx);

  return {
    handle, requests, search, escalations, delivered, llmCalls, draftCalls,
    extractCalls: slots.calls, slotResults: slots.results, writerCalls, scopes,
  };
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

test('el conteo de búsqueda usa los mismos filtros de permiso, estado, mes y exclusiones que la lista', async () => {
  const whereForSearch: Record<string, unknown>[] = [];
  const whereForCount: Record<string, unknown>[] = [];
  const service = new DocumentSearchService({
    document: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        whereForSearch.push(where);
        return [];
      },
      count: async ({ where }: { where: Record<string, unknown> }) => {
        whereForCount.push(where);
        return 6;
      },
    },
  } as never);
  const query = {
    category: 'FACTURA' as const,
    period: new Date('2026-06-01T00:00:00Z'),
    folio: null,
    text: null,
    organizationId: orgScope.organizationId,
    excludeIds: ['rechazado'],
  };

  await service.search([orgScope], query);
  assert.equal(await service.count([orgScope], query), 6);
  assert.deepEqual(whereForCount, whereForSearch);
  assert.equal(whereForCount[0]?.status, 'INDEXED');
  assert.deepEqual(whereForCount[0]?.OR, [{ organizationId: 'org-allowed', category: 'FACTURA' }]);
  assert.deepEqual(whereForCount[0]?.AND, [
    { category: 'FACTURA' }, { period: query.period }, { id: { notIn: ['rechazado'] } },
  ]);

  const foreign = { ...query, organizationId: 'org-not-allowed' };
  assert.equal(await service.count([orgScope], foreign), 0);
  assert.equal(whereForCount.length, 1);
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

function seededRequest(overrides: Partial<Solicitud> = {}): Solicitud {
  return {
    ...emptyRequest(),
    category: 'FACTURA',
    period: '2026-02-01T00:00:00.000Z',
    folio: 'V3001',
    organizationId: orgScope.organizationId,
    opciones: [{ n: 1, tipo: 'documento', id: 'old-invoice', nombre: 'FACTURA_2026-02_V3001.pdf' }],
    preguntas: 1,
    preguntado: { periodo: true },
    ultimaPregunta: 'periodo',
    fallos: 0,
    rechazados: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('corrección "No era febrero, era marzo" usa marzo y descarta slots anteriores incompatibles', async () => {
  const h = makeHarness();
  h.requests.state = seededRequest();
  const march = [
    document('invoice-march-a', 'FACTURA_2026-03_A.pdf', 'FACTURA', '2026-03'),
    document('invoice-march-b', 'FACTURA_2026-03_B.pdf', 'FACTURA', '2026-03'),
  ];
  h.search.periodResults.set('2026-03', march);
  const before = structuredClone(h.requests.state);
  const message = 'No era febrero, era marzo';
  const reply = await h.handle(message);

  assert.ok(reply);
  assert.equal(clasificar(message).tipo, 'SOLICITUD');
  assert.equal(h.extractCalls.length, 1);
  assert.equal(h.llmCalls.length, 0);
  assert.deepEqual(h.slotResults[0]?.query, {
    category: null, period: new Date('2026-03-01T00:00:00.000Z'), folio: null, text: null,
  });
  assert.equal(h.search.searches[0]?.query.category, 'FACTURA');
  assert.equal((h.search.searches[0]?.query.period as Date | null)?.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(h.search.searches[0]?.query.folio, null);
  assert.equal(h.requests.state.category, 'FACTURA');
  assert.equal(h.requests.state.period, '2026-03-01T00:00:00.000Z');
  assert.equal(h.requests.state.folio, null);
  assert.deepEqual(h.requests.state.opciones?.map((option) => option.id), march.map((doc) => doc.id));
  assert.notEqual(h.requests.state.updatedAt, before.updatedAt);
  assert.equal(h.requests.state.fallos, 0);
  assert.equal(h.requests.state.ultimaPregunta, null);
  assert.deepEqual(h.requests.state.preguntado, {});
  assert.equal(h.escalations.length, 0);
  assert.equal(reply.awaiting, 'CLIENTE');
});

test('cambio "No, mejor quiero un contrato" limpia slots, filtros y opciones de FACTURA', async () => {
  const h = makeHarness();
  h.requests.state = seededRequest();
  const message = 'No, mejor quiero un contrato';
  const reply = await h.handle(message);

  assert.ok(reply);
  assert.equal(clasificar(message).tipo, 'SOLICITUD');
  assert.equal(h.extractCalls.length, 1);
  assert.equal(h.llmCalls.length, 0);
  assert.equal(h.slotResults[0]?.query.category, 'CONTRATO');
  assert.equal(h.slotResults[0]?.query.period, null);
  assert.equal(h.slotResults[0]?.query.folio, null);
  assert.equal(h.slotResults[0]?.query.text, null);
  assert.ok(h.search.searches.every(({ query }) => query.category !== 'FACTURA'));
  assert.equal(h.requests.state.category, 'CONTRATO');
  assert.equal(h.requests.state.period, null);
  assert.equal(h.requests.state.folio, null);
  assert.equal(h.requests.state.opciones?.[0]?.id, 'contract-1');
  assert.equal(h.requests.state.fallos, 0);
  assert.equal(h.requests.state.ultimaPregunta, null);
  assert.equal(h.search.searches.some(({ query }) => query.text === 'mejor'), false);
  assert.deepEqual(h.requests.state.preguntado, {});
  assert.equal(h.requests.state.preguntas, 0);
  assert.equal(h.escalations.length, 0);
  assert.equal(reply.awaiting, 'CLIENTE');
});

test('"Olvida eso, dame otra factura" limpia la Solicitud y procesa la nueva petición', async () => {
  const h = makeHarness();
  h.requests.state = seededRequest({ category: 'CONTRATO' });
  const message = 'Olvida eso, dame otra factura';
  h.requests.delivery = { documentId: 'delivered-before', name: 'OLD.pdf', category: 'CONTRATO', period: null, at: '2026-01-01T00:00:00.000Z' };
  const deliveryBefore = structuredClone(h.requests.delivery);
  const reply = await h.handle(message);

  assert.ok(reply);
  assert.equal(clasificar(message).tipo, 'SOLICITUD');
  assert.equal(h.requests.closeCalls, 1);
  assert.equal(h.extractCalls.length, 1);
  assert.equal(h.llmCalls.length, 0);
  assert.equal(h.slotResults[0]?.query.category, 'FACTURA');
  assert.equal(h.slotResults[0]?.query.period, null);
  assert.equal(h.slotResults[0]?.query.folio, null);
  assert.equal(h.slotResults[0]?.query.text, null);
  assert.equal(h.requests.state.category, 'FACTURA');
  assert.equal(h.requests.state.period, null);
  assert.equal(h.requests.state.folio, null);
  assert.equal(h.requests.state.opciones, null);
  assert.equal(h.search.searches.some(({ query }) => query.text === 'eso'), false);
  assert.equal(h.search.searches[0]?.query.category, 'FACTURA');
  assert.equal(h.requests.state.fallos, 0);
  assert.equal(h.requests.state.ultimaPregunta, 'periodo');
  assert.equal(h.requests.state.preguntas, 1);
  assert.deepEqual(h.requests.delivery, deliveryBefore, 'la última entrega sobrevive al abandono de Solicitud');
  assert.equal(h.escalations.length, 0);
  assert.equal(reply.awaiting, 'CLIENTE');
});

test('corrección breve "Mejor marzo" hereda FACTURA, reemplaza febrero y no filtra por "mejor"', async () => {
  const h = makeHarness();
  h.requests.state = seededRequest();
  h.search.periodResults.set('2026-03', [
    document('invoice-march-a', 'FACTURA_2026-03_A.pdf', 'FACTURA', '2026-03'),
    document('invoice-march-b', 'FACTURA_2026-03_B.pdf', 'FACTURA', '2026-03'),
  ]);
  const message = 'Mejor marzo';
  const reply = await h.handle(message);

  assert.ok(reply);
  assert.equal(clasificar(message).tipo, 'SOLICITUD');
  assert.equal(h.extractCalls.length, 1);
  assert.equal(h.llmCalls.length, 0);
  assert.equal(h.slotResults[0]?.query.category, null);
  assert.equal(h.slotResults[0]?.query.period?.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(h.slotResults[0]?.query.text, null);
  assert.equal(h.search.searches[0]?.query.category, 'FACTURA');
  assert.equal((h.search.searches[0]?.query.period as Date | null)?.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(h.search.searches[0]?.query.text, null);
  assert.equal(h.requests.state.category, 'FACTURA');
  assert.equal(h.requests.state.period, '2026-03-01T00:00:00.000Z');
  assert.equal(h.requests.state.folio, null);
  assert.equal(h.requests.state.ultimaPregunta, null);
  assert.deepEqual(h.requests.state.opciones?.map((option) => option.id), ['invoice-march-a', 'invoice-march-b']);
  assert.equal(reply.awaiting, 'CLIENTE');
  assert.equal(h.escalations.length, 0);
});

test('negación breve "No, contrato" cambia categoría y elimina candidatos y pregunta de FACTURA', async () => {
  const h = makeHarness();
  h.requests.state = seededRequest();
  const message = 'No, contrato';
  const reply = await h.handle(message);

  assert.ok(reply);
  assert.equal(clasificar(message).tipo, 'SOLICITUD');
  assert.equal(h.extractCalls.length, 1);
  assert.equal(h.llmCalls.length, 0);
  assert.equal(h.slotResults[0]?.query.category, 'CONTRATO');
  assert.equal(h.slotResults[0]?.query.period, null);
  assert.equal(h.slotResults[0]?.query.folio, null);
  assert.equal(h.slotResults[0]?.query.text, null);
  assert.equal(h.search.searches[0]?.query.category, 'CONTRATO');
  assert.equal(h.requests.state.category, 'CONTRATO');
  assert.equal(h.requests.state.period, null);
  assert.equal(h.requests.state.folio, null);
  assert.equal(h.requests.state.fallos, 0);
  assert.equal(h.requests.state.opciones?.[0]?.id, 'contract-1');
  assert.equal(h.requests.state.ultimaPregunta, null);
  assert.equal(h.requests.state.preguntas, 0);
  assert.deepEqual(h.requests.state.preguntado, {});
  assert.equal(h.escalations.length, 0);
  assert.equal(reply.awaiting, 'CLIENTE');
});

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

// ── Varios documentos en un mensaje ─────────────────────────────────────

/** Nombres de los archivos entregados, en el orden en que salieron. */
function entregados(h: ReturnType<typeof makeHarness>): string[] {
  return h.delivered.map((args) => String(((args as unknown[])[1] as { name: string }).name));
}

test('"la factura de octubre y noviembre con la de septiembre" entrega las tres, en orden', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-15T12:00:00.000Z') });
  const h = makeHarness();
  for (const mes of ['2026-09', '2026-10', '2026-11']) {
    h.search.periodResults.set(mes, [document(`invoice-${mes}`, `FACTURA_${mes}.pdf`, 'FACTURA', mes)]);
  }

  const reply = await h.handle('Pásame la factura de octubre y noviembre con la de septiembre');

  assert.ok(reply);
  assert.deepEqual(entregados(h), ['FACTURA_2026-09.pdf', 'FACTURA_2026-10.pdf', 'FACTURA_2026-11.pdf']);
  assert.equal(reply.text, '', 'las leyendas de cada archivo ya lo dicen');
  assert.equal(reply.awaiting, 'NADIE');
  assert.deepEqual(h.llmCalls, [], 'partir la lista es por reglas, sin modelo');
  assert.equal(h.escalations.length, 0);
});

test('gramática de pregunta de mes para factura, contrato, cotización, reporte y póliza', async () => {
  const cases = [
    ['FACTURA', /la factura/i], ['CONTRATO', /el contrato/i],
    ['COTIZACION', /la cotización/i], ['REPORTE', /el reporte/i],
    ['POLIZA', /la póliza/i],
  ] as const;
  for (const [category, expected] of cases) {
    const scope = { ...orgScope, windows: [{ category, periodFrom: null, periodTo: null }] } as OrgScope;
    const h = makeHarness({ scopes: [scope] });
    h.search.catalog = Array.from({ length: 6 }, (_, i) => ({
      ...document(`doc-${i}`, `${category}_2026-0${i + 1}.pdf`),
      category, period: new Date(`2026-0${i + 1}-01T00:00:00.000Z`),
    }));
    const reply = await h.handle(`Necesito ${category.toLowerCase().replace('_', ' ')}`);
    assert.ok(reply, category);
    assert.match(reply.text, expected, category);
    assert.doesNotMatch(reply.text, /\bla (contrato|reporte|estado de cuenta)\b/i);
  }
});

test('estado de cuenta y documento contable llevan artículo masculino en la entrega', async () => {
  for (const [category, expected] of [
    ['ESTADO_CUENTA', /el estado de cuenta/i], ['CONTABLE', /el documento contable/i],
  ] as const) {
    const scope = { ...orgScope, windows: [{ category, periodFrom: null, periodTo: null }] } as OrgScope;
    const h = makeHarness({ scopes: [scope] });
    const filename = `${category}_2026-03.pdf`;
    const doc = { ...document('selected', filename), category };
    h.search.catalog = [doc];
    h.requests.state.opciones = [{ n: 1, tipo: 'documento', id: 'selected', nombre: filename }];
    const reply = await h.handle('la 1');
    assert.ok(reply);
    assert.equal(h.delivered.length, 1);
    assert.match(String((h.delivered[0] as unknown[])[2]), expected);
  }
});

test('cero resultados conserva contrato y mes; solo pide datos que faltan', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00.000Z') });
  const h = makeHarness();
  h.search.catalog = [];
  const reply = await h.handle('Pásame los contratos de marzo de 2026');
  assert.ok(reply);
  assert.match(reply.text, /contrato[s]? de .*marzo de 2026/i);
  assert.match(reply.text, /folio|nombre del archivo/i);
  assert.doesNotMatch(reply.text, /mes exacto|de qué mes|qué documento|perdón|disculpa/i);
  assert.equal(h.requests.state.category, 'CONTRATO');
  assert.equal(h.requests.state.period, '2026-03-01T00:00:00.000Z');
  assert.equal(h.escalations.length, 0);
});

test('cero resultados con folio conocido no vuelve a pedirlo', async () => {
  const h = makeHarness();
  h.search.catalog = [];
  const reply = await h.handle('Necesito la factura con folio A100');
  assert.ok(reply);
  assert.match(reply.text, /A100/);
  assert.doesNotMatch(reply.text, /¿.*folio|si tienes el .*folio|dame el .*folio/i);
  assert.equal(h.requests.state.folio, 'A100');
});

test('tras rechazar un archivo, cero resultados tampoco vuelve a pedir folio ni mes conocidos', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00.000Z') });
  const h = makeHarness();
  h.search.catalog = [];
  h.requests.state.rechazados = ['previous-doc'];
  const reply = await h.handle('Necesito el contrato de marzo de 2026 con folio A100');
  assert.ok(reply);
  assert.match(reply.text, /contrato.*marzo de 2026.*A100/i);
  assert.doesNotMatch(reply.text, /¿.*folio|si tienes el .*folio|mes exacto|si tienes el .*mes/i);
});

for (const frase of ['Mándamelo de nuevo', 'Mándamela otra vez', 'Reenvíamelo', 'Reenvíamela', '¿Me lo mandas de nuevo?', '¿Me la mandas otra vez?', 'Otra vez', 'De nuevo']) {
  test(`reenvío solicitado: ${frase}`, async () => {
    const h = makeHarness();
    const doc = document('previous-invoice', 'FACTURA_2026-02_V3001.pdf');
    h.requests.delivery = { documentId: doc.id, name: doc.name, category: doc.category, period: (doc.period as Date).toISOString(), at: new Date().toISOString() };
    const before = structuredClone(h.requests.delivery);
    const reply = await h.handle(frase);
    assert.ok(reply);
    assert.equal(h.delivered.length, 1);
    assert.equal(h.search.searches.length, 0);
    assert.equal(h.escalations.length, 0);
    assert.deepEqual(h.requests.delivery, before);
    assert.doesNotMatch(String((h.delivered[0] as unknown[])[2]), /perdón|disculpa|ahora sí/i);
  });
}

test('preguntar por el origen de septiembre explica el nombre sin conceder una corrección ni reenviar', async () => {
  const h = makeHarness();
  const doc = document('sept-doc', 'FACTURA_2026-09.pdf', 'FACTURA', '2026-09');
  h.search.catalog = [doc];
  h.requests.delivery = { documentId: doc.id, name: doc.name, category: doc.category, period: (doc.period as Date).toISOString(), at: new Date().toISOString() };
  const reply = await h.handle('¿Cómo sabes que es de septiembre?');
  assert.ok(reply);
  assert.match(reply.text, /nombre del archivo/i);
  assert.match(reply.text, /septiembre de 2026/i);
  assert.doesNotMatch(reply.text, /tienes razón|perdón/i);
  assert.equal(h.delivered.length, 0);
  assert.equal(h.search.searches.length, 0);
});

test('si el mes solo está en el registro, la explicación no lo atribuye al nombre ni al contenido', async () => {
  const h = makeHarness();
  const doc = document('indexed-doc', 'archivo.pdf', 'FACTURA', '2026-09');
  h.search.catalog = [doc];
  h.requests.delivery = { documentId: doc.id, name: doc.name, category: doc.category, period: (doc.period as Date).toISOString(), at: new Date().toISOString() };
  const reply = await h.handle('¿Cómo sabes que es de septiembre?');
  assert.ok(reply);
  assert.match(reply.text, /registro/i);
  assert.doesNotMatch(reply.text, /lo dice el nombre|lo leí en el documento|tienes razón/i);
  assert.equal(h.delivered.length, 0);
});

test('saludo inicial presenta a JARVIS con nombre y empresa del alcance', async () => {
  const h = makeHarness({ senderName: 'Ana López' });
  const reply = await h.handle('Hola');
  assert.ok(reply);
  assert.match(reply.text, /Ana/);
  assert.match(reply.text, /JARVIS/);
  assert.match(reply.text, /Constructora Vega/);
  assert.match(reply.text, /documentos?/i);
  assert.equal(h.search.searches.length, 0);
});

test('saludo inicial de buenos días conserva esa cortesía al presentarse', async () => {
  const h = makeHarness({ senderName: 'Ana López' });
  const reply = await h.handle('Buenos días');
  assert.ok(reply);
  assert.match(reply.text, /^¡Buenos días, Ana!/);
  assert.match(reply.text, /JARVIS/);
});

test('saludo sin nombre válido omite apelativo y usa la empresa correcta de cada línea', async () => {
  for (const organizationName of ['Constructora Vega', 'Grupo Sol']) {
    const h = makeHarness({ senderName: '🌸🌸', scopes: [{ ...orgScope, organizationId: organizationName, organizationName }] });
    const reply = await h.handle('Hola');
    assert.ok(reply);
    assert.match(reply.text, /JARVIS/);
    assert.ok(reply.text.includes(organizationName));
    assert.doesNotMatch(reply.text, /🌸|Prueba|Ana/);
  }
});

test('un nombre de perfil empresarial no se usa como nombre de pila', async () => {
  const h = makeHarness({ senderName: 'Constructora Vega' });
  const reply = await h.handle('Hola');
  assert.ok(reply);
  assert.doesNotMatch(reply.text, /¡Hola, Constructora!/);
  assert.match(reply.text, /JARVIS/);
});

test('saludo repetido usa nombre y no repite la presentación', async () => {
  const h = makeHarness({ senderName: 'Ana López', history: [{ role: 'bot', text: '¡Hola! Soy JARVIS.', at: new Date() }] });
  const reply = await h.handle('Buenos días');
  assert.ok(reply);
  assert.match(reply.text, /Ana/);
  assert.match(reply.text, /Buenos días/);
  assert.doesNotMatch(reply.text, /soy JARVIS/i);
});

test('saludo repetido tras una presentación de buenos días tampoco vuelve a presentar a JARVIS', async () => {
  const h = makeHarness({ senderName: 'Ana López', history: [{ role: 'bot', text: '¡Buenos días, Ana! Soy JARVIS.', at: new Date() }] });
  const reply = await h.handle('Buenas tardes');
  assert.ok(reply);
  assert.match(reply.text, /^¡Buenas tardes, Ana!/);
  assert.doesNotMatch(reply.text, /soy JARVIS/i);
});

test('una solicitud directa se entrega sin detenerla para presentar a JARVIS', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00.000Z') });
  const h = makeHarness({ senderName: 'Ana López' });
  h.search.periodResults.set('2026-03', [document('march-direct', 'FACTURA_2026-03.pdf', 'FACTURA', '2026-03')]);
  const reply = await h.handle('Necesito la factura de marzo de 2026');
  assert.ok(reply);
  assert.equal(h.requests.delivery?.documentId, 'march-direct');
  assert.equal(h.delivered.length, 1);
  assert.doesNotMatch(String((h.delivered[0] as unknown[])[2]), /soy JARVIS/i);
});

test('saludo con solicitud en el mismo mensaje conserva la entrega', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00.000Z') });
  const h = makeHarness({ senderName: 'Ana López' });
  h.search.periodResults.set('2026-03', [document('march-hello', 'FACTURA_2026-03.pdf', 'FACTURA', '2026-03')]);
  const reply = await h.handle('Hola, necesito la factura de marzo de 2026');
  assert.ok(reply);
  assert.equal(h.requests.delivery?.documentId, 'march-hello');
  assert.equal(h.delivered.length, 1);
  assert.match(String((h.delivered[0] as unknown[])[2]), /^¡Hola, Ana!/);
  assert.doesNotMatch(String((h.delivered[0] as unknown[])[2]), /soy JARVIS/i);
});

test('saludo inicial sin alcance de empresa única presenta a JARVIS sin atribuir una empresa', async () => {
  const h = makeHarness({ senderName: null, scopes: [orgScope, { ...orgScope, organizationId: 'org-sol', organizationName: 'Grupo Sol' }] });
  const reply = await h.handle('Hola');
  assert.ok(reply);
  assert.match(reply.text, /JARVIS/);
  assert.doesNotMatch(reply.text, /Constructora Vega|Grupo Sol/);
});

test('entrega de varios archivos conserva orden e identificación con leyendas breves', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-15T12:00:00.000Z') });
  const h = makeHarness();
  for (const mes of ['2026-09', '2026-10', '2026-11']) h.search.periodResults.set(mes, [document(mes, `FACTURA_${mes}.pdf`, 'FACTURA', mes)]);
  await h.handle('Pásame las facturas de septiembre, octubre y noviembre');
  assert.deepEqual(entregados(h), ['FACTURA_2026-09.pdf', 'FACTURA_2026-10.pdf', 'FACTURA_2026-11.pdf']);
  assert.equal(h.delivered.length, 3);
  for (const delivery of h.delivered) assert.match(String((delivery as unknown[])[2]), /factura de|FACTURA_2026/i);
  for (const delivery of h.delivered.slice(1)) assert.doesNotMatch(String((delivery as unknown[])[2]), /cualquier cosa|avísame|si necesitas/i);
  for (const delivery of h.delivered.slice(1)) assert.doesNotMatch(String((delivery as unknown[])[2]), /también te mando|aquí va también|listo, te mando/i);
  for (const delivery of h.delivered.slice(1)) {
    const [_, doc, caption] = delivery as unknown[];
    assert.ok(String(caption).includes(String((doc as { name: string }).name)));
  }
});

test('si falta uno de los meses, se entregan los demás y se dice cuál faltó', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-15T12:00:00.000Z') });
  const h = makeHarness();
  for (const mes of ['2026-09', '2026-10']) {
    h.search.periodResults.set(mes, [document(`invoice-${mes}`, `FACTURA_${mes}.pdf`, 'FACTURA', mes)]);
  }

  const reply = await h.handle('las facturas de septiembre, octubre y noviembre');

  assert.ok(reply);
  assert.deepEqual(entregados(h), ['FACTURA_2026-09.pdf', 'FACTURA_2026-10.pdf']);
  assert.match(reply.text, /No encontré \*la factura de noviembre de 2026\*/);
  assert.equal(reply.awaiting, 'CLIENTE');
});

test('un rango "de enero a marzo" es una factura por mes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00.000Z') });
  const h = makeHarness();
  for (const mes of ['2026-01', '2026-02', '2026-03']) {
    h.search.periodResults.set(mes, [document(`invoice-${mes}`, `FACTURA_${mes}.pdf`, 'FACTURA', mes)]);
  }

  await h.handle('mándame las facturas de enero a marzo');

  assert.deepEqual(entregados(h), ['FACTURA_2026-01.pdf', 'FACTURA_2026-02.pdf', 'FACTURA_2026-03.pdf']);
});

test('"todas en orden de Oxxo y McDonald" entrega todas las de cada uno, del mes más viejo al más nuevo', async () => {
  const h = makeHarness();
  h.search.textResults.set('oxxo', [
    document('oxxo-sep', 'Oxxo_septiembre.pdf', 'FACTURA', '2026-09'),
    document('oxxo-ago', 'Oxxo_agosto.pdf', 'FACTURA', '2026-08'),
  ]);
  h.search.textResults.set('macdonald', [document('mc-jul', 'McDonald_julio.pdf', 'FACTURA', '2026-07')]);

  const reply = await h.handle('pasame todas en orden de Oxxo y macdonald');

  assert.ok(reply);
  assert.deepEqual(entregados(h), ['Oxxo_agosto.pdf', 'Oxxo_septiembre.pdf', 'McDonald_julio.pdf']);
  assert.equal(reply.awaiting, 'NADIE');
  const buscados = h.search.searches.map((s) => s.query.text);
  assert.deepEqual(buscados, ['oxxo', 'macdonald'], 'cada nombre es su propia búsqueda');
});

test('con varios candidatos en un pedido, se entrega lo exacto y se numera lo que hay que elegir', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-15T12:00:00.000Z') });
  const h = makeHarness();
  h.search.periodResults.set('2026-10', [document('oct', 'FACTURA_2026-10.pdf', 'FACTURA', '2026-10')]);
  h.search.periodResults.set('2026-11', [
    document('nov-a', 'FACTURA_A_2026-11.pdf', 'FACTURA', '2026-11'),
    document('nov-b', 'FACTURA_B_2026-11.pdf', 'FACTURA', '2026-11'),
  ]);

  const reply = await h.handle('la factura de octubre y la de noviembre');

  assert.ok(reply);
  assert.deepEqual(entregados(h), ['FACTURA_2026-10.pdf']);
  assert.match(reply.text, /De \*la factura de noviembre de 2026\* encontré varias/);
  assert.match(reply.text, /\*1\.\* \*FACTURA_A_2026-11\.pdf\*/);
  assert.match(reply.text, /\*2\.\* \*FACTURA_B_2026-11\.pdf\*/);
  assert.deepEqual(h.requests.state.opciones?.map((o) => o.id), ['nov-a', 'nov-b']);
  assert.equal(reply.awaiting, 'CLIENTE');

  // Y "las dos" de esa lista se entregan juntas.
  const segunda = await h.handle('las dos');
  assert.ok(segunda);
  assert.deepEqual(entregados(h), ['FACTURA_2026-10.pdf', 'FACTURA_A_2026-11.pdf', 'FACTURA_B_2026-11.pdf']);
});

test('"la 1 y la 2" sobre una lista entrega ambas y conserva la lista', async () => {
  const { h, documentA, documentB } = pendingDocumentOptions();

  const reply = await h.handle('La 1 y la 2 por favor');

  assert.ok(reply);
  assert.deepEqual(h.search.byIdCalls, [documentA.id, documentB.id]);
  assert.deepEqual(entregados(h), [documentA.name, documentB.name]);
  assert.equal(h.requests.state.opciones?.length, 2, 'la lista sigue para "y también la 3"');
  assert.equal(h.escalations.length, 0);
});

test('"la 1 y la 7" con una lista de dos entrega la 1 y no inventa la 7', async () => {
  const { h, documentA } = pendingDocumentOptions();

  await h.handle('la 1 y la 7');

  assert.deepEqual(entregados(h), [documentA.name]);
});

function selectionOptions() {
  const h = makeHarness();
  const docs = Array.from({ length: 5 }, (_, i) => document(`selection-${i + 1}`, `FACTURA_${i + 1}.pdf`));
  h.search.periodResults.set('options', docs);
  h.requests.state = {
    ...emptyRequest(),
    category: 'FACTURA',
    opciones: docs.map((doc, i) => ({
      n: i + 1, tipo: 'documento', id: String(doc.id), nombre: String(doc.name),
    })),
  };
  return h;
}

for (const [text, selected] of [
  ['La 1, no la 3', [1]],
  ['La 1 pero no la 3', [1]],
  ['La 2, excepto la 1', [2]],
  ['La 1 y la 2, pero no la 3', [1, 2]],
  ['Todas menos la 3', [1, 2, 4, 5]],
  ['Todas excepto la 2', [1, 3, 4, 5]],
  ['Todas menos la 1 y la 3', [2, 4, 5]],
  ['La primera y la segunda, excepto la tercera', [1, 2]],
  ['La 1 y la 1, no la 3', [1]],
  ['La 1 y la 2', [1, 2]],
  ['Solo la 1', [1]],
  ['No, mejor la 2', [2]],
  ['Todas', [1, 2, 3, 4, 5]],
  ['Todas por favor', [1, 2, 3, 4, 5]],
  ['Ahora la 3 y la 4', [3, 4]],
  ['Y la 5', [5]],
] as const) {
  test(`selección de documentos: "${text}" entrega solo lo incluido y conserva la lista`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
    t.mock.method(Math, 'random', () => 0);
    const h = selectionOptions();
    const options = structuredClone(h.requests.state.opciones);

    const reply = await h.handle(text);

    assert.equal(reply?.awaiting, 'NADIE');
    assert.deepEqual(h.search.byIdCalls, selected.map((n) => `selection-${n}`));
    assert.deepEqual(entregados(h), selected.map((n) => `FACTURA_${n}.pdf`));
    assert.deepEqual(h.requests.state.opciones, options);
    assert.deepEqual(h.search.searches, []);
    assert.deepEqual(h.extractCalls, []);
    assert.deepEqual(h.llmCalls, []);
    assert.deepEqual(h.draftCalls, []);
    assert.deepEqual(h.escalations, []);
  });
}

for (const text of [
  'La 1, no la 1',
  'La 1 y la 2 excepto la 1 y la 2',
  'Todas menos la 1 y la 2',
  'No la 2',
  'Todas menos la 9',
  'Todas menos la 10',
  'Todas excepto la 0',
  'La 1, no la 9',
  'La 9 excepto la 1',
]) {
  test(`selección vacía o fuera de rango: "${text}" no consulta ni entrega documentos`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
    t.mock.method(Math, 'random', () => 0);
    const { h } = pendingDocumentOptions();
    const before = structuredClone(h.requests.state);

    const reply = await h.handle(text);

    assert.equal(reply?.awaiting, 'CLIENTE');
    assert.ok(reply.text);
    assert.deepEqual(h.search.byIdCalls, []);
    assert.deepEqual(h.delivered, []);
    assert.deepEqual(h.requests.state, before);
    assert.deepEqual(h.search.searches, []);
    assert.deepEqual(h.extractCalls, []);
    assert.deepEqual(h.llmCalls, []);
    assert.deepEqual(h.draftCalls, []);
    assert.deepEqual(h.escalations, []);
  });
}

test('una exclusión no renumera la lista ni afecta selecciones de turnos posteriores', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  t.mock.method(Math, 'random', () => 0);
  const h = selectionOptions();
  const options = structuredClone(h.requests.state.opciones);

  await h.handle('Todas menos la 3');
  assert.deepEqual(h.search.byIdCalls, ['selection-1', 'selection-2', 'selection-4', 'selection-5']);
  await h.handle('Ahora la 3 y la 4');
  await h.handle('Y la 5');

  assert.deepEqual(h.search.byIdCalls, [
    'selection-1', 'selection-2', 'selection-4', 'selection-5', 'selection-3', 'selection-4', 'selection-5',
  ]);
  assert.deepEqual(h.requests.state.opciones, options);
  assert.deepEqual(h.llmCalls, []);
  assert.deepEqual(h.draftCalls, []);
});

test('una corrección "no era febrero, era marzo" sigue siendo un solo pedido', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00.000Z') });
  const h = makeHarness();
  h.search.periodResults.set('2026-02', [document('feb', 'FACTURA_2026-02.pdf', 'FACTURA', '2026-02')]);
  h.search.periodResults.set('2026-03', [document('mar', 'FACTURA_2026-03.pdf', 'FACTURA', '2026-03')]);

  await h.handle('la factura, no era febrero, era marzo');

  assert.deepEqual(entregados(h), ['FACTURA_2026-03.pdf']);
});

function inventoryCatalog() {
  const h = makeHarness();
  h.search.catalog = [
    ...Array.from({ length: 6 }, (_, i) => document(`jun-${i + 1}`, `FACTURA_JUNIO_${i + 1}.pdf`, 'FACTURA', '2026-06')),
    ...Array.from({ length: 3 }, (_, i) => document(`sep-${i + 1}`, `FACTURA_SEPTIEMBRE_${i + 1}.pdf`, 'FACTURA', '2026-09')),
    document('apr-1', 'FACTURA_ABRIL.pdf', 'FACTURA', '2026-04'),
    document('feb-1', 'FACTURA_FEBRERO.pdf', 'FACTURA', '2026-02'),
  ];
  return h;
}

test('inventario general 11 y consulta sin julio: el muestreo de 6 no se anuncia como total', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  t.mock.method(Math, 'random', () => 0);
  const h = inventoryCatalog();

  const inventory = await h.handle('¿Qué documentos tienes?');
  assert.match(inventory?.text ?? '', /\*11\* facturas/);
  assert.equal(h.search.inventoryScopes.length, 1);

  const july = await h.handle('¿Qué facturas tienes de julio?');
  const julyText = (july?.text ?? '').replaceAll('*', '');
  assert.match(julyText, /julio de 2026/i);
  assert.match(julyText, /11 facturas/i);
  assert.doesNotMatch(julyText, /6 facturas/i);
  assert.equal(h.search.searches.at(-1)?.query.period, null, 'el fallback consulta otros meses');
  assert.deepEqual(h.delivered, []);
  assert.deepEqual(h.llmCalls, []);
});

test('junio con 6 buscables: ofrece 5 sin llamar 5 al total, y las opciones son elegibles', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  t.mock.method(Math, 'random', () => 0);
  const h = inventoryCatalog();

  const months = await h.handle('¿De qué meses tienes facturas?');
  assert.match(months?.text ?? '', /junio de 2026 \(6\)/i);
  assert.deepEqual(h.search.monthLookups, ['FACTURA']);

  const june = await h.handle('Pásame las facturas de junio');
  const juneText = (june?.text ?? '').replaceAll('*', '');
  assert.match(juneText, /6 facturas de junio de 2026/i);
  assert.match(juneText, /(?:muestro|opciones).*5|5.*(?:muestro|opciones)/i);
  assert.equal(h.requests.state.opciones?.length, 5);
  assert.equal(h.search.searches.at(-1)?.query.category, 'FACTURA');
  assert.deepEqual(h.search.searches.at(-1)?.query.period, new Date('2026-06-01T00:00:00.000Z'));
  assert.deepEqual(h.delivered, []);
  assert.deepEqual(h.llmCalls, []);
});

test('consulta de documentos de junio mantiene el foco en 6 y muestra 5 opciones', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  t.mock.method(Math, 'random', () => 0);
  const h = inventoryCatalog();

  const reply = await h.handle('¿Qué documentos tienes de junio?');

  const replyText = (reply?.text ?? '').replaceAll('*', '');
  assert.match(replyText, /6 documentos de junio de 2026/i);
  assert.match(replyText, /(?:muestro|opciones).*5|5.*(?:muestro|opciones)/i);
  assert.equal(h.requests.state.opciones?.length, 5);
  assert.deepEqual(h.delivered, []);
});

test('más de una factura incluye septiembre 3 y junio 6, omite abril y febrero 1', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  t.mock.method(Math, 'random', () => 0);
  const h = inventoryCatalog();

  const reply = await h.handle('¿De qué meses tienes más de una factura?');

  assert.match(reply?.text ?? '', /septiembre de 2026 \(3\)/i);
  assert.match(reply?.text ?? '', /junio de 2026 \(6\)/i);
  assert.doesNotMatch(reply?.text ?? '', /abril|febrero/i);
  assert.deepEqual(h.search.monthLookups, ['FACTURA']);
  assert.deepEqual(h.delivered, []);
  assert.deepEqual(h.llmCalls, []);
});

test('más de una factura sin meses repetidos responde que no hay ninguno', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  const h = inventoryCatalog();
  h.search.catalog = h.search.catalog!.filter((doc) => doc.id === 'apr-1' || doc.id === 'feb-1');

  const reply = await h.handle('¿De qué meses tienes más de una factura?');

  assert.match(reply?.text ?? '', /no tengo meses con más de una factura/i);
  assert.doesNotMatch(reply?.text ?? '', /abril|febrero/i);
  assert.deepEqual(h.delivered, []);
});

test('más de una factura no presenta documentos sin periodo como un mes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  const h = inventoryCatalog();
  t.mock.method(h.search, 'mesesDe', async () => [
    { period: new Date('2026-09-01T00:00:00Z'), count: 3 },
    { period: null, count: 2 },
  ] as never);

  const reply = await h.handle('¿De qué meses tienes más de una factura?');

  assert.match(reply?.text ?? '', /septiembre de 2026 \(3\)/i);
  assert.doesNotMatch(reply?.text ?? '', /sin mes/i);
});

test('el total mostrado respeta las exclusiones de la solicitud y no el tamaño del catálogo', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  t.mock.method(Math, 'random', () => 0);
  const h = inventoryCatalog();
  h.requests.state = { ...emptyRequest(), rechazados: ['jun-6'] };

  const reply = await h.handle('Pásame las facturas de junio');

  assert.match((reply?.text ?? '').replaceAll('*', ''), /5 facturas de junio de 2026/i);
  assert.equal(h.requests.state.opciones?.length, 5);
  assert.ok(h.requests.state.opciones?.every((option) => option.id !== 'jun-6'));
  assert.deepEqual(h.delivered, []);
});

test('una página de cinco entre doce informa el total real, no cinco ni seis', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T12:00:00Z') });
  t.mock.method(Math, 'random', () => 0);
  const h = inventoryCatalog();
  h.search.catalog = Array.from({ length: 12 }, (_, i) =>
    document(`jun-${i + 1}`, `FACTURA_JUNIO_${i + 1}.pdf`, 'FACTURA', '2026-06'));

  const reply = await h.handle('Pásame las facturas de junio');

  assert.match((reply?.text ?? '').replaceAll('*', ''), /12 facturas de junio de 2026/i);
  assert.equal(h.requests.state.opciones?.length, 5);
  assert.deepEqual(h.delivered, []);
});
