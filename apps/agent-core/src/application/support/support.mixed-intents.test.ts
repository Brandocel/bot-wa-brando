import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { DocCategory } from '@prisma/client';
import type { LlmPort } from '../ports/llm.port';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import type { OrgScope } from './access-scope.service';
import type { SearchQuery } from './document-search.service';
import { ACUSE, CIERRE, SALUDO, clasificar, esCierre, esPausa, normalizar, parseQueryTieneDatos, separarPeticionMixta } from './message-classifier';
import { dividirPedidos } from './pedidos';
import { parseQuery } from './query-parser';
import { ReplyWriterService } from './reply-writer.service';
import { SlotExtractorService } from './slot-extractor.service';
import type { Solicitud, UltimaEntrega } from './solicitud.service';
import { SupportStrategy } from './support.strategy';

// Regresiones de intenciones mixtas y caracterización de las rutas protegidas.
// Sin bootstrap, configuración, .env, clientes externos ni persistencia real.
// Incluido en test:conversational; se conserva el nombre del archivo original.
const NOW = '2026-09-29T12:00:00.000Z';
const scope: OrgScope = {
  organizationId: 'org-memory', organizationName: 'Empresa Memoria',
  windows: [
    { category: 'FACTURA', periodFrom: null, periodTo: null },
    { category: 'CONTRATO', periodFrom: null, periodTo: null },
  ],
  strippedByVerification: [],
};

function empty(): Solicitud {
  return {
    category: null, period: null, folio: null, organizationId: null,
    opciones: null, preguntas: 0, preguntado: {}, ultimaPregunta: null,
    fallos: 0, rechazados: [], updatedAt: null,
  };
}

function doc(id: string, category: DocCategory, month: string, name = `${category}_${id}.pdf`) {
  return {
    id, category, name, period: new Date(`${month}-01T00:00:00.000Z`),
    folio: null as string | null, organizationId: scope.organizationId,
    extractedText: '', status: 'INDEXED',
  };
}
type MemoryDocument = ReturnType<typeof doc>;
const invoices = () => ['01', '02', '03', '04', '05', '06'].map((month) =>
  doc(`invoice-${month}`, 'FACTURA', `2026-${month}`));
const contracts = (count = 2) => Array.from({ length: count }, (_, i) =>
  doc(`contract-${i + 1}`, 'CONTRATO', '2026-03'));
const options = (docs: MemoryDocument[]) => docs.map((d, i) => ({
  n: i + 1, tipo: 'documento' as const, id: d.id, nombre: d.name,
}));

function fixedRuntime(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(NOW) });
  // Las plantillas varían al azar: fijar la primera permite registrar la respuesta exacta.
  t.mock.method(Math, 'random', () => 0);
}

