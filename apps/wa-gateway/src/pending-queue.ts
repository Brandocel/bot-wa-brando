import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cola en disco para mensajes que el core no pudo recibir.
 *
 * El core se reinicia en cada despliegue, y son unos treinta segundos en los
 * que no acepta nada. Con solo tres reintentos en memoria, todo lo que
 * llegue en esa ventana se pierde — y "se perdió tu mensaje" es exactamente
 * el fallo que un bot de soporte no se puede permitir: el cliente no sabe
 * que tiene que repetirlo.
 *
 * Va a disco y no a memoria porque el gateway también se reinicia, y una
 * cola en RAM se evapora justo cuando más falta hace. El disco persistente
 * ya existe: es donde vive la sesión de WhatsApp.
 *
 * Un archivo por mensaje, con el id de WhatsApp como nombre. Sin base de
 * datos y sin librería: son unas decenas de mensajes en el peor caso, y el
 * core descarta duplicados por su propia idempotencia, así que reenviar de
 * más es inofensivo.
 */

const MAX_INTENTOS = 60; // ~30 min a un reintento cada 30 s

interface Pendiente {
  id: string;
  payload: unknown;
  intentos: number;
  primeraVez: number;
}

export class PendingQueue {
  constructor(private readonly dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** Nombre de archivo seguro: el id de WhatsApp trae barras y otros signos. */
  private file(id: string): string {
    return join(this.dir, `${Buffer.from(id).toString('base64url')}.json`);
  }

  save(id: string, payload: unknown, intentos = 0): void {
    const registro: Pendiente = {
      id,
      payload,
      intentos,
      primeraVez: Date.now(),
    };

    try {
      writeFileSync(this.file(id), JSON.stringify(registro));
    } catch (err) {
      // Si ni siquiera se puede escribir en disco, no hay nada más que
      // hacer salvo dejar constancia: perder el mensaje en silencio sería
      // peor que perderlo con un log.
      console.error(`[cola] no se pudo guardar ${id}:`, err);
    }
  }

  remove(id: string): void {
    try {
      unlinkSync(this.file(id));
    } catch {
      // Ya no estaba. Es lo normal cuando dos barridos coinciden.
    }
  }

  list(): Pendiente[] {
    let archivos: string[];

    try {
      archivos = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }

    const pendientes: Pendiente[] = [];

    for (const archivo of archivos) {
      try {
        const raw = readFileSync(join(this.dir, archivo), 'utf8');
        pendientes.push(JSON.parse(raw) as Pendiente);
      } catch {
        // Archivo corrupto (por ejemplo, un corte a media escritura).
        // Se descarta: un mensaje ilegible no se vuelve legible solo.
        try {
          unlinkSync(join(this.dir, archivo));
        } catch {
          /* nada que hacer */
        }
      }
    }

    // Más viejo primero: el orden en que llegaron es el orden en que la
    // persona los escribió, y contestarlos al revés es desconcertante.
    return pendientes.sort((a, b) => a.primeraVez - b.primeraVez);
  }

  /** true si ya no vale la pena seguir intentando. */
  agotado(pendiente: Pendiente): boolean {
    return pendiente.intentos >= MAX_INTENTOS;
  }
}
