import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { ErrorPac, type CfdiNuevo, type CredencialesPac } from '../../application/ports/facturacion.port';
import { FacturaComAdapter, limpiarMensaje } from './factura-com.adapter';
import { cifrar, descifrar } from './secretos';

// ── Secretos ──────────────────────────────────────────────────────────

test('secretos: cifra y descifra, y detecta alteraciones', () => {
  const k = randomBytes(32).toString('hex');
  const c = cifrar('mi-api-key', k);
  assert.notEqual(c, 'mi-api-key');
  assert.equal(descifrar(c, k), 'mi-api-key');
  assert.throws(() => descifrar(c, randomBytes(32).toString('hex')));
  const partes = c.split(':');
  partes[3] = Buffer.from('otra cosa').toString('base64');
  assert.throws(() => descifrar(partes.join(':'), k));
  assert.throws(() => cifrar('x', 'corta'));
});

// ── Adaptador, contra respuestas con la forma de la documentación ─────

const cred: CredencialesPac = { apiKey: 'k', secretKey: 's', sandbox: true };
const cfdi: CfdiNuevo = {
  receptor: { rfc: 'XIA190128J61', nombre: 'XENON INDUSTRIAL ARTICLES', codigoPostal: '76343', regimen: '601', usoCfdi: 'G03' },
  conceptos: [],
  serieId: 17317,
  formaPago: '03',
  metodoPago: 'PUE',
  referencia: 'inv_1',
  emailRespaldo: 'empresa@example.com',
};

interface Llamada { url: string; metodo: string; body: unknown; headers: Record<string, string> }

function simular(respuestas: Array<{ status?: number; json: unknown }>): Llamada[] {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    llamadas.push({
      url,
      metodo: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string>,
    });
    const r = respuestas.shift();
    if (!r) throw new Error('llamada no esperada a ' + url);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return llamadas;
}

test('timbrar: crea al cliente si no existe y manda el CFDI con su UID', async () => {
  const llamadas = simular([
    { json: { status: 'error', message: 'Cliente no encontrado' } },
    { json: { status: 'success', Data: { UID: 'cli_1', RFC: 'XIA190128J61' } } },
    {
      json: {
        response: 'success', UUID: 'aaaa-bbbb', uid: 'fc_1',
        SAT: { UUID: 'aaaa-bbbb', FechaTimbrado: '2026-10-05T12:00:00' }, INV: { Serie: 'F', Folio: 12 },
      },
    },
  ]);
  const r = await new FacturaComAdapter().timbrar(cred, cfdi);
  assert.deepEqual(r, { uidProveedor: 'fc_1', uuid: 'aaaa-bbbb', serie: 'F', folio: '12', fechaTimbrado: '2026-10-05T12:00:00' });

  assert.equal(llamadas[0]!.url, 'https://sandbox.factura.com/api/v1/clients/XIA190128J61');
  assert.equal(llamadas[1]!.url, 'https://sandbox.factura.com/api/v1/clients/create');
  assert.equal(llamadas[2]!.url, 'https://sandbox.factura.com/api/v4/cfdi40/create');
  const body = llamadas[2]!.body as Record<string, unknown>;
  assert.deepEqual(body.Receptor, { UID: 'cli_1' });
  assert.equal(body.Serie, 17317);
  assert.equal(body.NumOrder, 'inv_1');
  assert.equal(llamadas[2]!.headers['F-Api-Key'], 'k');
  assert.equal(llamadas[2]!.headers['F-PLUGIN'], '9d4095c8f7ed5785cb14c0e3b033eeb8252416ed');
});

test('timbrar: cliente existente con los mismos datos no se toca', async () => {
  const llamadas = simular([
    {
      json: {
        status: 'success',
        Data: { UID: 'cli_1', RFC: 'XIA190128J61', RazonSocial: 'XENON INDUSTRIAL ARTICLES', CodigoPostal: '76343', RegimenId: '601', UsoCFDI: 'G03' },
      },
    },
    { json: { response: 'success', UUID: 'u', uid: 'fc' } },
  ]);
  await new FacturaComAdapter().timbrar(cred, cfdi);
  assert.equal(llamadas.length, 2);
});

