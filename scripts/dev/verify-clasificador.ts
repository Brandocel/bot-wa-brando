/**
 * Clasificación de mensajes: qué es solicitud, qué es queja, qué es consulta.
 *
 * Sin base y sin modelo: la clasificación es pura, y es la que decide si un
 * mensaje pasa a una persona con prioridad alta. Un cambio en una expresión
 * que convierta "no es esa" en queja de servicio llenaría la bandeja de
 * tickets falsos; este script es lo que lo detecta antes de subirlo.
 *
 * Correr con: npm run verify:clasificador
 */
import {
  clasificar,
  quejaParaPersona,
} from '../../apps/agent-core/src/application/support/message-classifier';

interface Caso {
  texto: string;
  tipo: string;
  motivo?: string | null;
  molesto?: boolean;
  /** true = el bot no la resuelve solo: pasa a una persona. */
  persona?: boolean;
}

const CASOS: Caso[] = [
  // Solicitudes, aunque vengan con prisa o corrigiendo.
  { texto: 'Hola, necesito la factura de febrero 2026', tipo: 'SOLICITUD', molesto: false },
  { texto: 'me pasas el 2', tipo: 'SOLICITUD' },
  { texto: 'no es esa', tipo: 'SOLICITUD' },
  { texto: 'está mal', tipo: 'SOLICITUD', persona: false },
  { texto: 'esa no, la de marzo', tipo: 'SOLICITUD' },
  { texto: 'la factura de marzo???', tipo: 'SOLICITUD', molesto: true },
  { texto: '¡¡gracias!!', tipo: 'CORTESIA', molesto: false },
  { texto: 'HOLA NECESITO MI FACTURA YA', tipo: 'SOLICITUD', molesto: true },
  { texto: 'perdón por molestar, me pasas la factura de enero', tipo: 'SOLICITUD', molesto: false },
  { texto: 'la fecha de emisión de la factura', tipo: 'SOLICITUD', persona: false },

  // Quejas que el bot resuelve solo.
  { texto: 'no me llegó', tipo: 'QUEJA', motivo: 'no_recibido', persona: false },
  { texto: 'te equivocaste, eso no es lo que te pedí', tipo: 'QUEJA', motivo: 'documento_equivocado', persona: false },

  // Quejas para una persona.
  { texto: 'la factura de marzo viene con el RFC mal', tipo: 'QUEJA', motivo: 'error_en_documento', persona: true },
  { texto: 'el total está mal', tipo: 'QUEJA', motivo: 'error_en_documento', persona: true },
  { texto: 'me cobraron doble en la factura', tipo: 'QUEJA', motivo: 'error_en_documento', persona: true },
  { texto: 'hay que refacturar la de enero', tipo: 'QUEJA', motivo: 'error_en_documento', persona: true },
  { texto: 'llevo 3 días esperando y nadie me contesta', tipo: 'QUEJA', motivo: 'demora', molesto: true, persona: true },
  { texto: 'sigo esperando', tipo: 'QUEJA', motivo: 'demora', persona: true },
  { texto: 'pésimo servicio, este bot no sirve para nada', tipo: 'QUEJA', motivo: 'mal_servicio', molesto: true, persona: true },
  { texto: 'no me entiendes', tipo: 'QUEJA', motivo: 'mal_servicio', persona: true },
  { texto: 'quiero poner una queja', tipo: 'QUEJA', motivo: 'mal_servicio', persona: true },

  // Seguimiento de un caso.
  { texto: '¿ya revisaron mi caso?', tipo: 'SEGUIMIENTO' },
  { texto: 'qué pasó con mi ticket 12', tipo: 'SEGUIMIENTO' },
  { texto: 'alguna novedad?', tipo: 'SEGUIMIENTO' },

  // Consultas: preguntas que no piden un documento.
  { texto: '¿qué documentos tienes?', tipo: 'CONSULTA' },
  { texto: '¿cómo sabes que es de este mes?', tipo: 'CONSULTA' },
  { texto: '¿cuál es su horario de atención?', tipo: 'CONSULTA', molesto: false },
  { texto: 'quién eres', tipo: 'CONSULTA' },

  // Pide una persona, esté o no molesto.
  { texto: 'pásame con un asesor', tipo: 'PIDE_HUMANO' },
  { texto: 'quiero hablar con una persona, pésimo servicio', tipo: 'PIDE_HUMANO', molesto: true },

  // Cortesía.
  { texto: 'hola', tipo: 'CORTESIA' },
  { texto: 'gracias', tipo: 'CORTESIA' },
  { texto: 'ok', tipo: 'CORTESIA' },
  { texto: 'perdón, sí es la misma', tipo: 'CORTESIA' },
];

let fallos = 0;

for (const caso of CASOS) {
  const c = clasificar(caso.texto);
  const errores: string[] = [];

  if (c.tipo !== caso.tipo) errores.push(`tipo ${c.tipo}, esperaba ${caso.tipo}`);
  if (caso.motivo !== undefined && c.motivo !== caso.motivo) {
    errores.push(`motivo ${c.motivo}, esperaba ${caso.motivo}`);
  }
  if (caso.molesto !== undefined && c.molesto !== caso.molesto) {
    errores.push(`molesto ${c.molesto}, esperaba ${caso.molesto}`);
  }
  if (caso.persona !== undefined && quejaParaPersona(c) !== caso.persona) {
    errores.push(`para persona ${quejaParaPersona(c)}, esperaba ${caso.persona}`);
  }

  const etiqueta = `${c.tipo}${c.motivo ? `/${c.motivo}` : ''}${c.molesto ? ' (molesto)' : ''}`;
  if (errores.length === 0) {
    console.log(`  ok    "${caso.texto}" → ${etiqueta}`);
  } else {
    fallos++;
    console.log(`  FALLA "${caso.texto}" → ${errores.join('; ')}`);
  }
}

console.log(`\n${CASOS.length - fallos}/${CASOS.length} casos correctos`);
process.exit(fallos === 0 ? 0 : 1);
