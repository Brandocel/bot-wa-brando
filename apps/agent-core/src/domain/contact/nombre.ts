/**
 * Nombres de persona, comparables.
 *
 * Lo que la persona escribe ("juan perez lopez") y lo que está registrado
 * ("Juan Pérez López") tienen que poder compararse sin que estorben los
 * acentos, las mayúsculas, el orden o las partículas ("de la", "y"). Y lo
 * mismo contra el titular de un documento, que el clasificador leyó como
 * texto libre ("JUAN PÉREZ LÓPEZ, RFC PELJ800101XXX").
 *
 * Un nombre NO es una credencial: cualquiera que lo conozca lo escribe.
 * Aquí solo se compara; quién tiene acceso lo sigue decidiendo la
 * membresía.
 *
 * La migración 20261002180000_nombre_titular replica esta misma regla en
 * SQL para llenar Document.holderKey de lo que ya estaba indexado: si se
 * cambia aquí, hay que cambiarla allá.
 */

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);

/** Palabras del nombre, normalizadas y sin partículas, en orden. */
export function tokensNombre(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((p) => p !== '' && !PARTICULAS.has(p));
}

/**
 * Clave de búsqueda del titular de un documento: las palabras entre
 * espacios, " juan perez lopez ". Con los espacios de los extremos un
 * `contains: ' juan '` casa con la palabra entera y no con "juanita".
 */
export function claveTitular(texto: string | null | undefined): string | null {
  const tokens = tokensNombre(texto);
  return tokens.length > 0 ? ` ${tokens.join(' ')} ` : null;
}

/**
 * ¿Es el mismo nombre? Mismas palabras, en cualquier orden. Estricto a
 * propósito: "Juan Pérez" no es "Juan Carlos Pérez López". Pide al menos
 * dos palabras: un nombre de pila suelto no identifica a nadie.
 */
export function mismoNombre(escrito: string, registrado: string): boolean {
  const a = new Set(tokensNombre(escrito));
  const b = new Set(tokensNombre(registrado));
  if (a.size < 2 || a.size !== b.size) return false;
  return [...a].every((t) => b.has(t));
}