function harness(catalog = [...invoices(), ...contracts()]) {
  let state = empty();
  let lastDelivery: UltimaEntrega | null = null;
  const events: string[] = [];
  const searches: Array<{ query: SearchQuery; resultIds: string[] }> = [];
  const saves: Partial<Solicitud>[] = [];
  const savedStates: Solicitud[] = [];
  const extractionStates: Solicitud[] = [];
  const deliveries: Array<{ id: string; caption: string }> = [];
  const escalations: unknown[] = [];
  const llmCalls: string[] = [];
  const extractionResults: unknown[] = [];
  const llm: LlmPort = {
    extract: async (input) => {
      events.push('llm.extract');
      llmCalls.push('extract');
      // Solo se espera aquí "Espera" SIN solicitud. Respuesta ficticia validada.
      return input.validate({
        categoria: 'NINGUNA', periodo: 'NINGUNO', folio: 'NINGUNO', empresa: 'NINGUNA',
        no_es_documento: true, tipo_mensaje: 'CORTESIA',
      });
    },
    draft: async () => { events.push('llm.draft'); llmCalls.push('draft'); return null; },
  };
  const slots = new SlotExtractorService(llm);
  const writer = new ReplyWriterService(llm);
  const strategy = new SupportStrategy(
    {
      resolve: async (senderId: string) => {
        assert.equal(senderId, 'sender-memory');
        return { decision: 'ALLOW', scopes: [scope] };
      },
      denialFor: () => null,
      audit: async () => { events.push('audit'); },
    } as never,
    {
      extract: async (...args: Parameters<SlotExtractorService['extract']>) => {
        events.push('slots.extract');
        extractionStates.push(structuredClone(state));
        const result = await slots.extract(...args);
        extractionResults.push(structuredClone(result));
        return result;
      },
    } as never,
    {
      // Doble con filtros reales sobre un catálogo en memoria: NO devuelve
      // documentos solo por categoría ignorando query.text o excludeIds.
      search: async (scopes: OrgScope[], query: SearchQuery, limit = 5) => {
        events.push('search');
        assert.deepEqual(scopes, [scope]);
        const found = catalog.filter((d) =>
          (!query.organizationId || d.organizationId === query.organizationId) &&
          scopes.some((s) => s.organizationId === d.organizationId &&
            s.windows.some((w) => w.category === d.category)) &&
          (!query.category || query.folio || d.category === query.category) &&
          (!query.period || d.period.getTime() === query.period.getTime()) &&
          (!query.folio || `${d.folio ?? ''} ${d.name}`.toLowerCase().includes(query.folio.toLowerCase())) &&
          !query.excludeIds?.includes(d.id) &&
          (query.text?.toLowerCase().split(/\s+/).filter(Boolean) ?? []).every((word) =>
            `${d.name} ${d.extractedText}`.toLowerCase().includes(word)),
        ).slice(0, limit);
        searches.push({ query: structuredClone(query), resultIds: found.map((d) => d.id) });
        return found;
      },
      byId: async () => assert.fail('Ruta byId inesperada'),
      mesesDe: async () => assert.fail('Ruta mesesDe inesperada'),
      inventario: async () => assert.fail('Ruta inventario inesperada'),
    } as never,
    {
      deliver: async (_chat: string, d: MemoryDocument, caption: string) => {
        events.push('deliver'); deliveries.push({ id: d.id, caption }); return { ok: true };
      },
    } as never,
    {
      abrirEscalado: async (input: unknown) => {
        events.push('ticket'); escalations.push(structuredClone(input));
        return { ticket: { id: 'ticket-memory', number: 900 }, agente: null };
      },
      casoEnRevision: async () => null,
    } as never,
    {
      actual: async (conversationId: string) => {
        assert.equal(conversationId, 'conversation-memory');
        return structuredClone(state);
      },
      guardar: async (_id: string, patch: Partial<Solicitud>) => {
        events.push('save'); saves.push(structuredClone(patch));
        state = { ...state, ...structuredClone(patch), updatedAt: NOW };
        savedStates.push(structuredClone(state));
        return structuredClone(state);
      },
      cerrar: async (conversationId: string) => {
        assert.equal(conversationId, 'conversation-memory');
        events.push('close'); state = empty();
      },
      ultimaEntrega: async () => structuredClone(lastDelivery),
      registrarEntrega: async (_id: string, d: MemoryDocument) => {
        events.push('registerDelivery');
        lastDelivery = {
          documentId: d.id, name: d.name, category: d.category,
          period: d.period.toISOString(), at: NOW,
        };
      },
    } as never,
    { recent: async () => [] } as never,
    writer,
  );
  const handle = (body: string) => strategy.handle({
    id: 'message-memory', chatId: 'chat-memory', senderId: 'sender-memory', senderName: 'Prueba',
    body, kind: 'TEXT', isFromMe: false, isSelfChat: false, raw: {},
  } as IncomingMessage, { contactId: 'contact-memory', conversationId: 'conversation-memory' });

  return {
    handle, events, searches, saves, savedStates, extractionStates, deliveries, escalations, llmCalls, extractionResults,
    get state() { return structuredClone(state); },
    get lastDelivery() { return structuredClone(lastDelivery); },
    seed(value: Solicitud) { state = structuredClone(value); },
    clearTrace() {
      for (const a of [events, searches, saves, savedStates, extractionStates, deliveries, escalations, llmCalls, extractionResults]) a.length = 0;
    },
  };
}
type Harness = ReturnType<typeof harness>;

async function pendingInvoice(h: Harness) {
  const reply = await h.handle('Necesito una factura');
  assert.equal(reply?.awaiting, 'CLIENTE');
  assert.deepEqual(h.state, {
    ...empty(), category: 'FACTURA', preguntas: 1, preguntado: { periodo: true },
    ultimaPregunta: 'periodo', updatedAt: NOW,
  });
  h.clearTrace();
}

function inspect(text: string) {
  const normalized = normalizar(text);
  return {
    initial: clasificar(text), parseQuery: parseQuery(text),
    flags: {
      esPausa: esPausa(text), SALUDO: SALUDO.test(normalized), ACUSE: ACUSE.test(normalized),
      CIERRE: esCierre(text) || separarPeticionMixta(text)?.marcador === 'CIERRE',
      datos: parseQueryTieneDatos(normalized),
    },
  };
}

async function observe(t: TestContext, h: Harness, message: string) {
  const before = h.state;
  const parsed = inspect(message);
  const reply = await h.handle(message);
  assert.ok(reply);
  // Salida reproducible por caso; no confundir LLM simulado con red real.
  t.diagnostic(`TRACE ${JSON.stringify({
    case: t.name, message, ...parsed, before, after: h.state,
    events: h.events, extraction: h.extractionResults, llm: h.llmCalls,
    searches: h.searches, deliveries: h.deliveries, tickets: h.escalations,
    reply, lastDelivery: h.lastDelivery,
  })}`);
  assert.deepEqual(reply.clasificacion, parsed.initial);
  return { reply, before, ...parsed };
}

