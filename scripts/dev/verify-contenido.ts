/**
 * Enseña qué lee el bot DENTRO de cada archivo de una carpeta de Drive y qué
 * metadatos saca de ahí: mes, folio y tipo. Sirve para ver por qué un
 * documento se ofrece como "sin mes" o por qué no aparece al buscar
 * "la factura de Parcia Ima".
 *
 * Correr con: npx tsx scripts/dev/verify-contenido.ts <idDeCarpeta>
 *
 * Con DATABASE_URL en .env no hace falta nada más que el id: las
 * organizaciones registradas se pueden ver con /drive desde WhatsApp.
 */
import 'dotenv/config';
import { GoogleDriveAdapter } from '../../apps/agent-core/src/infrastructure/drive/google-drive.adapter';
import { config } from '../../apps/agent-core/src/config';
import { parseDocumentName } from '../../apps/agent-core/src/application/support/document-name.parser';
import { parseDocumentContent } from '../../apps/agent-core/src/application/support/document-content.parser';
import { DocumentContentService } from '../../apps/agent-core/src/application/support/document-content.service';

async function main(): Promise<void> {
  if (!config.google.serviceAccount) {
    console.error('Falta GOOGLE_SERVICE_ACCOUNT_JSON en .env');
    process.exitCode = 1;
    return;
  }

  const folderId = process.argv[2];
  if (!folderId) {
    console.log('Uso: npx tsx scripts/dev/verify-contenido.ts <idDeCarpeta>');
    return;
  }

  const drive = new GoogleDriveAdapter();
  const lector = new DocumentContentService(drive);
  const files = await drive.listFolder(folderId);

  console.log(`${files.length} archivo(s)\n`);

  for (const file of files) {
    const nombre = parseDocumentName(file.name, file.folderPath);
    const texto = await lector.leer(file);
    const contenido = parseDocumentContent(texto);

    const mes = (d: Date | null) => (d ? d.toISOString().slice(0, 7) : '—');

    console.log(`■ ${file.name}`);
    console.log(`   nombre:    ${nombre.category ?? '—'} · ${mes(nombre.period)} · ${nombre.folio ?? '—'}`);
    console.log(`   contenido: ${contenido.category ?? '—'} · ${mes(contenido.period)} · ${contenido.folio ?? '—'}`);
    console.log(`   final:     ${nombre.category ?? contenido.category ?? 'OTRO'} · ${mes(nombre.periodoDebil ? (contenido.period ?? nombre.period) : (nombre.period ?? contenido.period))} · ${nombre.folio ?? contenido.folio ?? '—'}`);
    console.log(`   texto:     ${texto ? `${texto.length} chars · "${texto.slice(0, 160)}…"` : '(no legible)'}`);
    console.log('');
  }
}

void main();
