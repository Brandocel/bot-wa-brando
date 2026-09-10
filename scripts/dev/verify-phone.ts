/**
 * Comprueba la normalización de números contra los formatos que un operador
 * teclea de verdad.
 *
 * Este archivo decide si un permiso llega a aplicarse: si el número se
 * guarda con un formato y WhatsApp direcciona con otro, el permiso no
 * coincide nunca y el bot responde "no encontré" a alguien que sí tiene
 * acceso. Ese fallo no se parece en nada a un problema de formato, así que
 * más vale cazarlo aquí.
 *
 * Correr con: npm run verify:phone
 */
import { InvalidPhoneError, normalizePhone } from '../../apps/agent-core/src/domain/contact/phone';

interface Caso {
  entrada: string;
  esperado: string;
}

const CASOS: Caso[] = [
  // Lo que teclea el operador.
  { entrada: '9984862017', esperado: '5219984862017@c.us' },
  { entrada: '998 486 2017', esperado: '5219984862017@c.us' },
  { entrada: '998-486-2017', esperado: '5219984862017@c.us' },

  // Con lada, con y sin el 1 que WhatsApp espera en México.
  { entrada: '+52 998 486 2017', esperado: '5219984862017@c.us' },
  { entrada: '529984862017', esperado: '5219984862017@c.us' },
  { entrada: '5219984862017', esperado: '5219984862017@c.us' },
  { entrada: '+52 1 998 486 2017', esperado: '5219984862017@c.us' },

  // Un id de WhatsApp completo se respeta: no hay nada que adivinar.
  { entrada: '5219987102151@c.us', esperado: '5219987102151@c.us' },

  // Otro país: no se le mete la lada mexicana por delante.
  { entrada: '+1 305 555 0134', esperado: '13055550134@c.us' },
  { entrada: '+34 612 345 678', esperado: '34612345678@c.us' },
];

const INVALIDOS = ['12345', 'no soy un número', '', '9984862017999999999'];

let fallos = 0;

console.log('=== Números válidos ===\n');

for (const caso of CASOS) {
  const obtenido = normalizePhone(caso.entrada).waId;
  const ok = obtenido === caso.esperado;
  if (!ok) fallos += 1;

  console.log(`  ${ok ? '✓' : '✗'} "${caso.entrada}"`);
  console.log(`      ${obtenido}${ok ? '' : `   esperado ${caso.esperado}`}`);
}

console.log('\n=== Deben rechazarse ===\n');

for (const entrada of INVALIDOS) {
  try {
    const resultado = normalizePhone(entrada).waId;
    fallos += 1;
    console.log(`  ✗ "${entrada}" se aceptó como ${resultado}`);
  } catch (err) {
    const esperado = err instanceof InvalidPhoneError;
    if (!esperado) fallos += 1;
    console.log(`  ${esperado ? '✓' : '✗'} "${entrada}" rechazado`);
  }
}

console.log(
  `\n${fallos === 0 ? 'Todos correctos.' : `${fallos} fallo(s).`}`,
);

process.exitCode = fallos === 0 ? 0 : 1;