const mixed = [
  { text: 'Hola, necesito la factura de marzo', category: 'FACTURA', month: '03', keyword: null },
  { text: 'Gracias, ahora necesito un contrato', category: 'CONTRATO', month: null, keyword: null },
  { text: 'Ok, pero necesito la factura de febrero', category: 'FACTURA', month: '02', keyword: null },
  { text: 'Es todo, ahora necesito un contrato', category: 'CONTRATO', month: null, keyword: null },
  { text: 'Espera, mejor necesito un contrato', category: 'CONTRATO', month: null, keyword: null },
] as const;

for (const previous of ['vacia', 'factura-pendiente'] as const) {
  for (const c of mixed) {
    test(`mixto / ${previous} / ${c.text}`, async (t) => {
      fixedRuntime(t);
      const h = harness();
      if (previous === 'factura-pendiente') await pendingInvoice(h);
      const { reply, initial, parseQuery: query, flags } = await observe(t, h, c.text);
      assert.deepEqual(initial, { tipo: 'SOLICITUD', motivo: null, molesto: false, fuente: 'reglas' });
      assert.deepEqual(query, {
        category: c.category, period: c.month ? new Date(`2026-${c.month}-01T00:00:00.000Z`) : null,
        folio: null, text: c.keyword,
      });
      assert.deepEqual(flags, {
        esPausa: false, SALUDO: false, ACUSE: false,
        CIERRE: c.text.startsWith('Es todo'), datos: true,
      });
      assert.deepEqual(h.llmCalls, []);
      assert.deepEqual(h.extractionResults, [{
        query, companyHint: null, notADocumentRequest: false, tipoMensaje: null, source: 'reglas',
      }]);
      const closesPrevious = c.text.startsWith('Es todo');
      assert.deepEqual(h.events.slice(0, closesPrevious ? 2 : 1),
        closesPrevious ? ['close', 'slots.extract'] : ['slots.extract']);
      assert.deepEqual(h.escalations, []);
      assert.deepEqual(h.searches.map((s) => s.query), [{
        ...query, organizationId: scope.organizationId, excludeIds: [],
      }]);
      if (c.month) {
        assert.deepEqual(h.deliveries.map((d) => d.id), [`invoice-${c.month}`]);
        assert.equal(reply.text, '');
        assert.equal(reply.awaiting, 'NADIE');
        assert.deepEqual(h.state, empty());
        assert.equal(h.events.filter((e) => e === 'close').length, 1);
        assert.ok(h.events.indexOf('deliver') < h.events.indexOf('close'));
        assert.equal(h.lastDelivery?.documentId, `invoice-${c.month}`);
      } else {
        assert.deepEqual(h.deliveries, []);
        assert.equal(reply.awaiting, 'CLIENTE');
        assert.match(reply.text, /CONTRATO_contract-1\.pdf/);
        assert.match(reply.text, /CONTRATO_contract-2\.pdf/);
        assert.deepEqual(h.state, {
          ...empty(), category: 'CONTRATO', opciones: options(contracts()),
          updatedAt: NOW,
        });
        assert.equal(h.events.filter((e) => e === 'close').length, closesPrevious ? 1 : 0);
        assert.doesNotMatch(reply.text, /espera mejor/);
      }
    });
  }

  for (const text of ['Hola', 'Gracias', 'Ok', 'Es todo', 'Espera']) {
    test(`aislado / ${previous} / ${text}`, async (t) => {
      fixedRuntime(t);
      const h = harness();
      if (previous === 'factura-pendiente') await pendingInvoice(h);
      const { reply, before, initial, parseQuery: query, flags } = await observe(t, h, text);
      assert.equal(initial.tipo, 'CORTESIA');
      assert.deepEqual(flags, {
        esPausa: text === 'Espera', SALUDO: text === 'Hola', ACUSE: text === 'Ok',
        CIERRE: text === 'Es todo', datos: false,
      });
      assert.deepEqual(query, {
        category: null, period: null, folio: null, text: text === 'Espera' ? 'espera' : text,
      });
      assert.deepEqual(h.searches, []);
      assert.deepEqual(h.deliveries, []);
      assert.deepEqual(h.escalations, []);
      assert.deepEqual(h.saves, []);
      assert.equal(h.lastDelivery, null);
      const closes = text === 'Es todo' && previous === 'factura-pendiente';
      assert.deepEqual(h.state, closes ? empty() : before);
      assert.equal(h.events.includes('close'), closes);
      const pauseWithoutRequest = text === 'Espera' && previous === 'vacia';
      assert.deepEqual(h.extractionResults, []);
      assert.deepEqual(h.llmCalls, pauseWithoutRequest ? ['draft'] : []);
      assert.equal(reply.awaiting, previous === 'factura-pendiente' && !closes ? 'CLIENTE' : 'NADIE');
      if (text === 'Hola') assert.match(reply.text, /Hola/);
      if (text === 'Gracias') assert.match(reply.text, /Con gusto/);
      if (text === 'Ok' || (text === 'Es todo' && !closes)) assert.equal(reply.text, '');
      if (closes) assert.equal(reply.text, 'Entendido, lo dejamos aquí. Cuando necesites otro documento, dime.');
      if (text === 'Espera') assert.equal(reply.text, pauseWithoutRequest
        ? 'Aquí ando. Puedo buscarte documentos de *Empresa Memoria*.\nDime cuál necesitas y de qué mes.'
        : 'Claro, tómate tu tiempo.');
    });
  }
}

