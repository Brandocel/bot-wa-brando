/**
 * Convierte el JSON de la cuenta de servicio a una sola línea, lista para
 * pegar en el panel de variables de entorno de Render.
 *
 * Se imprime en TU terminal y no pasa por ningún otro lado. La salida es una
 * credencial: cópiala directo al panel y no la pegues en un chat, un ticket
 * ni un commit.
 *
 * Uso:  node scripts/dev/drive-env.js ruta/al/archivo.json
 */
const fs = require('fs');

const path = process.argv[2];

if (!path) {
  console.error('Uso: node scripts/dev/drive-env.js <ruta al JSON descargado>');
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));

if (!parsed.client_email || !parsed.private_key) {
  console.error('Ese archivo no parece una clave de cuenta de servicio.');
  process.exit(1);
}

const oneLine = JSON.stringify(parsed);

console.log('Cuenta de servicio (esta es la que se comparte en Drive):');
console.log(`  ${parsed.client_email}`);
console.log('');
console.log('Pega TODO lo que sigue en Render → agent-core → Environment →');
console.log('GOOGLE_SERVICE_ACCOUNT_JSON');
console.log('');
console.log(oneLine);
console.log('');
console.log('Para .env local, la misma línea pero entre comillas SIMPLES:');
console.log("  GOOGLE_SERVICE_ACCOUNT_JSON='<la línea de arriba>'");
console.log('');
console.log('Comillas simples, no dobles: dotenv expande los \\n dentro de');
console.log('comillas dobles y convierte la llave privada en un JSON roto.');
