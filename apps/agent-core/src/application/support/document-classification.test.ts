import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { decidir, porReglas, type ArchivoAClasificar } from './document-classification';
import { parseDocumentContent } from './document-content.parser';
import { parseDocumentName } from './document-name.parser';
import { contenidoSensible, esSensible } from './document-safety';
import { MIME_DOCX, MIME_XLSX, textoDeOffice } from './office-text';
import { parseQuery } from './query-parser';

// ── Reglas duras ────────────────────────────────────────────────────────

for (const ruta of [
  'credenciales.txt',
  'Escritorio/Contraseñas banco.xlsx',
  'proyecto/.env',
  'proyecto/.env.production',
  'api_key.txt',
  'ssl/csr_dominio.txt',
  'llaves/servidor.pem',
  'Accesos/passwords.csv',
  'Credenciales/portal.pdf',
]) {
  test(`"${ruta}" es sensible por nombre`, () => {
    assert.equal(esSensible(ruta), true);
  });
}

for (const ruta of [
  'Facturas/FACTURA_2026-02_A1234.pdf',
  'Secretaria de Hacienda/declaracion_anual.pdf',
  'Cotizacion_Vega_2026.pdf',
  'Contabilidad/balanza_junio.xlsx',
  'environment/plano.pdf',
]) {
  test(`"${ruta}" no es sensible por nombre`, () => {
    assert.equal(esSensible(ruta), false);
  });
}