test('pausa mixta / seis contratos / pregunta el mes sin filtros ni fallos artificiales', async (t) => {
  fixedRuntime(t);
  const h = harness([...invoices(), ...contracts(6)]);
  await pendingInvoice(h);
  const { reply } = await observe(t, h, mixed[4].text);
  assert.deepEqual(h.searches.map((s) => [s.query.category, s.query.text, s.resultIds.length]), [
    ['CONTRATO', null, 6],
  ]);
  assert.deepEqual(h.state, {
    ...empty(), category: 'CONTRATO', preguntas: 1,
    preguntado: { periodo: true }, ultimaPregunta: 'periodo', updatedAt: NOW,
  });
  assert.match(reply.text, /mes/);
  assert.doesNotMatch(reply.text, /espera mejor/);
  assert.equal(reply.awaiting, 'CLIENTE');
  assert.deepEqual(h.llmCalls, []);
  assert.deepEqual(h.deliveries, []);
  assert.deepEqual(h.escalations, []);

  // Control causal con idéntico catálogo y estado previo; solo cambia el prefijo.
  const control = harness([...invoices(), ...contracts(6)]);
  await pendingInvoice(control);
  await control.handle('Necesito un contrato');
  assert.equal(control.state.ultimaPregunta, 'periodo');
  assert.equal(control.state.fallos, 0);
  assert.equal(control.searches.length, 1);
});

test('pausa mixta / contrato con nombre alternativo / entrega sin escalamiento y respeta duplicados', async (t) => {
  fixedRuntime(t);
  const catalog = [...invoices(), doc('agreement', 'CONTRATO', '2026-03', 'Acuerdo_Comercial.pdf')];
  const h = harness(catalog);
  await pendingInvoice(h);
  const first = await observe(t, h, mixed[4].text);
  assert.equal(first.reply.awaiting, 'NADIE');
  assert.deepEqual(h.state, empty());
  assert.deepEqual(h.searches.map((s) => [s.query.category, s.query.text, s.resultIds]), [
    ['CONTRATO', null, ['agreement']],
  ]);
  assert.deepEqual(h.deliveries.map((d) => d.id), ['agreement']);
  assert.deepEqual(h.escalations, []);
  h.clearTrace();
  const { reply } = await observe(t, h, mixed[4].text);
  assert.equal(reply.awaiting, 'CLIENTE');
  assert.deepEqual(h.escalations, []);
  assert.deepEqual(h.state, {
    ...empty(), category: 'CONTRATO', opciones: options(catalog.slice(-1)), updatedAt: NOW,
  });
  assert.deepEqual(h.llmCalls, []);
  assert.deepEqual(h.deliveries, []);

  const control = harness(catalog);
  await pendingInvoice(control);
  await control.handle('Necesito un contrato');
  assert.deepEqual(control.deliveries.map((d) => d.id), ['agreement']);
  assert.deepEqual(control.escalations, []);
});

