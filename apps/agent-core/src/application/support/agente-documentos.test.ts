import assert from 'node:assert/strict';
import test from 'node:test';
import type { LlmPort } from '../ports/llm.port';
import { AgenteDocumentosService, type TurnoAgente } from './agente-documentos.service';

const scope = { organizationId: 'alan', organizationName: 'ALAN', windows: [], strippedByVerification: [] };

function doc(id: string, name: string, period = '2026-09') {
  return { id, name, category: 'OTRO', period: new Date(`${period}-01T00:00:00Z`), summary: null, counterpart: null };
}

const CATALOGO = [
  doc('a1', 'CONSTANCIA DE ALTA ABNER GARCIA.pdf'),
  doc('a2', 'CONSTANCIA DE ALTA RAYMUNDO VAZQUEZ.pdf'),
  doc('b1', 'CONSTANCIA DE BAJA KEVIN RIZO.pdf'),
];

/** Un modelo de mentira: corre un guion de herramientas y contesta lo que el guion diga. */
function armar(guion: (ejecutar: (n: string, e: Record<string, unknown>) => Promise<string>) => Promise<string | null>, opciones: { kind?: string; permitidos?: string[] } = {}) {
  const entregados: string[] = [];
  let guardado: unknown = null;
  const llm = {
    extract: async () => null,
    draft: async () => null,
    agente: async (input: Parameters<NonNullable<LlmPort['agente']>>[0]) => guion(input.ejecutar),
  } as unknown as LlmPort;
  const permitidos = new Set(opciones.permitidos ?? CATALOGO.map((d) => d.id));
  const servicio = new AgenteDocumentosService(
    { organization: { count: async () => (opciones.kind === 'EMPRESA' ? 0 : 1) } } as never,
    llm,
    {
      search: async (_s: unknown, q: { text: string | null }) =>
        CATALOGO.filter((d) => !q.text || q.text.split(' ').every((p) => d.name.toLowerCase().includes(p.toLowerCase()))),
      count: async (_s: unknown, q: { text: string | null }) =>
        CATALOGO.filter((d) => !q.text || q.text.split(' ').every((p) => d.name.toLowerCase().includes(p.toLowerCase()))).length,
      inventario: async () => [],
      byId: async (id: string) => (permitidos.has(id) ? CATALOGO.find((d) => d.id === id) ?? null : null),
    } as never,
    { deliver: async (_d: unknown, d: { id: string }) => { entregados.push(d.id); return { ok: true }; } } as never,
    {
      actual: async () => ({ opciones: [] }),
      guardar: async (_c: string, p: unknown) => { guardado = p; return p; },
      registrarEntrega: async () => undefined,
    } as never,
    { abrirEscalado: async () => ({ ticket: { number: 7 }, agente: null }) } as never,
  );
  const turno: TurnoAgente = {
    chatId: 'chat', waId: 'wa', mensajeId: 'm1', texto: 'dame las altas', conversationId: 'c', contactId: 'k',
    scopes: [scope], history: [],
  };
  return { servicio, turno, entregados, guardado: () => guardado };
}

test('busca, entrega lo encontrado y recuerda la lista numerada', async () => {
  const h = armar(async (ejecutar) => {
    const r = JSON.parse(await ejecutar('buscar_documentos', { texto: 'alta', tipo: null, mes: null }));
    assert.equal(r.total, 2);
    const refs = r.documentos.map((d: { ref: number }) => d.ref);
    const salida = await ejecutar('entregar_documentos', { refs });
    assert.match(salida, /en camino/);
    return 'Te mandé las 2 constancias de alta.';
  });
  const texto = await h.servicio.atender(h.turno);
  assert.equal(texto, 'Te mandé las 2 constancias de alta.');
  assert.deepEqual(h.entregados, ['a1', 'a2']);
  assert.equal((h.guardado() as { opciones: unknown[] }).opciones.length, 2);
});

test('no entrega refs inventadas ni documentos fuera de su permiso', async () => {
  const h = armar(async (ejecutar) => {
    assert.match(await ejecutar('entregar_documentos', { refs: [99] }), /no existe/);
    const r = JSON.parse(await ejecutar('buscar_documentos', { texto: 'baja', tipo: null, mes: null }));
    assert.match(await ejecutar('entregar_documentos', { refs: [r.documentos[0].ref] }), /ya no está disponible/);
    return 'No lo encontré.';
  }, { permitidos: ['a1', 'a2'] });
  await h.servicio.atender(h.turno);
  assert.deepEqual(h.entregados, []);
});

test('solo aplica a clientes PERSONA por omisión', async () => {
  delete process.env.AGENTE_AUTONOMO;
  assert.equal(await armar(async () => 'x').servicio.aplica([scope]), true);
  assert.equal(await armar(async () => 'x', { kind: 'EMPRESA' }).servicio.aplica([scope]), false);
  process.env.AGENTE_AUTONOMO = 'off';
  assert.equal(await armar(async () => 'x').servicio.aplica([scope]), false);
  delete process.env.AGENTE_AUTONOMO;
});

test('sin respuesta del modelo devuelve null para que siga el flujo de reglas', async () => {
  const h = armar(async () => null);
  assert.equal(await h.servicio.atender(h.turno), null);
});

test('cada búsqueda numera desde 1 y solo valen las refs de la última', async () => {
  const h = armar(async (ejecutar) => {
    const altas = JSON.parse(await ejecutar('buscar_documentos', { texto: 'alta', tipo: null, mes: null }));
    assert.deepEqual(altas.documentos.map((d: { ref: number }) => d.ref), [1, 2]);
    const bajas = JSON.parse(await ejecutar('buscar_documentos', { texto: 'baja', tipo: null, mes: null }));
    assert.deepEqual(bajas.documentos.map((d: { ref: number }) => d.ref), [1]);
    assert.match(await ejecutar('entregar_documentos', { refs: [2] }), /no existe/);
    await ejecutar('entregar_documentos', { refs: [1] });
    return 'Listo.';
  });
  await h.servicio.atender(h.turno);
  assert.deepEqual(h.entregados, ['b1']);
});
