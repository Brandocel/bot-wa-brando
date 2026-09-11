/**
 * Recorre la entrega completa de un documento REAL contra la base y Drive,
 * sin mandar nada por WhatsApp.
 *
 * Sirve para separar tres fallos que desde el teléfono se ven idénticos:
 * el documento no está indexado, el número no tiene permiso, o Drive no
 * deja descargarlo. El mensaje al cliente es el mismo en los tres casos —a
 * propósito— así que hace falta mirarlo desde aquí.
 *
 * Correr con: npm run verify:entrega -- <waId> "<lo que pediría>"
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { AccessScopeService } from '../../apps/agent-core/src/application/support/access-scope.service';
import { DocumentSearchService } from '../../apps/agent-core/src/application/support/document-search.service';
import { parseQuery } from '../../apps/agent-core/src/application/support/query-parser';
import { GoogleDriveAdapter } from '../../apps/agent-core/src/infrastructure/drive/google-drive.adapter';

const prisma = new PrismaClient();
const scope = new AccessScopeService(prisma as never);
const search = new DocumentSearchService(prisma as never);
const drive = new GoogleDriveAdapter();

async function main(): Promise<void> {
  const waId = process.argv[2] ?? '5219984862017@c.us';
  const texto = process.argv[3] ?? 'la factura V3001';

  console.log(`Número:   ${waId}`);
  console.log(`Pediría:  "${texto}"\n`);

  // 1. ¿Tiene acceso a algo?
  const alcance = await scope.resolve(waId);

  if (alcance.decision !== 'ALLOW') {
    console.log(`✗ Sin acceso: ${alcance.decision} — ${alcance.decidedBy}`);
    return;
  }

  console.log('✓ Acceso a:');
  for (const s of alcance.scopes) {
    const categorias = s.windows.map((w) => w.category).join(', ');
    console.log(`    ${s.organizationName}: ${categorias || 'nada'}`);
  }

  // 2. ¿Qué entiende de la frase?
  const query = parseQuery(texto);
  console.log(
    `\nSlots por reglas: categoría=${query.category ?? '—'} · periodo=${query.period?.toISOString().slice(0, 7) ?? '—'} · folio=${query.folio ?? '—'}`,
  );

  // 3. ¿Qué encuentra?
  const resultados = await search.search(alcance.scopes, query);
  console.log(`\nResultados: ${resultados.length}`);

  for (const doc of resultados) {
    console.log(`  · ${doc.name} (${doc.mimeType}, ${doc.sizeBytes} bytes)`);
  }

  if (resultados.length === 0) {
    const motivo = query.category
      ? scope.denialFor(alcance.scopes, query.category, query.period)
      : null;
    console.log(
      `\n✗ Nada que entregar. Motivo: ${motivo ?? 'no hay documento que encaje'}`,
    );
    return;
  }

  // 4. ¿Se puede bajar de verdad? Es el paso que el teléfono nunca revela.
  const doc = resultados[0]!;
  console.log(`\nDescargando ${doc.name} de Drive…`);

  try {
    const bytes = await drive.download(doc.driveFileId);
    console.log(`✓ Bajado: ${bytes.byteLength} bytes reales`);

    const cabecera = bytes.subarray(0, 5).toString('latin1');
    console.log(
      cabecera.startsWith('%PDF')
        ? '✓ Es un PDF de verdad'
        : `⚠ No empieza por %PDF (empieza por "${cabecera}")`,
    );
  } catch (err) {
    console.log(`✗ Drive no lo entregó: ${String(err).slice(0, 300)}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
