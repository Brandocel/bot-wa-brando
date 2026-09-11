import type { WASocket } from 'baileys';

/**
 * Diagnóstico de direccionamiento.
 *
 * Nació cuando los archivos no salían con open-wa y había tres hipótesis en
 * juego. Con Baileys el problema de fondo desapareció —`lid` es un tipo de
 * identificador más— pero el diagnóstico se queda: cuando un envío falle,
 * lo primero que hay que saber es a qué identificador se estaba mandando y
 * qué dice WhatsApp de él. Adivinar eso en producción sale caro.
 *
 * No manda nada: es de solo lectura. La prueba de envío va aparte y se pide
 * explícitamente, porque esa sí le llega a alguien.
 */

export interface VarianteNumero {
  candidato: string;
  existeEnWhatsApp: boolean | null;
  /** El id que WhatsApp dice que es el bueno, que puede no ser el candidato. */
  idCanonico: string | null;
  /** Con Baileys no hace falta un chat previo para mandar un archivo. */
  chatExiste: boolean;
  error: string | null;
}

export interface DiagnosticoDestino {
  entrada: string;
  /** Los 10 dígitos finales, que es lo único estable entre formatos. */
  digitos: string | null;
  variantes: VarianteNumero[];
  /** Lo que se sabe del destino tal cual llegó. */
  chatOriginal: Record<string, unknown> | null;
  chatsQueCoinciden: string[];
}

/** Los últimos 10 dígitos: el número nacional, sin lada ni el "1" de más. */
function digitosNacionales(valor: string): string | null {
  const soloDigitos = valor.replace(/\D/g, '');
  return soloDigitos.length >= 10 ? soloDigitos.slice(-10) : null;
}

/**
 * Las formas en que un móvil mexicano puede aparecer en WhatsApp.
 *
 * WhatsApp usó `521` + 10 dígitos durante años y después empezó a devolver
 * `52` + 10 dígitos para las cuentas nuevas. Las dos siguen vivas, así que
 * probar solo una es apostar a ciegas.
 */
function variantesDe(digitos: string): string[] {
  return [`521${digitos}`, `52${digitos}`];
}

export async function diagnosticarDestino(
  sock: WASocket,
  entrada: string,
  yo: { id: string; lid: string | null } | null,
): Promise<DiagnosticoDestino> {
  const resultado: DiagnosticoDestino = {
    entrada,
    digitos: null,
    variantes: [],
    chatOriginal: null,
    chatsQueCoinciden: [],
  };

  const esLid = entrada.endsWith('@lid');

  resultado.chatOriginal = {
    tipo: esLid ? 'LID' : entrada.includes('@g.us') ? 'grupo' : 'número',
    // Con Baileys esto ya no es un obstáculo, y decirlo aquí evita que el
    // próximo que lea un fallo vuelva a sospechar del LID por costumbre.
    seLePuedeMandarArchivo: 'sí — Baileys direcciona por LID igual que por número',
    miJid: yo?.id ?? null,
    miLid: yo?.lid ?? null,
  };

  // De un LID no se puede sacar el teléfono: ese es justamente el punto del
  // LID. Si la entrada es un número, sus dígitos son la pista.
  resultado.digitos = esLid ? null : digitosNacionales(entrada);

  if (!resultado.digitos) return resultado;

  for (const candidato of variantesDe(resultado.digitos)) {
    const variante: VarianteNumero = {
      candidato: `${candidato}@c.us`,
      existeEnWhatsApp: null,
      idCanonico: null,
      // Baileys no exige chat previo: el envío no depende de esto.
      chatExiste: true,
      error: null,
    };

    try {
      const encontrados = await sock.onWhatsApp(candidato);
      const encontrado = encontrados?.[0];
      variante.existeEnWhatsApp = encontrado?.exists ?? false;
      variante.idCanonico = encontrado?.jid ?? null;
    } catch (err) {
      variante.error = String(err);
    }

    resultado.variantes.push(variante);
  }

  return resultado;
}

export interface PasoPrueba {
  paso: string;
  ok: boolean;
  detalle: string;
}

/**
 * Prueba de entrega: un texto y un archivo al mismo destino.
 *
 * Manda mensajes de verdad. Existe para comprobar de una vez, sin esperar a
 * que un cliente pida un documento, que el camino completo funciona.
 */
export async function probarEnvio(
  sock: WASocket,
  destino: string,
  base64: string,
  filename: string,
): Promise<PasoPrueba[]> {
  const pasos: PasoPrueba[] = [];
  const jid = destino.replace(/@c\.us$/, '@s.whatsapp.net');

  try {
    const res = await sock.sendMessage(jid, {
      text: 'Prueba de entrega, ignora este mensaje.',
    });
    pasos.push({
      paso: `texto a ${destino}`,
      ok: Boolean(res?.key?.id),
      detalle: res?.key?.id ?? 'sin id',
    });
  } catch (err) {
    pasos.push({ paso: `texto a ${destino}`, ok: false, detalle: String(err) });
    // Se sigue de todas formas: si el texto falla pero el archivo sale, eso
    // también es información, y es justo lo contrario de lo que se espera.
  }

  try {
    const bytes = Buffer.from(
      base64.replace(/^data:[^;]+;base64,/, ''),
      'base64',
    );

    const res = await sock.sendMessage(jid, {
      document: bytes,
      fileName: filename,
      mimetype: 'application/pdf',
      caption: 'Prueba de entrega.',
    });

    pasos.push({
      paso: `archivo a ${destino}`,
      ok: Boolean(res?.key?.id),
      detalle: res?.key?.id ?? 'sin id',
    });
  } catch (err) {
    pasos.push({ paso: `archivo a ${destino}`, ok: false, detalle: String(err) });
  }

  return pasos;
}
