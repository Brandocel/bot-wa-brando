import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clasificar,
  estrategiaParaModelo,
  leerSentimiento,
  proximaAccion,
  type EntradaClasificacion,
} from './inteligencia-cliente';

const AHORA = new Date('2026-10-22T18:00:00Z');
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 24 * 3600 * 1000);

function base(extra: Partial<EntradaClasificacion> = {}): EntradaClasificacion {
  return {
    etapa: 'COMPRADOR', pedidos: 0, ultimoPedidoAt: null, ticketPromedioCents: 0, ticketEmpresaCents: null,
    ultimoScore: null, sentimiento: null, reclamoReciente: false, ahora: AHORA, ...extra,
  };
}

test('sentimiento: promedio, tendencia y emoción dominante', () => {
  const mejora = leerSentimiento([
    ...['frustrado', 'molesto', 'indeciso'].map((e, i) => ({ emocion: e, intensidad: 2, at: hace(10 - i) })),
    ...['interesado', 'entusiasmado', 'entusiasmado'].map((e, i) => ({ emocion: e, intensidad: 2, at: hace(3 - i) })),
  ])!;
  assert.equal(mejora.tendencia, 'mejora');
  assert.equal(mejora.dominante, 'entusiasmado');
  assert.ok(mejora.valor > 0, 'lo reciente pesa más');
  assert.equal(leerSentimiento([]), null);
});

test('prospectos: nuevo, caliente, frío y con reclamo', () => {
  assert.equal(clasificar(base({ etapa: 'NUEVO' })).segmento, 'NUEVO');
  assert.equal(clasificar(base({ etapa: 'PROSPECTO', ultimoScore: 75 })).segmento, 'PROSPECTO_CALIENTE');
  assert.equal(clasificar(base({ etapa: 'PROSPECTO', ultimoScore: 10 })).segmento, 'PROSPECTO_FRIO');
  assert.equal(clasificar(base({ etapa: 'PROSPECTO', ultimoScore: 75, reclamoReciente: true })).segmento, 'NECESITA_ATENCION');
});

test('compradores: VIP, leal, primera compra, en riesgo y perdido', () => {
  const vip = clasificar(base({ pedidos: 12, ultimoPedidoAt: hace(3), ticketPromedioCents: 60000, ticketEmpresaCents: 30000 }));
  assert.equal(vip.segmento, 'VIP');
  assert.equal(vip.rfm, 'R5F5M5');
  assert.ok(vip.puntaje >= 85);

  assert.equal(clasificar(base({ pedidos: 4, ultimoPedidoAt: hace(20), ticketPromedioCents: 30000 })).segmento, 'LEAL');
  assert.equal(clasificar(base({ pedidos: 1, ultimoPedidoAt: hace(2) })).segmento, 'PRIMERA_COMPRA');
  assert.equal(clasificar(base({ pedidos: 5, ultimoPedidoAt: hace(45) })).segmento, 'EN_RIESGO');
  assert.equal(clasificar(base({ pedidos: 5, ultimoPedidoAt: hace(120) })).segmento, 'PERDIDO');
  assert.equal(
    clasificar(base({ pedidos: 5, ultimoPedidoAt: hace(3), sentimiento: { valor: -70, tendencia: 'empeora', dominante: 'molesto' } })).segmento,
    'NECESITA_ATENCION',
  );
});

test('en frío (sin ticket de la empresa) el monto cuenta como normal', () => {
  assert.match(clasificar(base({ pedidos: 2, ultimoPedidoAt: hace(5), ticketPromedioCents: 99999 })).rfm!, /M3$/);
});

test('postventa: preguntar cómo le fue, recompra y retomar', () => {
  const entregado = proximaAccion({
    segmento: 'LEAL', pedidos: 4, ultimoPedidoAt: hace(1), frecuenciaDias: 7, favorito: 'Pollo',
    ultimoEvento: { tipo: 'pedido_entregado', at: hace(1), numero: 1042 }, ahora: AHORA,
  })!;
  assert.match(entregado.texto, /cómo le fue con P-1042/);

  const recompra = proximaAccion({
    segmento: 'LEAL', pedidos: 4, ultimoPedidoAt: hace(5), frecuenciaDias: 7, favorito: 'Pollo',
    ultimoEvento: { tipo: 'pedido_entregado', at: hace(5) }, ahora: AHORA,
  })!;
  assert.match(recompra.texto, /ofrecer Pollo/);
  assert.equal(recompra.at.getTime(), hace(-2).getTime());

  const retomar = proximaAccion({
    segmento: 'PROSPECTO', pedidos: 0, ultimoPedidoAt: null, frecuenciaDias: null, favorito: null,
    ultimoEvento: { tipo: 'pedido_armando', at: hace(1) }, ahora: AHORA,
  })!;
  assert.match(retomar.texto, /a medias/);
});

test('estrategia: el clima tenso pide cuidar el tono', () => {
  const t = estrategiaParaModelo('EN_RIESGO', { valor: -50, tendencia: 'empeora', dominante: 'frustrado' });
  assert.match(t, /bienvenida de vuelta/);
  assert.match(t, /tenso/);
  assert.match(t, /cuida el tono/);
});