for (const exhausted of [false, true]) {
  test(`cierre mixto / contrato previo / presupuesto ${exhausted ? 'agotado' : 'disponible'}`, async (t) => {
    fixedRuntime(t);
    const h = harness();
    await h.handle('Necesito la factura de febrero');
    const lastDelivery = h.lastDelivery;
    assert.equal(lastDelivery?.documentId, 'invoice-02');
    h.clearTrace();
    // Estado explícito para aislar el cierre de una petición de la MISMA categoría.
    const prior: Solicitud = {
      ...empty(), category: 'CONTRATO', period: '2026-01-01T00:00:00.000Z',
      folio: 'C999', organizationId: scope.organizationId, opciones: options(contracts().slice(0, 1)),
      preguntas: exhausted ? 3 : 1, preguntado: { detalle: true }, ultimaPregunta: 'detalle',
      fallos: 2, rechazados: ['contract-2'], updatedAt: NOW,
    };
    h.seed(prior);
    const { reply } = await observe(t, h, mixed[3].text);
    assert.deepEqual(h.events.slice(0, 2), ['close', 'slots.extract']);
    // cerrar() ya vació la solicitud: importa el estado efectivo, no que
    // el siguiente parche vuelva a escribir todos los campos de limpieza.
    assert.deepEqual(h.extractionStates, [empty()]);
    assert.deepEqual(h.savedStates[0], {
      ...empty(), category: 'CONTRATO', updatedAt: NOW,
    });
    assert.deepEqual(h.llmCalls, []);
    assert.deepEqual(h.deliveries, []);
    assert.equal(reply.awaiting, 'CLIENTE');
    assert.deepEqual(h.state, {
      ...empty(), category: 'CONTRATO', opciones: options(contracts()), updatedAt: NOW,
    });
    assert.deepEqual(h.escalations, []);
    assert.deepEqual(h.searches, [{
      query: { category: 'CONTRATO', period: null, folio: null, text: null,
        organizationId: scope.organizationId, excludeIds: [] },
      resultIds: ['contract-1', 'contract-2'],
    }]);
    assert.equal(h.events.filter((e) => e === 'close').length, 1);
    assert.deepEqual(h.lastDelivery, lastDelivery);

    // El cierre aislado sí limpia estos datos antes de pedir otro contrato.
    const control = harness();
    control.seed(prior);
    await control.handle('Es todo');
    assert.deepEqual(control.state, empty());
    await control.handle('Necesito un contrato');
    assert.deepEqual(control.escalations, []);
    assert.equal(control.state.opciones?.length, 2);
  });
}

for (const [text, category, keywords] of [
  ['Espera, mejor necesito un contrato de mantenimiento', 'CONTRATO', 'mantenimiento'],
  ['Espera, mejor necesito un reporte de espera', 'REPORTE', 'espera'],
  ['Necesito el reporte de espera', 'REPORTE', 'espera'],
  ['Necesito el contrato de mejor servicio', 'CONTRATO', 'mejor servicio'],
  ['Espera, mejor necesito ayuda', null, 'espera mejor'],
] as const) {
  test(`limpieza contextual conserva contenido documental / ${text}`, () => {
    assert.deepEqual(parseQuery(text), { category, period: null, folio: null, text: keywords });
  });
}

test('limpieza contextual respeta el nombre de archivo Espera_Mejor.pdf', () => {
  assert.deepEqual(parseQuery('Espera, mejor necesito el contrato Espera_Mejor.pdf'), {
    // nombreDeArchivo ya omite la extensión al construir la pista de búsqueda.
    category: 'CONTRATO', period: null, folio: null, text: 'Espera_Mejor',
  });
});

// Regresiones de variantes naturales: prefijos limpios y cierres sin herencia.
const naturalVariants = [
  { text: 'Con eso basta, ahora necesito una factura', category: 'FACTURA', month: null, closure: true },
  { text: 'Ya está, quiero un contrato', category: 'CONTRATO', month: null, closure: true },
  { text: 'Eso es todo, pero necesito la factura de marzo', category: 'FACTURA', month: '03', closure: true },
  { text: 'Espera, necesito un contrato', category: 'CONTRATO', month: null, closure: false },
  { text: 'Un momento, necesito una factura', category: 'FACTURA', month: null, closure: false },
  { text: 'Déjame ver, pero necesito el contrato', category: 'CONTRATO', month: null, closure: false },
  { text: 'Gracias, pero necesito una factura', category: 'FACTURA', month: null, closure: false },
  { text: 'Muchas gracias, ahora necesito un contrato', category: 'CONTRATO', month: null, closure: false },
  { text: 'Ok, ahora necesito un contrato', category: 'CONTRATO', month: null, closure: false },
  { text: 'Entendido, pero necesito la factura de febrero', category: 'FACTURA', month: '02', closure: false },
] as const;