test('timbrar: cliente con otro régimen se actualiza antes', async () => {
  const llamadas = simular([
    { json: { status: 'success', Data: { UID: 'cli_1', RazonSocial: 'XENON INDUSTRIAL ARTICLES', CodigoPostal: '76343', RegimenId: '626', UsoCFDI: 'G03' } } },
    { json: { status: 'success', Data: { UID: 'cli_1' } } },
    { json: { response: 'success', UUID: 'u', uid: 'fc' } },
  ]);
  await new FacturaComAdapter().timbrar(cred, cfdi);
  assert.equal(llamadas[1]!.url, 'https://sandbox.factura.com/api/v1/clients/cli_1/update');
});

test('timbrar: el rechazo del SAT es definitivo y trae el mensaje', async () => {
  simular([
    { json: { status: 'success', Data: { UID: 'c', RazonSocial: 'XENON INDUSTRIAL ARTICLES', CodigoPostal: '76343', RegimenId: '601', UsoCFDI: 'G03' } } },
    { json: { response: 'error', message: { message: 'CFDI40145 - El nombre no coincide', messageDetail: 'Receptor:Nombre' } } },
  ]);
  await assert.rejects(new FacturaComAdapter().timbrar(cred, cfdi), (e: unknown) =>
    e instanceof ErrorPac && e.definitivo && /CFDI40145/.test(e.message));
});

test('timbrar: si la red falla al crear, NO es definitivo (pudo timbrarse)', async () => {
  let n = 0;
  globalThis.fetch = (async () => {
    if (n++ === 0) {
      return new Response(JSON.stringify({ status: 'success', Data: { UID: 'c', RazonSocial: 'XENON INDUSTRIAL ARTICLES', CodigoPostal: '76343', RegimenId: '601', UsoCFDI: 'G03' } }));
    }
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(new FacturaComAdapter().timbrar(cred, cfdi), (e: unknown) => e instanceof ErrorPac && !e.definitivo);
});

test('series y producción', async () => {
  const llamadas = simular([
    { json: { status: 'success', data: [{ SerieID: 19843, SerieName: 'R', SerieType: 'factura', SerieStatus: 'Activa' }] } },
  ]);
  const s = await new FacturaComAdapter().series({ ...cred, sandbox: false });
  assert.deepEqual(s, [{ id: 19843, nombre: 'R', tipo: 'factura', activa: true }]);
  assert.equal(llamadas[0]!.url, 'https://api.factura.com/v4/series');
});

test('timbrar: sin correo del cliente ni de la empresa no se intenta', async () => {
  const llamadas = simular([]);
  await assert.rejects(new FacturaComAdapter().timbrar(cred, { ...cfdi, emailRespaldo: null }), /pide un correo/);
  assert.equal(llamadas.length, 0);
});

test('errores por campo de Factura.com se leen', async () => {
  simular([
    { json: { status: 'error', message: 'El cliente no existe' } },
    { json: { status: 'error', message: { email: ['El campo email es requerido'] } } },
  ]);
  await assert.rejects(new FacturaComAdapter().timbrar(cred, cfdi), /El campo email es requerido/);
});

test('mensajes de Factura.com sin HTML ni acentos rotos', () => {
  assert.equal(
    limpiarMensaje('<strong>No puedes facturar 2</strong>, necesitas agregar los archivos de facturaciÃ³n'),
    'No puedes facturar 2, necesitas agregar los archivos de facturación',
  );
  assert.equal(limpiarMensaje('El código postal no coincide'), 'El código postal no coincide');
});

test('llaves inválidas se dicen claro', async () => {
  simular([{ status: 401, json: { status: 'error', message: 'unauthorized' } }]);
  await assert.rejects(new FacturaComAdapter().series(cred), /llaves de Factura.com no son válidas/);
});
