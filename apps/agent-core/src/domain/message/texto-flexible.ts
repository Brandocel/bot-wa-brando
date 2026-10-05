/**
 * Leer lo que la gente escribe de verdad: "fatura", "tranferencia",
 * "efectibo", "zi", "la uno", "devito".
 *
 * Dos capas:
 *  1. Cómo SUENA la palabra en español: z/c(e,i) → s, v → b, ll → y, sin h,
 *     qu/c(a,o,u) → k. "efectibo" y "efectivo" suenan igual.
 *  2. Una o dos letras de diferencia (de más, de menos, cambiadas o
 *     volteadas), según el largo: en palabras cortas no se perdona nada,
 *     porque "si" y "no" están a dos letras.
 *
 * Esto se usa para respuestas a preguntas cerradas. Lo que importa de
 * verdad (RFC, montos) no pasa por aquí, y todo se confirma al final.
 */

export function sinAcentos(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Palabras en minúsculas, sin acentos ni signos; "siiii" → "si". */
export function palabras(texto: string): string[] {
  return sinAcentos(texto)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1')
    .split(/\s+/)
    .filter(Boolean);
}

/** Cómo suena: dos escrituras de la misma palabra dan lo mismo. */
export function sonido(palabra: string): string {
  return sinAcentos(palabra)
    .replace(/ll/g, 'y')
    .replace(/qu/g, 'k')
    .replace(/c([ei])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/h/g, '')
    .replace(/x/g, 'ks')
    .replace(/([a-z])\1+/g, '$1');
}

/** Distancia de edición con trasposición (Damerau): "tarjeta"/"tarejta" = 1. */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** ¿Es la misma palabra, mal escrita? */
export function parecida(palabra: string, objetivo: string): boolean {
  const a = sonido(palabra);
  const b = sonido(objetivo);
  if (a === b) return true;
  const largo = Math.max(b.length, sinAcentos(objetivo).length);
  const tolerancia = largo >= 8 ? 2 : largo >= 5 ? 1 : 0;
  return tolerancia > 0 && distancia(a, b) <= tolerancia;
}

/** ¿Alguna palabra del texto se parece a alguna de estas? */
export function menciona(texto: string, objetivos: readonly string[]): boolean {
  const ps = palabras(texto);
  return ps.some((p) => objetivos.some((o) => parecida(p, o)));
}

const NUMEROS: Record<string, number> = {
  uno: 1, una: 1, primero: 1, primera: 1, primer: 1,
  dos: 2, segundo: 2, segunda: 2,
  tres: 3, tercero: 3, tercera: 3, tercer: 3,
  cuatro: 4, cuarto: 4, cuarta: 4,
  cinco: 5, quinto: 5, quinta: 5,
  seis: 6, sexto: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

/** Relleno alrededor de una opción: "la 2", "opción dos", "el primero porfa". */
const RELLENO_OPCION = ['la', 'el', 'lo', 'opcion', 'numero', 'num', 'no', 'es', 'seria', 'porfa', 'por', 'favor', 'gracias', 'pues', 'ok'];

/**
 * El número de opción que eligió: "2", "2.", "la 2", "opción dos",
 * "el primero", "2️⃣". null si no eligió exactamente una opción válida.
 */
export function numeroDeOpcion(texto: string, max: number): number | null {
  const sinEmoji = texto.replace(/(\d)️?⃣/g, '$1');
  const ps = palabras(sinEmoji);
  const elegidos: number[] = [];
  for (const p of ps) {
    if (/^\d{1,2}$/.test(p)) { elegidos.push(Number(p)); continue; }
    const n = Object.entries(NUMEROS).find(([w]) => parecida(p, w))?.[1];
    if (n !== undefined) { elegidos.push(n); continue; }
    if (!RELLENO_OPCION.some((r) => parecida(p, r))) return null;
  }
  if (elegidos.length !== 1) return null;
  const n = elegidos[0]!;
  return n >= 1 && n <= max ? n : null;
}
