import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import type { LlmPort } from '../../application/ports/llm.port';

/**
 * Esfuerzo bajo en todas las llamadas.
 *
 * Extraer tres campos o redactar dos frases no requiere razonar, y en los
 * modelos que piensan por defecto (Opus 5) el razonamiento también se
 * paga. Haiku 4.5 no acepta el parámetro: ahí no se manda.
 */
const ESFUERZO: { effort?: 'low' } = /haiku/i.test(config.llm.model)
  ? {}
  : { effort: 'low' };

/**
 * ADAPTER del LlmPort contra la API de Anthropic.
 *
 * Un fallo del modelo NUNCA tumba el turno: todo devuelve null y quien llama
 * escala a un humano. Un bot que revienta porque la API tardó es peor que un
 * bot que dice "déjame checarlo con el equipo".
 */
@Injectable()
export class AnthropicAdapter implements LlmPort {
  private readonly logger = new Logger(AnthropicAdapter.name);
  private client: Anthropic | null = null;

  private sdk(): Anthropic | null {
    if (!config.anthropicApiKey) return null;
    this.client ??= new Anthropic({ apiKey: config.anthropicApiKey });
    return this.client;
  }

  async extract<T>(input: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
    validate: (value: unknown) => T | null;
  }): Promise<T | null> {
    const client = this.sdk();
    if (!client) return null;

    // Un reintento y nada más. Si el modelo no produjo un objeto válido dos
    // veces seguidas, el tercero tampoco va a servir y cada intento cuesta
    // dinero y segundos que el cliente está esperando.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await client.messages.create({
          model: config.llm.model,
          max_tokens: 512,
          system: input.system,
          messages: [{ role: 'user', content: input.user }],
          output_config: {
            // El esquema lo impone el servidor: el modelo no puede devolver
            // otra forma, así que no hay que parsear texto libre ni rezar.
            format: { type: 'json_schema', schema: input.schema },
            // Esfuerzo bajo a propósito: sacar tres campos de una frase corta
            // no es un problema difícil, y del otro lado hay una persona
            // mirando "escribiendo..." en WhatsApp.
            ...ESFUERZO,
          },
        });

        const text = firstText(response);
        if (!text) continue;

        const parsed = input.validate(JSON.parse(text));
        if (parsed) return parsed;

        this.logger.warn(`extracción inválida en el intento ${attempt}`);
      } catch (err) {
        this.logger.warn(`extracción falló (intento ${attempt}): ${String(err)}`);
      }
    }

    return null;
  }

  async draft(input: {
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<string | null> {
    const client = this.sdk();
    if (!client) return null;

    try {
      const response = await client.messages.create({
        model: config.llm.model,
        max_tokens: input.maxTokens ?? 512,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
        // Esfuerzo bajo: redactar dos frases no requiere pensar, y en los
        // modelos que piensan por defecto el razonamiento también se paga.
        ...(Object.keys(ESFUERZO).length > 0 ? { output_config: ESFUERZO } : {}),
      });

      return firstText(response);
    } catch (err) {
      this.logger.warn(`redacción falló: ${String(err)}`);
      return null;
    }
  }
}

function firstText(response: Anthropic.Message): string | null {
  // stop_reason "refusal" trae content vacío: hay que mirarlo antes de leer.
  if (response.stop_reason === 'refusal') return null;

  for (const block of response.content) {
    if (block.type === 'text' && block.text.trim()) return block.text;
  }

  return null;
}
