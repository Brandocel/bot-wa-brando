/**
 * Comprueba las dos cosas que rompieron la entrega de documentos.
 *
 * 1. El nombre que se manda a WhatsApp lleva extensión. Sin ella, WhatsApp
 *    rechaza el archivo con un "false" de open-wa que no explica nada, y el
 *    bot queda diciendo "aquí está" sin que llegue nada. En Drive la gente
 *    sube archivos sin extensión constantemente.
 *
 * 2. "No veo el doc" se entiende como queja de la última entrega, no como
 *    una petición nueva. Tratarla como petición nueva producía el diálogo
 *    absurdo de "¿cuál doc buscabas?" justo después de haberlo mandado.
 *
 * Correr con: npm run verify:delivery
 */

const EXTENSIONES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'text/csv': '.csv',
};

function conExtension(nombre: string, mimeType: string): string {
  const esperada = EXTENSIONES[mimeType];
  if (!esperada) return nombre;
  return nombre.toLowerCase().endsWith(esperada) ? nombre : nombre + esperada;
}

function esQuejaDeNoRecibido(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (limpio.length > 60) return false;

  return /\b(no (lo |la |me )?(veo|llego|llega|recibi|aparece|abre)|no me lo mandaste|donde esta|no vino|no esta el (doc|archivo|pdf))\b/.test(
    limpio,
  );
}

let fallos = 0;

function comprobar(descripcion: string, obtenido: unknown, esperado: unknown): void {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${descripcion}`);
  if (!ok) console.log(`      obtenido ${String(obtenido)} · esperado ${String(esperado)}`);
}

console.log('=== Extensión del archivo ===\n');

// El caso real: así estaba subido a Drive y WhatsApp lo rechazó.
comprobar(
  'PDF sin extensión gana .pdf',
  conExtension('FACTURA_2026-02_V3001', 'application/pdf'),
  'FACTURA_2026-02_V3001.pdf',
);
comprobar(
  'PDF que ya la trae se queda igual',
  conExtension('FACTURA_2026-02_V3001.pdf', 'application/pdf'),
  'FACTURA_2026-02_V3001.pdf',
);
comprobar(
  'mayúsculas cuentan como extensión válida',
  conExtension('REPORTE.PDF', 'application/pdf'),
  'REPORTE.PDF',
);
comprobar(
  'un tipo desconocido no inventa extensión',
  conExtension('cosa-rara', 'application/x-cosa'),
  'cosa-rara',
);

console.log('\n=== "No me llegó" ===\n');

for (const frase of [
  'No veo el doc',
  'no me llegó',
  'no lo recibí',
  'dónde está?',
  'no aparece el archivo',
]) {
  comprobar(`"${frase}" es queja`, esQuejaDeNoRecibido(frase), true);
}

for (const frase of [
  'necesito la factura de febrero',
  'hola',
  'no veo el doc de febrero pero necesito además el contrato de enero y la póliza',
]) {
  comprobar(`"${frase.slice(0, 34)}…" NO es queja`, esQuejaDeNoRecibido(frase), false);
}

console.log(`\n${fallos === 0 ? 'Todos correctos.' : `${fallos} fallo(s).`}`);
process.exitCode = fallos === 0 ? 0 : 1;
