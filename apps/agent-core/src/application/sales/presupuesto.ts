import { pesos, type ProductoVenta } from './pedido';

/**
 * El presupuesto del cliente ("tengo 250", "no traigo más de $120").
 *
 * Las cuentas con el presupuesto las hace el código. El modelo solo, con
 * "$21 que me sobran" y unas tortillas de $13, contestó que no alcanzaba; y
 * cuando sí escribía bien la cuenta, el filtro de montos inventados tiraba su
 * texto porque "$250" o "$21" no son precios de la carta, y el cliente
 * recibía "¿Qué más te gustaría agregar?" tres veces seguidas.
 */

/** Cuántos productos puede combinar una sugerencia que el modelo mencione. */
const MAX_PIEZAS = 5;
/** Más de esto no es un presupuesto de comida, es otra cosa (un teléfono, un folio). */
const MAX_PRESUPUESTO_CENTS = 20000_00;

const CON_SIGNO = /\$\s?(\d{2,6})(?:\.\d{1,2})?/;
const CON_PALABRA = /\b(\d{2,6})\s*(?:pesos|varos|mxn|baros)\b/i;
const CON_VERBO = /\b(?:tengo|traigo|cuento con|presupuesto(?: de| es)?|me alcanza con|solo (?:tengo|traigo)|nada mas|nomas)\s*(?:de\s*)?\$?\s*(\d{2,6})\b/i;
/**
 * Un monto suelto ("¿el de $99 qué trae?") es un precio, no un presupuesto.
 * Solo cuenta si la frase habla de lo que trae o le alcanza.
 */
const HABLA_DE_PRESUPUESTO = /\b(tengo|traigo|cuento con|presupuesto|alcanza|no tengo mas|nada mas|nomas|solo (?:tengo|traigo)|maximo|gastar)\b/i;

/**
 * El presupuesto más reciente que dijo el cliente, en centavos, o null.
 * `textos` va del más nuevo al más viejo; el primero que diga uno gana.
 */
export function leerPresupuesto(textos: readonly string[]): number | null {
  for (const texto of textos) {
    const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const m = CON_VERBO.exec(t) ?? (HABLA_DE_PRESUPUESTO.test(t) ? CON_SIGNO.exec(t) ?? CON_PALABRA.exec(t) : null);
    if (!m) continue;
    const cents = Number(m[1]) * 100;
    if (cents > 0 && cents <= MAX_PRESUPUESTO_CENTS) return cents;
  }
  return null;
}

/** Totales que se pueden armar con hasta MAX_PIEZAS productos de la carta sin pasarse. */
export function sumasAlcanzables(catalogo: readonly ProductoVenta[], tope: number): Set<number> {
  const precios = [...new Set(catalogo.map((c) => c.priceCents).filter((p) => p > 0 && p <= tope))];
  let frontera = new Set<number>([0]);
  const todas = new Set<number>();
  for (let n = 0; n < MAX_PIEZAS; n++) {
    const siguiente = new Set<number>();
    for (const base of frontera) {
      for (const p of precios) {
        const s = base + p;
        if (s <= tope && !todas.has(s)) { todas.add(s); siguiente.add(s); }
      }
    }
    frontera = siguiente;
    if (frontera.size === 0) break;
  }
  return todas;
}

/**
 * Montos que el texto puede mencionar cuando hay presupuesto: el presupuesto,
 * cualquier combinación de la carta que quepa, y lo que sobraría de cada una.
 */
export function montosDePresupuesto(catalogo: readonly ProductoVenta[], presupuesto: number): Set<number> {
  const ok = new Set<number>([presupuesto]);
  for (const s of sumasAlcanzables(catalogo, presupuesto)) {
    ok.add(s);
    ok.add(presupuesto - s);
  }
  return ok;
}

/** Lo que se le dice al modelo: qué cabe, ya con la cuenta hecha. */
export function presupuestoParaModelo(catalogo: readonly ProductoVenta[], presupuesto: number, llevaCents: number): string {
  const queda = presupuesto - llevaCents;
  const caben = catalogo
    .filter((c) => c.priceCents <= Math.max(queda, 0))
    .sort((a, b) => b.priceCents - a.priceCents)
    .slice(0, 12)
    .map((c) => `  - [${c.id}] ${c.name} — ${pesos(c.priceCents)} (sobrarían ${pesos(queda - c.priceCents)})`);
  return [
    `PRESUPUESTO DEL CLIENTE: ${pesos(presupuesto)}.` +
      (llevaCents > 0 ? ` Lo que ya lleva suma ${pesos(llevaCents)}; le quedan ${pesos(queda)}.` : ''),
    queda <= 0
      ? '  Ya no le cabe nada más: dile cuánto se pasa y ofrece quitar o cambiar algo.'
      : caben.length
        ? `  Con lo que le queda le cabe (cuentas ya hechas, úsalas tal cual):\n${caben.join('\n')}`
        : '  Con lo que le queda no le cabe ningún producto de la carta: díselo con tacto.',
  ].join('\n');
}
