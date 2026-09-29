import { inflateRawSync } from 'node:zlib';

/**
 * Texto de los archivos de Office modernos (.xlsx, .docx, .pptx).
 *
 * Son un ZIP con XML adentro, así que no hace falta una librería entera:
 * basta con leer el índice del ZIP, descomprimir las pocas partes que
 * traen texto y quitar las etiquetas. Lo que no se entienda devuelve null
 * y el documento se clasifica con lo que diga su nombre.
 *
 * Con topes en todo: un ZIP puede declarar que descomprime a gigas, y
 * esto corre dentro del proceso que contesta WhatsApp.
 */

/** Lo más que se descomprime por parte del ZIP. */
const MAX_PARTE = 8 * 1024 * 1024;

/** Lo más que se descomprime sumando todas las partes. */
const MAX_TOTAL = 24 * 1024 * 1024;

/** Hojas de un Excel que se leen. El resumen suele estar en las primeras. */
const MAX_HOJAS = 5;

/** Diapositivas de un PowerPoint que se leen. */
const MAX_DIAPOSITIVAS = 15;

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function esOffice(mimeType: string): boolean {
  return mimeType === MIME_XLSX || mimeType === MIME_DOCX || mimeType === MIME_PPTX;
}

export function textoDeOffice(bytes: Buffer, mimeType: string): string | null {
  const zip = leerIndice(bytes);
  if (!zip) return null;

  if (mimeType === MIME_DOCX) {
    const xml = zip.leer('word/document.xml');
    return xml ? textoDeWord(xml) : null;
  }

  if (mimeType === MIME_XLSX) return textoDeExcel(zip);

  if (mimeType === MIME_PPTX) {
    const diapositivas = zip
      .nombres()
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => numero(a) - numero(b))
      .slice(0, MAX_DIAPOSITIVAS);
    return diapositivas
      .map((n) => zip.leer(n))
      .filter((xml): xml is string => xml !== null)
      .map((xml) => textoEntre(xml, 'a:t').join(' '))
      .join('\n');
  }

  return null;
}

// ── Word ────────────────────────────────────────────────────────────────

function textoDeWord(xml: string): string {
  // Un párrafo por línea: "Fecha: 12 de junio" no debe pegarse al folio.
  return xml
    .split(/<\/w:p>/)
    .map((parrafo) => textoEntre(parrafo, 'w:t').join(''))
    .filter((linea) => linea.trim() !== '')
    .join('\n');
}

// ── Excel ───────────────────────────────────────────────────────────────

function textoDeExcel(zip: Zip): string | null {
  const compartidas = zip.leer('xl/sharedStrings.xml');
  const cadenas = compartidas
    ? compartidas
        .split(/<\/si>/)
        .slice(0, -1)
        .map((si) => textoEntre(si, 't').join(''))
    : [];

  // Nombres de hoja en el orden del libro: "Balanza junio" dice mucho.
  const libro = zip.leer('xl/workbook.xml') ?? '';
  const nombresHoja = [...libro.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) =>
    decodificar(m[1]!),
  );

  const hojas = zip
    .nombres()
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => numero(a) - numero(b))
    .slice(0, MAX_HOJAS);

  if (hojas.length === 0) return null;

  const partes: string[] = [];
  hojas.forEach((ruta, i) => {
    const xml = zip.leer(ruta);
    if (!xml) return;
    partes.push(`[hoja] ${nombresHoja[i] ?? `Hoja ${i + 1}`}`);

    for (const fila of xml.split(/<\/row>/)) {
      const celdas: string[] = [];
      for (const c of fila.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const atributos = c[1] ?? '';
        const cuerpo = c[2] ?? '';
        const tipo = /\bt="([^"]*)"/.exec(atributos)?.[1];
        let valor: string | undefined;
        if (tipo === 'inlineStr') valor = textoEntre(cuerpo, 't').join('');
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
          if (v === undefined) continue;
          valor = tipo === 's' ? cadenas[Number(v)] : decodificar(v);
        }
        if (valor && valor.trim() !== '') celdas.push(valor.trim());
      }
      if (celdas.length > 0) partes.push(celdas.join(' | '));
    }
  });

  return partes.join('\n');
}

// ── XML ─────────────────────────────────────────────────────────────────

/** El texto de cada <etiqueta>…</etiqueta>, sin atributos ni hijos. */
function textoEntre(xml: string, etiqueta: string): string[] {
  const patron = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiqueta}>`, 'g');
  return [...xml.matchAll(patron)].map((m) => decodificar(m[1]!.replace(/<[^>]+>/g, '')));
}

function decodificar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function numero(ruta: string): number {
  return Number(/(\d+)\.xml$/.exec(ruta)?.[1] ?? 0);
}

// ── ZIP ─────────────────────────────────────────────────────────────────

interface Entrada {
  metodo: number;
  comprimido: number;
  descomprimido: number;
  offsetLocal: number;
}

interface Zip {
  nombres(): string[];
  leer(nombre: string): string | null;
}

/**
 * Lee el directorio central del ZIP (al final del archivo). Solo lo
 * necesario para Office: sin ZIP64, sin cifrado, métodos 0 y 8.
 */
function leerIndice(bytes: Buffer): Zip | null {
  // El registro de fin de directorio está en los últimos 22 bytes + comentario.
  const desde = Math.max(0, bytes.length - 22 - 0xffff);
  let fin = -1;
  for (let i = bytes.length - 22; i >= desde; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return null;

  const total = bytes.readUInt16LE(fin + 10);
  let p = bytes.readUInt32LE(fin + 16);
  const entradas = new Map<string, Entrada>();

  for (let i = 0; i < total; i++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== 0x02014b50) return null;
    const largoNombre = bytes.readUInt16LE(p + 28);
    const largoExtra = bytes.readUInt16LE(p + 30);
    const largoComentario = bytes.readUInt16LE(p + 32);
    const nombre = bytes.toString('utf8', p + 46, p + 46 + largoNombre);
    entradas.set(nombre, {
      metodo: bytes.readUInt16LE(p + 10),
      comprimido: bytes.readUInt32LE(p + 20),
      descomprimido: bytes.readUInt32LE(p + 24),
      offsetLocal: bytes.readUInt32LE(p + 42),
    });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }

  let presupuesto = MAX_TOTAL;

  return {
    nombres: () => [...entradas.keys()],
    leer(nombre) {
      const e = entradas.get(nombre);
      if (!e || e.descomprimido > MAX_PARTE || e.descomprimido > presupuesto) return null;

      const local = e.offsetLocal;
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) return null;
      const inicio = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const datos = bytes.subarray(inicio, inicio + e.comprimido);

      try {
        const salida =
          e.metodo === 0
            ? datos
            : e.metodo === 8
              ? inflateRawSync(datos, { maxOutputLength: MAX_PARTE })
              : null;
        if (!salida) return null;
        presupuesto -= salida.length;
        return salida.toString('utf8');
      } catch {
        return null;
      }
    },
  };
}