for (const c of naturalVariants) {
  for (const previous of ['vacia', 'factura-pendiente'] as const) {
    test(`variante natural / ${previous} / ${c.text}`, async (t) => {
      fixedRuntime(t);
      const h = harness();
      if (previous === 'factura-pendiente') await pendingInvoice(h);
      const { reply, initial, parseQuery: query, flags } = await observe(t, h, c.text);
      assert.deepEqual(initial, { tipo: 'SOLICITUD', motivo: null, molesto: false, fuente: 'reglas' });
      assert.deepEqual(query, {
        category: c.category, period: c.month ? new Date(`2026-${c.month}-01T00:00:00.000Z`) : null,
        folio: null, text: null,
      });
      assert.deepEqual(flags, {
        esPausa: false, SALUDO: false, ACUSE: false, CIERRE: c.closure, datos: true,
      });
      assert.deepEqual(h.events.slice(0, c.closure ? 2 : 1),
        c.closure ? ['close', 'slots.extract'] : ['slots.extract']);
      assert.deepEqual(h.llmCalls, []);
      assert.deepEqual(h.extractionResults, [{
        query, companyHint: null, notADocumentRequest: false, tipoMensaje: null, source: 'reglas',
      }]);
      assert.deepEqual(h.searches.map((s) => s.query), [{
        ...query, organizationId: scope.organizationId, excludeIds: [],
      }]);
      if (c.month) {
        assert.equal(reply.text, '');
        assert.equal(reply.awaiting, 'NADIE');
        assert.deepEqual(h.deliveries.map((d) => d.id), [`invoice-${c.month}`]);
        assert.deepEqual(h.state, empty());
        assert.deepEqual(h.escalations, []);
        assert.ok(h.events.lastIndexOf('close') > h.events.indexOf('deliver'));
        assert.equal(h.events.filter((e) => e === 'close').length, c.closure ? 2 : 1);
      } else if (c.category === 'CONTRATO') {
        assert.equal(reply.awaiting, 'CLIENTE');
        assert.deepEqual(h.state, {
          ...empty(), category: 'CONTRATO', opciones: options(contracts()),
          updatedAt: NOW,
        });
        assert.match(reply.text, /CONTRATO_contract-1\.pdf/);
        assert.match(reply.text, /CONTRATO_contract-2\.pdf/);
        assert.deepEqual(h.deliveries, []);
        assert.deepEqual(h.escalations, []);
        assert.equal(h.events.includes('close'), c.closure);
      } else {
        // Control contextual: repetir una petición genérica de FACTURA con la
        // pregunta de periodo pendiente también escala sin prefijo social.
        // Solo los cierres abandonan esa solicitud antes de procesar la nueva.
        const control = harness();
        const retainsPending = previous === 'factura-pendiente' && !c.closure;
        if (retainsPending) await pendingInvoice(control);
        const plain = await control.handle('Necesito una factura');
        assert.deepEqual(reply, plain);
        assert.deepEqual(h.state, control.state);
        assert.deepEqual(h.escalations, control.escalations.map((e) => ({
          ...(e as Record<string, unknown>), subject: c.text,
        })));
        assert.deepEqual(h.deliveries, []);
        assert.equal(reply.awaiting, retainsPending ? 'AGENTE' : 'CLIENTE');
      }
    });
  }

  test(`variante natural conserva categoría, mes y folio / ${c.text}`, async (t) => {
    fixedRuntime(t);
    const text = `${c.text}, folio V3001`;
    const query = parseQuery(text);
    assert.deepEqual(query, {
      category: c.category, period: c.month ? new Date(`2026-${c.month}-01T00:00:00.000Z`) : null,
      folio: 'V3001', text: null,
    });
    const slots = new SlotExtractorService({
      extract: async () => assert.fail('El folio explícito no necesita LLM'),
      draft: async () => assert.fail('No debe invocarse redactor'),
    });
    const result = await slots.extract(text);
    assert.deepEqual(result.query, query);
    assert.equal(result.source, 'reglas');
    assert.equal(result.notADocumentRequest, false);
  });

  if (c.closure) {
    for (const previousCategory of ['FACTURA', 'CONTRATO'] as const) {
      test(`variante de cierre / antes ${previousCategory}, presupuesto agotado / ${c.text}`, async (t) => {
        fixedRuntime(t);
        const h = harness();
        await h.handle('Necesito la factura de febrero');
        const lastDelivery = h.lastDelivery;
        assert.equal(lastDelivery?.documentId, 'invoice-02');
        h.clearTrace();
        const prior: Solicitud = {
          ...empty(), category: previousCategory, period: '2026-01-01T00:00:00.000Z',
          folio: 'C999', opciones: options([doc('old-document', previousCategory, '2026-01')]), preguntas: 3,
          organizationId: scope.organizationId, fallos: 2,
          preguntado: { categoria: true, periodo: true, detalle: true }, ultimaPregunta: 'detalle',
          rechazados: ['old-document'], updatedAt: NOW,
        };
        h.seed(prior);
        const { reply } = await observe(t, h, c.text);
        const freshPeriod = c.month ? `2026-${c.month}-01T00:00:00.000Z` : null;
        const freshQuery = { category: c.category, period: freshPeriod ? new Date(freshPeriod) : null, folio: null, text: null };
        assert.deepEqual(h.events.slice(0, 2), ['close', 'slots.extract']);
        assert.deepEqual(h.extractionStates, [empty()]);
        assert.deepEqual(h.savedStates[0], {
          ...empty(), category: c.category, period: freshPeriod, updatedAt: NOW,
        });
        assert.deepEqual(h.searches.map((s) => s.query), [{
          ...freshQuery, organizationId: scope.organizationId, excludeIds: [],
        }]);
        assert.deepEqual(h.llmCalls, []);
        assert.deepEqual(h.escalations, []);
        if (c.month) {
          assert.equal(reply.awaiting, 'NADIE');
          assert.deepEqual(h.state, empty());
          assert.deepEqual(h.deliveries.map((d) => d.id), ['invoice-03']);
          assert.equal(h.lastDelivery?.documentId, 'invoice-03');
        } else {
          assert.equal(reply.awaiting, 'CLIENTE');
          assert.deepEqual(h.deliveries, []);
          assert.deepEqual(h.lastDelivery, lastDelivery);
          assert.deepEqual(h.state, c.category === 'FACTURA' ? {
            ...empty(), category: 'FACTURA', preguntas: 1, preguntado: { periodo: true },
            ultimaPregunta: 'periodo', updatedAt: NOW,
          } : { ...empty(), category: 'CONTRATO', opciones: options(contracts()), updatedAt: NOW });
        }

        // Un folio NUEVO debe llegar a búsqueda/entrega, no solo al parser.
        const newDocument = { ...doc('new-folio', c.category, '2026-03'), folio: 'V3001' };
        const byFolio = harness([newDocument]);
        byFolio.seed(prior);
        const delivered = await byFolio.handle(`${c.text}, folio V3001`);
        assert.deepEqual(byFolio.events.slice(0, 2), ['close', 'slots.extract']);
        assert.deepEqual(byFolio.searches.map((s) => s.query), [{
          ...freshQuery, folio: 'V3001', organizationId: scope.organizationId, excludeIds: [],
        }]);
        assert.equal(delivered?.awaiting, 'NADIE');
        assert.deepEqual(byFolio.deliveries.map((d) => d.id), ['new-folio']);
        assert.deepEqual(byFolio.escalations, []);
        assert.deepEqual(byFolio.llmCalls, []);
        assert.deepEqual(byFolio.state, empty());
      });
    }
  }
}