test('el contenido con llaves o contraseñas es sensible', () => {
  assert.equal(contenidoSensible('-----begin rsa private key----- miib...'), true);
  assert.equal(contenidoSensible('-----begin certificate request----- miic'), true);
  assert.equal(contenidoSensible('usuario: admin password: hunter22'), true);
  assert.equal(contenidoSensible('database_url=postgresql://bot:s3cr3t0@db.render.com/botwa'), true);
  assert.equal(contenidoSensible('anthropic sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
});

test('un documento normal no es sensible por contenido', () => {
  assert.equal(contenidoSensible('cotizacion folio a1234 fecha 12 de junio de 2026 total $15,000'), false);
  assert.equal(contenidoSensible('visita https://www.constructoravega.mx para mas informacion'), false);
  assert.equal(contenidoSensible(''), false);
});

// ── Office ──────────────────────────────────────────────────────────────

/** ZIP mínimo (deflate) con las partes dadas, como los que escribe Office. */
function zip(partes: Record<string, string>): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(partes)) {
    const datos = Buffer.from(contenido, 'utf8');
    const comprimido = deflateRawSync(datos);
    const n = Buffer.from(nombre, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(n.length, 26);
    locales.push(local, n, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, n);

    offset += 30 + n.length + comprimido.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(partes).length, 8);
  fin.writeUInt16LE(Object.keys(partes).length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

test('lee el texto de un Excel: hojas, celdas compartidas y números', () => {
  const xlsx = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Balanza junio" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml':
      '<sst><si><t>Cuenta</t></si><si><t>Saldo</t></si><si><r><t>Bancos </t></r><r><t>BBVA</t></r></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>15000.5</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Total &amp; cierre</t></is></c></row>' +
      '</sheetData></worksheet>',
  });

  assert.equal(
    textoDeOffice(xlsx, MIME_XLSX),
    '[hoja] Balanza junio\nCuenta | Saldo\nBancos BBVA | 15000.5\nTotal & cierre',
  );
});

test('lee el texto de un Word, un párrafo por línea', () => {
  const docx = zip({
    'word/document.xml':
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>COTIZACIÓN</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Folio: </w:t></w:r><w:r><w:t>A-1234</w:t></w:r></w:p>' +
      '</w:body></w:document>',
  });

  assert.equal(textoDeOffice(docx, MIME_DOCX), 'COTIZACIÓN\nFolio: A-1234');
});

test('un archivo que no es ZIP no rompe nada', () => {
  assert.equal(textoDeOffice(Buffer.from('no soy un zip'), MIME_XLSX), null);
});

// ── Decisión ────────────────────────────────────────────────────────────

function archivo(parcial: Partial<ArchivoAClasificar>): ArchivoAClasificar {
  return {
    name: 'archivo.pdf',
    folderPath: [],
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    texto: '',
    organizacion: 'Constructora Vega',
    ...parcial,
  };
}

const respuesta = {
  clase: 'ENTREGABLE' as const,
  confianza: 'alta' as const,
  tipo: 'COTIZACION' as const,
  periodo: '2026-06',
  folio: 'A1234',
  contraparte: 'Grupo Pérez',
  resumen: 'Cotización de obra negra para Grupo Pérez.',
  motivo: 'documento comercial del cliente',
};

test('el modelo seguro de que es del cliente: entregable, con sus datos', () => {
  const c = decidir(archivo({ name: 'cot.pdf' }), respuesta);
  assert.equal(c.clase, 'ENTREGABLE');
  assert.equal(c.categoria, 'COTIZACION');
  assert.deepEqual(c.periodo, new Date(Date.UTC(2026, 5, 1)));
  assert.equal(c.contraparte, 'Grupo Pérez');
});

test('sin confianza alta, lo decide una persona', () => {
  assert.equal(decidir(archivo({}), { ...respuesta, confianza: 'media' }).clase, 'DUDOSO');
  assert.equal(decidir(archivo({}), { ...respuesta, clase: 'INTERNO', confianza: 'baja' }).clase, 'DUDOSO');
});

test('interno con confianza alta queda fuera', () => {
  const c = decidir(archivo({ name: 'server-error.txt', mimeType: 'text/plain' }), {
    ...respuesta,
    clase: 'INTERNO',
    tipo: 'OTRO',
  });
  assert.equal(c.clase, 'INTERNO');
  assert.equal(c.categoria, null);
});

test('si el nombre dice factura y el modelo dice interno, va a revisión', () => {
  const c = decidir(archivo({ name: 'FACTURA_2026-02.pdf' }), { ...respuesta, clase: 'INTERNO' });
  assert.equal(c.clase, 'DUDOSO');
});

test('lo sensible gana siempre y no guarda resumen', () => {
  const c = decidir(archivo({}), { ...respuesta, clase: 'SENSIBLE', confianza: 'baja' });
  assert.equal(c.clase, 'SENSIBLE');
  assert.equal(c.resumen, null);
  assert.equal(c.contraparte, null);
});

test('"NINGUNO" no es un folio ni un periodo', () => {
  const c = decidir(archivo({}), { ...respuesta, folio: 'NINGUNO', periodo: 'NINGUNO', contraparte: 'NINGUNA' });
  assert.equal(c.folio, null);
  assert.equal(c.periodo, null);
  assert.equal(c.contraparte, null);
});

test('sin modelo: lo reconocible se entrega, lo demás va a revisión', () => {
  assert.equal(porReglas(archivo({ name: 'FACTURA_2026-02_A1234.pdf' })).clase, 'ENTREGABLE');
  assert.equal(porReglas(archivo({ name: 'x.pdf', texto: 'cotizacion folio 88' })).clase, 'ENTREGABLE');
  assert.equal(porReglas(archivo({ name: 'logo-header.png', mimeType: 'image/png' })).clase, 'DUDOSO');
});

// ── Categorías nuevas: índice y consulta tienen que coincidir ───────────

test('reporte contable y estado de cuenta tienen categoría propia', () => {
  assert.equal(parseDocumentName('Reporte_contable_junio_2026.xlsx').category, 'CONTABLE');
  assert.equal(parseDocumentName('Estado de cuenta BBVA 2026-05.pdf').category, 'ESTADO_CUENTA');
  assert.equal(parseDocumentContent('reporte contable del mes de junio 2026').category, 'CONTABLE');
  assert.equal(parseDocumentContent('estado de cuenta periodo mayo 2026').category, 'ESTADO_CUENTA');
  assert.equal(parseQuery('el reporte contable de junio').category, 'CONTABLE');
  assert.equal(parseQuery('mi estado de cuenta de mayo').category, 'ESTADO_CUENTA');
  assert.equal(parseQuery('el reporte de ventas').category, 'REPORTE');
});
