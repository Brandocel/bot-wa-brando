import assert from 'node:assert/strict';
import test from 'node:test';
import type { LlmPort } from '../ports/llm.port';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import type { OrgScope } from './access-scope.service';
import { DocumentSearchService } from './document-search.service';
import { SlotExtractorService } from './slot-extractor.service';
import { SupportStrategy, type StrategyContext } from './support.strategy';
import type { Solicitud } from './solicitud.service';

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

  async actual(): Promise<Solicitud> {
    return structuredClone(this.state);
  }

  async guardar(_conversationId: string, patch: Partial<Solicitud>): Promise<Solicitud> {
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
  monthLookups: string[] = [];
  monthScopes: Array<readonly unknown[]> = [];
  inventoryScopes: Array<readonly unknown[]> = [];
  readonly contracts = [document('contract-1', 'CONTRATO_A.pdf'), document('contract-2', 'CONTRATO_B.pdf')];
  readonly sixInvoices = [
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  ].map((month, index) => document(`invoice-${index}`, `FACTURA_${month}.pdf`, 'FACTURA', month));

  async search(scopes: readonly unknown[], query: Record<string, unknown>): Promise<unknown[]> {
    this.searches.push({ scopes, query });
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
    if (id === 'previous-invoice') return document(id, 'FACTURA_2026-02_V3001.pdf');
    return this.sixInvoices.find((doc) => doc.id === id) ?? null;
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
  const writerCalls: string[] = [];
  const scopes = [orgScope];
  const llm: LlmPort = {
    extract: async (input) => {
      llmCalls.push(input.user);
      return input.validate(llmForTurn(input.user));
    },
    draft: async () => null,
  };
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
    { write: async (brief: { fallback: string }) => { writerCalls.push(brief.fallback); return brief.fallback; } } as never,
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

  return { handle, requests, search, escalations, delivered, llmCalls, extractCalls: slots.calls, writerCalls, scopes };
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
