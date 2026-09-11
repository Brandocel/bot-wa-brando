import type { Client } from '@open-wa/wa-automate';

/**
 * Diagnóstico de direccionamiento.
 *
 * El envío de archivos falla y las hipótesis son varias: el "1" mexicano del
 * identificador, el direccionamiento por LID, o que open-wa exija un chat
 * abierto bajo el `@c.us`. Adivinar cuál es sale caro — cada intento es un
 * despliegue y un mensaje real a una persona real.
 *
 * Esto pregunta las tres cosas de una vez y devuelve lo que WhatsApp
 * contesta, sin interpretarlo. Lo que se decida después se decide sobre
 * datos, no sobre lo que creemos que hace la librería.
 *
 * No manda nada: es de solo lectura. La prueba de envío va aparte y se pide
 * explícitamente, porque esa sí le llega a alguien.
 */

export interface VarianteNumero {
  candidato: string;
  existeEnWhatsApp: boolean | null;
  /** El id que WhatsApp dice que es el bueno, que puede no ser el candidato. */
  idCanonico: string | null;
  /** ¿Hay un chat guardado con este id? Es lo que open-wa exige para media. */
  chatExiste: boolean;
  error: string | null;
}

export interface DiagnosticoDestino {
  entrada: string;
  /** Los 10 dígitos finales, que es lo único estable entre formatos. */
  digitos: string | null;
  variantes: VarianteNumero[];
  /** Lo que cuelga del chat LID: de aquí sale el teléfono real, si sale. */
  chatOriginal: Record<string, unknown> | null;
  /** Chats abiertos cuyo id termina en los mismos 10 dígitos. */
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
  return [`521${digitos}@c.us`, `52${digitos}@c.us`];
}

async function serializar(valor: unknown): Promise<Record<string, unknown> | null> {
  if (!valor || typeof valor !== 'object') return null;

  // El objeto de open-wa trae el árbol entero del contacto; aquí solo
  // interesa lo que identifica el destino.
  const c = valor as Record<string, unknown>;
  const contacto = (c.contact ?? {}) as Record<string, unknown>;

  return {
    id: JSON.stringify(c.id ?? null),
    contactoId: JSON.stringify(contacto.id ?? null),
    phoneNumber: contacto.phoneNumber ?? null,
    isMyContact: contacto.isMyContact ?? null,
    isBusiness: contacto.isBusiness ?? null,
    formattedName: contacto.formattedName ?? null,
  };
}

export async function diagnosticarDestino(
  client: Client,
  entrada: string,
): Promise<DiagnosticoDestino> {
  const resultado: DiagnosticoDestino = {
    entrada,
    digitos: null,
    variantes: [],
    chatOriginal: null,
    chatsQueCoinciden: [],
  };

  // Del chat original salen dos cosas: el teléfono real (que el LID no
  // contiene) y la pista de si open-wa resuelve el contacto o no.
  try {
    const chat = await client.getChatById(entrada as never);
    resultado.chatOriginal = await serializar(chat);
  } catch (err) {
    resultado.chatOriginal = { error: String(err) };
  }

  const desdeChat =
    typeof resultado.chatOriginal?.phoneNumber === 'string'
      ? resultado.chatOriginal.phoneNumber
      : null;

  resultado.digitos =
    digitosNacionales(entrada.endsWith('@lid') ? (desdeChat ?? '') : entrada) ??
    digitosNacionales(desdeChat ?? '');

  if (!resultado.digitos) return resultado;

  for (const candidato of variantesDe(resultado.digitos)) {
    const variante: VarianteNumero = {
      candidato,
      existeEnWhatsApp: null,
      idCanonico: null,
      chatExiste: false,
      error: null,
    };

    try {
      const estado = (await client.checkNumberStatus(candidato as never)) as {
        numberExists?: boolean;
        id?: { _serialized?: string } | string;
      } | null;

      variante.existeEnWhatsApp = estado?.numberExists ?? false;
      variante.idCanonico =
        typeof estado?.id === 'string' ? estado.id : (estado?.id?._serialized ?? null);
    } catch (err) {
      variante.error = String(err);
    }

    // La comprobación que de verdad importa: open-wa rechaza el archivo si
    // no encuentra un chat guardado con ese id, diga lo que diga el número.
    try {
      const chat = await client.getChatById(candidato as never);
      variante.chatExiste = Boolean(chat);
    } catch {
      variante.chatExiste = false;
    }

    resultado.variantes.push(variante);
  }

  try {
    const chats = (await client.getAllChatIds()) as unknown as string[];
    resultado.chatsQueCoinciden = chats.filter((id) =>
      String(id).includes(resultado.digitos as string),
    );
  } catch {
    // Sin la lista de chats el diagnóstico sigue sirviendo; es un extra.
  }

  return resultado;
}

export interface PasoPrueba {
  paso: string;
  ok: boolean;
  detalle: string;
}

/**
 * La secuencia que open-wa pide por escrito.
 *
 * Su error es literal: "Start a chat with sendText with this contact before
 * trying to send media". Hasta ahora el texto se mandaba al chat LID, que es
 * otro id, así que nunca se creó el chat bajo el `@c.us` que el archivo
 * necesita. Esto lo hace en el orden que la librería exige y reporta cada
 * paso por separado, para saber cuál es el que rompe.
 */
export async function probarEnvio(
  client: Client,
  destino: string,
  base64: string,
  filename: string,
): Promise<PasoPrueba[]> {
  const pasos: PasoPrueba[] = [];

  try {
    const id = await client.sendText(destino as never, 'Prueba de entrega, ignora este mensaje.');
    pasos.push({ paso: `sendText a ${destino}`, ok: true, detalle: String(id) });
  } catch (err) {
    pasos.push({ paso: `sendText a ${destino}`, ok: false, detalle: String(err) });
    // Se sigue de todas formas: si el texto falla pero el archivo sale, eso
    // también es información, y es justo lo contrario de lo que se espera.
  }

  try {
    const id = await client.sendFile(
      destino as never,
      base64,
      filename,
      'Prueba de entrega.',
      undefined as never,
      true,
    );
    const ok = id !== false && !String(id).startsWith('ERROR');
    pasos.push({ paso: `sendFile a ${destino}`, ok, detalle: String(id) });
  } catch (err) {
    pasos.push({ paso: `sendFile a ${destino}`, ok: false, detalle: String(err) });
  }

  return pasos;
}
