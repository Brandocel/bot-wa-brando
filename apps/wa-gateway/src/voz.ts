import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

/**
 * Voz local y gratuita (ver la etapa "voz" del Dockerfile):
 *
 * - Escuchar: whisper.cpp con el modelo base, en español.
 * - Hablar: Piper con una voz de México.
 * - ffmpeg convierte entre la nota de voz de WhatsApp (OGG/Opus) y el WAV
 *   que entienden los dos.
 *
 * Sin los binarios (en desarrollo, fuera de la imagen) todo devuelve null
 * y el core sigue como si no hubiera voz.
 */
const DIR = process.env.VOZ_DIR ?? '/opt/voz';
const WHISPER = join(DIR, 'whisper-cli');
const MODELO = join(DIR, 'whisper.bin');
const PIPER = join(DIR, 'piper', 'piper');
const VOZ = join(DIR, 'voz.onnx');

const CONTEXTO =
  'Mensaje de voz por WhatsApp, español de México. Hola, buen día, buenas tardes, gracias. ' +
  'Mándame la factura, el contrato, la constancia de alta, la baja, el finiquito, el recibo de nómina, ' +
  'el pedido, de octubre, de este mes.';

/** Tope de texto a voz: más largo, se queda en texto. */
const MAX_VOZ_CHARS = 900;
const HILOS = String(Math.max(1, Math.min(4, cpus().length)));

export const puedeEscuchar = (): boolean => existsSync(WHISPER) && existsSync(MODELO);
export const puedeHablar = (): boolean => existsSync(PIPER) && existsSync(VOZ);

/** Una sola tarea pesada a la vez: el servidor tiene un CPU y también atiende WhatsApp. */
let cola: Promise<unknown> = Promise.resolve();
function enFila<T>(tarea: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(tarea, tarea);
  cola = siguiente.catch(() => undefined);
  return siguiente;
}

async function conCarpeta<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'voz-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** El texto de una nota de voz, o null si no se pudo. */
/**
 * Limpieza antes de transcribir: fuera graves (golpes, viento) y agudos
 * que no son voz, menos ruido de fondo y volumen parejo. Las notas de voz
 * de WhatsApp vienen de la calle, del coche, de la oficina.
 */
// Medio segundo de silencio al inicio y uno y medio al final: sin silencio
// después de la última palabra, Whisper la deja a medias ("de…") porque
// la gente suelta el botón justo al terminar de hablar.
const LIMPIEZA =
  'highpass=f=80,lowpass=f=7600,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,' +
  'adelay=500:all=1,apad=pad_dur=1.5';

/**
 * El texto de una nota de voz, o null si no se pudo. `pistas` son nombres
 * y palabras de esa cuenta (titulares, empresas, productos): con ellas el
 * modelo "oye" bien "Abner Neftali" en vez de "a ver nefalí".
 */
export async function transcribir(audio: Buffer, pistas = ''): Promise<string | null> {
  if (!puedeEscuchar()) return null;
  try {
    return await enFila(() =>
      conCarpeta(async (dir) => {
        const entrada = join(dir, 'entrada');
        const wav = join(dir, 'audio.wav');
        await writeFile(entrada, audio);
        // Whisper quiere WAV de 16 kHz, mono.
        await ejecutar(
          'ffmpeg',
          ['-y', '-loglevel', 'error', '-i', entrada, '-af', LIMPIEZA, '-ar', '16000', '-ac', '1', '-f', 'wav', wav],
          { timeout: 30_000 },
        );
        // Whisper toma solo el final del contexto si es largo: las pistas
        // de la cuenta van al final, que es lo que más pesa.
        const contexto = `${CONTEXTO} ${pistas}`.replace(/\s+/g, ' ').trim().slice(-800);
        const { stdout } = await ejecutar(
          WHISPER,
          // El contexto inicial orienta al modelo: frases cortas de WhatsApp
          // ("buen día") y palabras del negocio que oye seguido.
          // Búsqueda con 5 candidatos: más lenta, bastante más acertada.
          ['-m', MODELO, '-f', wav, '-l', 'es', '-t', HILOS, '-nt', '-np', '-bs', '5', '-bo', '5', '--prompt', contexto],
          { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
        );
        const texto = stdout.replace(/\s+/g, ' ').trim();
        // Whisper marca el silencio o la música así: no es algo que se dijo.
        return texto && !/^\[(?:blank_audio|music|silencio|música)\]$/i.test(texto) ? texto : null;
      }),
    );
  } catch (err) {
    console.error(`[voz] no se pudo transcribir: ${String(err)}`);
    return null;
  }
}

/** Una nota de voz (OGG/Opus, como las de WhatsApp) con el texto, o null. */
export async function hablar(texto: string): Promise<Buffer | null> {
  const limpio = paraVoz(texto);
  if (!puedeHablar() || !limpio || limpio.length > MAX_VOZ_CHARS) return null;
  try {
    return await enFila(() =>
      conCarpeta(async (dir) => {
        const wav = join(dir, 'voz.wav');
        const ogg = join(dir, 'voz.ogg');
        await new Promise<void>((resolve, reject) => {
          // Piper trae sus librerías y espeak-ng-data junto al binario.
          const p = spawn(PIPER, ['--model', VOZ, '--output_file', wav, '--espeak_data', join(DIR, 'piper', 'espeak-ng-data')], {
            stdio: ['pipe', 'ignore', 'pipe'],
            env: { ...process.env, LD_LIBRARY_PATH: join(DIR, 'piper') },
          });
          let error = '';
          p.stderr.on('data', (d: Buffer) => (error += d.toString()));
          p.on('error', reject);
          p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper salió con ${code}: ${error.slice(-300)}`))));
          const t = setTimeout(() => p.kill('SIGKILL'), 60_000);
          p.on('close', () => clearTimeout(t));
          p.stdin.end(limpio.replace(/\n+/g, '. '));
        });
        await ejecutar(
          'ffmpeg',
          ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip', ogg],
          { timeout: 30_000 },
        );
        return readFile(ogg);
      }),
    );
  } catch (err) {
    console.error(`[voz] no se pudo sintetizar: ${String(err)}`);
    return null;
  }
}

/** Lo que se lee en voz alta: sin negritas, viñetas ni enlaces. */
export function paraVoz(texto: string): string {
  return texto
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/^\s*[•\-]\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
