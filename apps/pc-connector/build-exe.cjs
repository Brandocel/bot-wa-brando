/**
 * Arma ConectorBot.exe: un ejecutable único de Node (SEA) con conector.cjs
 * adentro, para que el cliente no tenga que instalar nada.
 *
 * Corre en el build de Render, que es Linux: el blob de SEA no depende de
 * la plataforma (sin code cache ni snapshot), y el node.exe de Windows se
 * baja de nodejs.org en la MISMA versión que corre este build, que es lo
 * que SEA exige.
 *
 * Si algo falla, avisa y sale con 0: sin .exe el panel dice "no
 * disponible", pero el bot sigue desplegándose.
 *
 *   node apps/pc-connector/build-exe.cjs
 */

'use strict';

const { execFileSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const DIR = __dirname;
const DIST = join(DIR, 'dist');
const BLOB = join(DIST, 'sea-prep.blob');
const NODE_WIN = join(DIST, `node-${process.version}-win-x64.exe`);
const EXE = join(DIST, 'ConectorBot.exe');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

async function main() {
  mkdirSync(DIST, { recursive: true });

  const seaConfig = join(DIST, 'sea-config.json');
  writeFileSync(
    seaConfig,
    JSON.stringify({
      main: join(DIR, 'conector.cjs'),
      output: BLOB,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  if (!existsSync(NODE_WIN)) {
    const url = `https://nodejs.org/dist/${process.version}/win-x64/node.exe`;
    console.log(`bajando ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`nodejs.org respondió ${res.status}`);
    writeFileSync(NODE_WIN, Buffer.from(await res.arrayBuffer()));
  }

  rmSync(EXE, { force: true });
  copyFileSync(NODE_WIN, EXE);

  // Al inyectar, la firma de Node deja de ser válida. Una firma rota se ve
  // peor en Windows que no tener firma, así que se quita.
  writeFileSync(EXE, quitarFirma(readFileSync(EXE)));

  const { inject } = require('postject');
  await inject(EXE, 'NODE_SEA_BLOB', readFileSync(BLOB), { sentinelFuse: FUSE });

  console.log(`listo: ${EXE}`);
}

/**
 * Borra la firma Authenticode de un PE: la entrada 4 del directorio de
 * datos (IMAGE_DIRECTORY_ENTRY_SECURITY) apunta a un bloque al final del
 * archivo. Se pone en cero y se recorta el bloque.
 */
function quitarFirma(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return buf;

  const opcional = pe + 24;
  const magic = buf.readUInt16LE(opcional);
  const directorios = opcional + (magic === 0x20b ? 112 : 96);
  const entrada = directorios + 4 * 8;

  const inicio = buf.readUInt32LE(entrada);
  const tam = buf.readUInt32LE(entrada + 4);
  if (!inicio || !tam) return buf;

  const limpio = Buffer.from(buf.subarray(0, inicio + tam === buf.length ? inicio : buf.length));
  limpio.writeUInt32LE(0, entrada);
  limpio.writeUInt32LE(0, entrada + 4);
  return limpio;
}

main().catch((err) => {
  console.warn(`AVISO: no se pudo armar ConectorBot.exe (${err.message}). El panel lo mostrará como no disponible.`);
});
