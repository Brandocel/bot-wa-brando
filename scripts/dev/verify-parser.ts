/**
 * Verifica la clasificación de nombres de archivo contra casos reales.
 *
 * Este parser decide qué se indexa y qué queda en cuarentena, así que es el
 * que separa "el bot encuentra la factura" de "el bot dice que no existe".
 * No pega a la base ni a Drive: corre en un segundo.
 *
 * Correr con: npx tsx scripts/dev/verify-parser.ts
 */
import { parseDocumentName } from '../../apps/agent-core/src/application/support/document-name.parser';

interface Case {
  file: string;
  folders?: string[];
  expect: string;
}

const CASES: Case[] = [
  { file: 'FACTURA_2026-02_A1234.pdf', expect: 'FACTURA 2026-02 A1234' },
  { file: 'factura febrero 2026.pdf', expect: 'FACTURA 2026-02 sin folio' },
  { file: 'CFDI-2026-02-B2001.pdf', expect: 'FACTURA 2026-02 B2001' },
  { file: 'Contrato arrendamiento 2025.pdf', expect: 'CONTRATO 2025-01 sin folio' },
  { file: 'reporte_02-2026_ventas.pdf', expect: 'REPORTE 2026-02 sin folio' },
  // La subcarpeta clasifica cuando el nombre no dice nada.
  { file: 'A1234.pdf', folders: ['Facturas'], expect: 'FACTURA sin periodo A1234' },
  // Sin categoría ni periodo: cuarentena, que es lo correcto.
  { file: 'escaneo (3).pdf', expect: 'sin clasificar' },
  { file: 'documento final v2.pdf', expect: 'sin clasificar' },
];

let quarantined = 0;

for (const testCase of CASES) {
  const parsed = parseDocumentName(testCase.file, testCase.folders ?? []);
  const period = parsed.period ? parsed.period.toISOString().slice(0, 7) : 'sin periodo';
  const entregable = parsed.category !== null && parsed.period !== null;

  if (!entregable) quarantined += 1;

  const actual = parsed.category
    ? `${parsed.category} ${period} ${parsed.folio ?? 'sin folio'}`
    : 'sin clasificar';

  console.log(`${testCase.file}${testCase.folders ? ` [en ${testCase.folders.join('/')}]` : ''}`);
  console.log(`   esperado: ${testCase.expect}`);
  console.log(`   obtenido: ${actual}${entregable ? '' : '  → CUARENTENA'}\n`);
}

console.log(`${quarantined} de ${CASES.length} quedarían en cuarentena.`);