for (const [text, category, keywords] of [
  ['Un momento, pero ahora mejor necesito un contrato de mejor servicio', 'CONTRATO', 'mejor servicio'],
  ['Dame un segundo, ahora necesito un contrato', 'CONTRATO', null],
  ['Entendido, necesito el reporte de espera', 'REPORTE', 'espera'],
  ['Con eso basta, pero ahora necesito el contrato de mantenimiento', 'CONTRATO', 'mantenimiento'],
  ['Espera, necesito ayuda', null, 'espera'],
  ['Necesito el contrato entendido', 'CONTRATO', 'entendido'],
  ['Necesito el reporte de un momento', 'REPORTE', 'momento'],
  ['Necesito el reporte muchas gracias', 'REPORTE', 'muchas'],
] as const) {
  test(`prefijos generales conservan contenido y exigen slots / ${text}`, () => {
    assert.deepEqual(parseQuery(text), { category, period: null, folio: null, text: keywords });
  });
}

test('un cierre citado dentro del contenido no abandona la solicitud', async (t) => {
  fixedRuntime(t);
  const h = harness();
  h.seed({
    ...empty(), category: 'CONTRATO', period: '2026-01-01T00:00:00.000Z',
    folio: 'C999', updatedAt: NOW,
  });
  await h.handle('El contrato dice "es todo", pero necesito el contrato');
  assert.equal(h.events[0], 'slots.extract');
  assert.equal(h.events.includes('close'), false);
  assert.deepEqual(h.saves[0], {
    category: 'CONTRATO', period: '2026-01-01T00:00:00.000Z', folio: 'C999',
  });
});

test('cierre inicial con petición explícita usa la estructura, no amplía CIERRE', () => {
  const text = 'Ya está, quiero un contrato';
  assert.equal(CIERRE.test(normalizar(text)), false);
  assert.equal(esCierre(text), false);
  assert.deepEqual(separarPeticionMixta(text), {
    marcador: 'CIERRE', peticion: 'quiero un contrato',
  });
  for (const question of [
    '¿ya está?', 'ya está?', 'nada más quería saber si ya está',
    '¿ya está?, quiero un contrato', 'ya está? quiero un contrato',
    'nada más quería saber si ya está, quiero un contrato',
  ]) {
    assert.equal(esCierre(question), false, question);
    assert.equal(separarPeticionMixta(question), null, question);
  }
});

test('"nada más" pegado al pedido es "solo", no un cierre', () => {
  assert.equal(separarPeticionMixta('Nada más quiero la de marzo')?.marcador ?? null, null);
  assert.equal(separarPeticionMixta('nada mas necesito la factura de marzo')?.marcador ?? null, null);
  // Separado, sí cierra.
  assert.equal(separarPeticionMixta('Nada más, ahora quiero un contrato')?.marcador, 'CIERRE');
  assert.equal(separarPeticionMixta('Es todo ahora necesito un contrato')?.marcador, 'CIERRE');
});

