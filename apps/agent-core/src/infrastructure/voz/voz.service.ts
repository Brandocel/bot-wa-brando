import { Injectable, Logger } from '@nestjs/common';
import * as googleTts from 'google-tts-api';
import { config } from '../../config';

/** Tope de texto a voz: más largo que esto, se queda en texto. */
const MAX_VOZ_CHARS = 900;

/**
 * Voz del bot, con servicios gratuitos (versión beta):
 *
 * - Transcribir: Whisper en Groq (plan gratuito, GROQ_API_KEY). Sin llave
 *   no se transcribe y el bot pide el mensaje por escrito, como antes.
 * - Hablar: la voz de Google Translate, sin llave. Sale en MP3: llega como
 *   audio que se reproduce en el chat, no como nota de voz (eso exige
 *   OGG/Opus, que esta voz no da).
 *
 * Todo falla en silencio: sin voz, la respuesta sigue en texto.
 */
@Injectable()
export class VozService {
  private readonly logger = new Logger(VozService.name);

  get puedeTranscribir(): boolean {
    return config.groqApiKey !== null;
  }

  /** El texto de un audio, o null si no se pudo. */
  async transcribir(audio: { base64: string; mimetype: string }): Promise<string | null> {
    if (!config.groqApiKey) return null;
    try {
      const bytes = Buffer.from(audio.base64.replace(/^data:[^,]*,/, ''), 'base64');
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: audio.mimetype }), nombreDeArchivo(audio.mimetype));
      form.append('model', 'whisper-large-v3-turbo');
      form.append('language', 'es');
      form.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.groqApiKey}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.logger.warn(`transcripción falló: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const texto = ((await res.json()) as { text?: string }).text?.trim() ?? '';
      return texto || null;
    } catch (err) {
      this.logger.warn(`transcripción falló: ${String(err)}`);
      return null;
    }
  }

  /** El MP3 de un texto, o null si no se pudo o es demasiado largo. */
  async hablar(texto: string): Promise<Buffer | null> {
    const limpio = paraVoz(texto);
    if (!limpio || limpio.length > MAX_VOZ_CHARS) return null;
    try {
      const partes = await googleTts.getAllAudioBase64(limpio, {
        lang: 'es',
        slow: false,
        host: 'https://translate.google.com',
        splitPunct: ',.?!;:',
        timeout: 15_000,
      });
      return Buffer.concat(partes.map((p) => Buffer.from(p.base64, 'base64')));
    } catch (err) {
      this.logger.warn(`voz falló: ${String(err)}`);
      return null;
    }
  }
}

/**
 * Lo que se lee en voz alta: sin asteriscos de negrita, sin enlaces, y las
 * listas numeradas como frases ("1." se lee "uno").
 */
export function paraVoz(texto: string): string {
  return texto
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/^\s*[•\-]\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function nombreDeArchivo(mimetype: string): string {
  if (mimetype.includes('ogg')) return 'audio.ogg';
  if (mimetype.includes('webm')) return 'audio.webm';
  if (mimetype.includes('mp4') || mimetype.includes('m4a') || mimetype.includes('aac')) return 'audio.m4a';
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'audio.mp3';
  if (mimetype.includes('wav')) return 'audio.wav';
  return 'audio.ogg';
}
