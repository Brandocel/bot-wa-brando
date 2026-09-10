/**
 * Comprueba que la cuenta de servicio puede hablar con Drive y qué alcanza a ver.
 *
 * Responde las dos preguntas que separan "no está configurado" de "la carpeta
 * no está compartida", que desde WhatsApp son indistinguibles: Drive no da
 * error cuando no tienes acceso a una carpeta, devuelve una carpeta vacía.
 *
 * Correr con: npx tsx scripts/dev/verify-drive.ts [idDeCarpeta]
 */
import 'dotenv/config';
import { GoogleDriveAdapter } from '../../apps/agent-core/src/infrastructure/drive/google-drive.adapter';
import { config } from '../../apps/agent-core/src/config';
import { parseDocumentName } from '../../apps/agent-core/src/application/support/document-name.parser';

async function main(): Promise<void> {
  const account = config.google.serviceAccount;

  if (!account) {
    console.error('Falta GOOGLE_SERVICE_ACCOUNT_JSON en .env');
    process.exitCode = 1;
    return;
  }

  console.log(`Cuenta de servicio: ${account.client_email}\n`);

  const drive = new GoogleDriveAdapter();

  // 1. ¿Autentica y la Drive API está habilitada?
  try {
    const cursor = await drive.startCursor();
    console.log(`✓ Autenticación correcta (cursor: ${cursor.slice(0, 12)}...)\n`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`✗ No pudo autenticar: ${detail}\n`);
    if (detail.includes('403')) {
      console.error('Suele ser la Drive API sin habilitar en el proyecto de Google Cloud.');
    }
    process.exitCode = 1;
    return;
  }

  const folderId = process.argv[2];

  if (!folderId) {
    console.log('Sin id de carpeta: solo se probó la autenticación.');
    console.log('Para probar una carpeta:');
    console.log('  npx tsx scripts/dev/verify-drive.ts <idDeCarpeta>');
    return;
  }

  // 2. ¿Llega a la carpeta y qué haría con lo que hay dentro?
  const files = await drive.listFolder(folderId);

  if (files.length === 0) {
    console.log('✗ La carpeta se ve vacía.');
    console.log('');
    console.log('Drive responde igual cuando la carpeta está vacía de verdad y');
    console.log('cuando no está compartida con la cuenta de servicio. Comparte');
    console.log(`la carpeta con ${account.client_email} como Lector.`);
    return;
  }

  console.log(`✓ ${files.length} archivo(s) visibles:\n`);

  for (const file of files) {
    const parsed = parseDocumentName(file.name, file.folderPath);
    const entregable = parsed.category !== null && parsed.period !== null;
    const period = parsed.period ? parsed.period.toISOString().slice(0, 7) : '—';
    const where = file.folderPath.length > 0 ? ` [${file.folderPath.join('/')}]` : '';

    console.log(`  ${file.name}${where}`);
    console.log(
      `    ${entregable ? 'INDEXED' : 'CUARENTENA'} · ${parsed.category ?? 'sin categoría'} · ${period} · ${parsed.folio ?? 'sin folio'}`,
    );
  }
}

void main();