test('"Nada más quiero la de marzo" con una factura pendiente conserva la factura', async (t) => {
  fixedRuntime(t);
  const h = harness();
  h.seed({ ...empty(), category: 'FACTURA', ultimaPregunta: 'periodo', preguntas: 1, updatedAt: NOW });
  await h.handle('Nada más quiero la de marzo');
  // Cerrar solo al entregar, nunca antes de buscar (eso sería abandonarla).
  assert.ok(h.events.indexOf('close') === -1 || h.events.indexOf('close') > h.events.indexOf('search'));
  assert.equal(h.saves[0]?.category, 'FACTURA');
  assert.equal(h.saves[0]?.period, '2026-03-01T00:00:00.000Z');
  assert.deepEqual(h.deliveries.map((d) => d.id), ['invoice-03']);
});

test('una pregunta inicial seguida de petición no abandona la solicitud anterior', async (t) => {
  fixedRuntime(t);
  const h = harness();
  const prior: Solicitud = {
    ...empty(), category: 'CONTRATO', period: '2026-01-01T00:00:00.000Z',
    folio: 'C999', updatedAt: NOW,
  };
  h.seed(prior);
  await h.handle('¿Ya está?, quiero un contrato');
  assert.equal(h.events.includes('close'), false);
  assert.deepEqual(h.extractionStates, [prior]);
  assert.deepEqual(h.saves[0], {
    category: 'CONTRATO', period: prior.period, folio: prior.folio,
  });
});

test('dividirPedidos separa el prefijo mixto y conserva listas, rangos y contenido documental', () => {
  const prefixes = ['Espera, mejor', 'Con eso basta, ahora', 'Ya está,', 'Gracias, pero', 'Ok, ahora'];
  const requests = [
    'necesito las facturas de enero y marzo de 2026',
    'necesito facturas y contratos de marzo de 2026',
    'necesito las facturas de enero a marzo de 2026',
    'necesito los reportes de espera y los contratos de mejor servicio',
    'necesito los contratos Espera_Mejor.pdf y Servicio.pdf',
  ];
  for (const request of requests) {
    const plain = dividirPedidos(request);
    assert.ok(plain && plain.pedidos.length >= 2, request);
    for (const prefix of prefixes) {
      const text = `${prefix} ${request}`;
      assert.deepEqual(dividirPedidos(text), plain, text);
    }
  }
  for (const request of [
    'necesito un contrato', 'necesito un reporte de espera',
    'necesito el contrato de mejor servicio', 'necesito el contrato Espera_Mejor.pdf',
  ]) {
    assert.equal(dividirPedidos(`Espera, mejor ${request}`), null, request);
  }
  assert.deepEqual(dividirPedidos(requests[3]!)?.pedidos.map((p) => p.text), ['espera', 'mejor servicio']);
});

test('los prefijos mixtos permiten entregar varios documentos en el mismo turno', async (t) => {
  fixedRuntime(t);
  for (const [prefix, closure] of [
    ['Espera, mejor', false], ['Gracias, ahora', false], ['Ok, pero', false],
    ['Es todo, ahora', true], ['Con eso basta, ahora', true],
    ['Ya está,', true], ['Eso es todo, pero', true],
  ] as const) {
    const h = harness();
    await h.handle('Necesito la factura de febrero');
    const lastDelivery = h.lastDelivery;
    if (closure) {
      h.seed({
        ...empty(), category: 'CONTRATO', period: '2026-02-01T00:00:00.000Z', folio: 'C999',
        preguntas: 3, fallos: 2, preguntado: { detalle: true }, ultimaPregunta: 'detalle',
        opciones: options(contracts()), rechazados: ['invoice-01'], lote: 'pedido anterior', updatedAt: NOW,
      });
    }
    h.clearTrace();
    const reply = await h.handle(`${prefix} necesito las facturas de enero y marzo de 2026`);
    assert.equal(h.events[0], closure ? 'close' : 'search', prefix);
    assert.deepEqual(h.searches.map((s) => s.query), ['01', '03'].map((month) => ({
      category: 'FACTURA', period: new Date(`2026-${month}-01T00:00:00.000Z`),
      folio: null, text: null, organizationId: scope.organizationId, excludeIds: [],
    })), prefix);
    assert.deepEqual(h.deliveries.map((d) => d.id), ['invoice-01', 'invoice-03'], prefix);
    assert.equal(lastDelivery?.documentId, 'invoice-02');
    assert.equal(h.lastDelivery?.documentId, 'invoice-03');
    assert.equal(reply?.awaiting, 'NADIE');
    assert.deepEqual(h.state, empty());
    assert.deepEqual(h.escalations, []);
    assert.deepEqual(h.llmCalls, []);
    assert.deepEqual(h.extractionResults, []);
  }
});
