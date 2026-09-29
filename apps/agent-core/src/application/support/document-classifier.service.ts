import { Inject, Injectable } from '@nestjs/common';
import { config } from '../../config';
import { LLM_PORT, type LlmPort } from '../ports/llm.port';
import {
  Respuesta,
  SCHEMA,
  SYSTEM,
  decidir,
  describir,
  porReglas,
  type ArchivoAClasificar,
  type Clasificacion,
} from './document-classification';

/**
 * Clasificador de archivos: el modelo cuando lo hay, las reglas cuando no.
 * Las decisiones viven en document-classification.ts; aquí solo se llama.
 */
@Injectable()
export class DocumentClassifierService {
  constructor(@Inject(LLM_PORT) private readonly llm: LlmPort) {}

  /** ¿Hay modelo? Sin él se clasifica por reglas y lo dudoso espera revisión. */
  get conModelo(): boolean {
    return Boolean(config.anthropicApiKey);
  }

  /**
   * null = el modelo está configurado pero no contestó. No es lo mismo que
   * "no sé": quien llama deja el archivo sin clasificar para reintentarlo.
   */
  async clasificar(archivo: ArchivoAClasificar): Promise<Clasificacion | null> {
    if (!this.conModelo) return porReglas(archivo);

    const respuesta = await this.llm.extract({
      system: SYSTEM,
      user: describir(archivo),
      schema: SCHEMA,
      validate: (value) => {
        const parsed = Respuesta.safeParse(value);
        return parsed.success ? parsed.data : null;
      },
    });
    if (!respuesta) return null;

    return decidir(archivo, respuesta);
  }
}

