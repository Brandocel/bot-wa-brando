/**
 * Verificación del control de acceso contra los datos del seed.
 *
 * No es un test unitario: pega a la base real y ejerce las mismas clases que
 * usa el bot. Sirve para responder la única pregunta que importa antes de
 * conectar el LLM — ¿los permisos niegan lo que tienen que negar?
 *
 * Correr con: npx tsx scripts/dev/verify-access.ts
 */
import { PrismaClient } from '@prisma/client';
import { AccessScopeService } from '../../apps/agent-core/src/application/support/access-scope.service';
import { DocumentSearchService } from '../../apps/agent-core/src/application/support/document-search.service';
import { parseQuery } from '../../apps/agent-core/src/application/support/query-parser';

const prisma = new PrismaClient();
const scopeService = new AccessScopeService(prisma as never);
const searchService = new DocumentSearchService(prisma as never);

interface Case {
  waId: string;
  query: string;
  expect: string;
}

const CASES: Case[] = [
  { waId: '5215500000001@c.us', query: 'factura febrero 2026', expect: '1 documento' },
  { waId: '5215500000002@c.us', query: 'contrato', expect: '1 documento' },
  { waId: '5215500000003@c.us', query: 'factura febrero 2026', expect: '0 documentos (DENY_UNVERIFIED)' },
  { waId: '5215500000004@c.us', query: 'factura febrero 2026', expect: '0 documentos' },
  { waId: '5215500000005@c.us', query: 'factura diciembre 2025', expect: '0 documentos' },
  { waId: '5215500000005@c.us', query: 'factura marzo 2026', expect: '1 documento' },
  { waId: '5215500000099@c.us', query: 'factura febrero 2026', expect: '2 organizaciones' },
  { waId: '5215599999999@c.us', query: 'factura febrero 2026', expect: 'sin acceso' },
];

async function main(): Promise<void> {
  for (const testCase of CASES) {
    const scope = await scopeService.resolve(testCase.waId);
    const query = parseQuery(testCase.query);

    if (scope.decision !== 'ALLOW') {
      report(testCase, `sin acceso (${scope.decision})`);
      continue;
    }

    const results = await searchService.search(scope.scopes, query);
    const orgs = scope.scopes.length;

    // Cuando no hay resultados, lo que importa no es el cero: es POR QUÉ.
    // Ese motivo es el que se audita y el que decide cómo se escala.
    const denial =
      results.length === 0 && query.category
        ? scopeService.denialFor(scope.scopes, query.category, query.period)
        : null;
    const detail =
      orgs > 1
        ? `${orgs} organizaciones, ${results.length} documento(s)`
        : `${results.length} documento(s): ${results.map((d) => d.name).join(', ') || (denial ?? 'NOT_FOUND')}`;

    report(testCase, detail);
  }

  await prisma.$disconnect();
}

function report(testCase: Case, actual: string): void {
  console.log(`${testCase.waId}  "${testCase.query}"`);
  console.log(`   esperado: ${testCase.expect}`);
  console.log(`   obtenido: ${actual}\n`);
}

void main();
