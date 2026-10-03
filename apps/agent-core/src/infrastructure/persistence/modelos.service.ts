import { Injectable } from '@nestjs/common';
import type { TareaLlm } from '../../application/ports/llm.port';
import { FlagsService } from './flags.service';

/**
 * Qué modelo de Anthropic usa cada tarea, configurable desde el panel.
 *
 * Por tarea y no uno solo porque no cuestan lo mismo ni pesan lo mismo:
 * entender y redactar pasa en CADA mensaje, así que ahí se nota el precio;
 * clasificar pasa una vez por archivo, y equivocarse ahí (dar por
 * entregable algo sensible) sale más caro que el modelo.
 */
export interface Modelos {
  /** Entender el mensaje del cliente: qué documento, de qué mes, qué folio. */
  conversacion: string;
  /** Redactar la respuesta en lenguaje natural. */
  redaccion: string;
  /** Clasificar cada archivo que sube el conector o Drive. */
  clasificacion: string;
}

export interface ModeloDisponible {
  id: string;
  nombre: string;
  /** Precio de lista en USD por millón de tokens de entrada / salida. */
  entrada: number;
  salida: number;
  descripcion: string;
}

/** Solo estos se dejan elegir: un id mal escrito dejaría al bot sin IA. */
export const MODELOS_DISPONIBLES: ModeloDisponible[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    nombre: 'Haiku 4.5',
    entrada: 1,
    salida: 5,
    descripcion: 'El más barato y rápido. Suficiente para entender pedidos y redactar respuestas cortas.',
  },
  {
    id: 'claude-sonnet-5-5',
    nombre: 'Sonnet 5.5',
    entrada: 2,
    salida: 10,
    descripcion: 'Equilibrio. Entiende mejor los mensajes mal escritos o ambiguos.',
  },
  {
    id: 'claude-opus-5-5',
    nombre: 'Opus 5.5',
    entrada: 4,
    salida: 20,
    descripcion: 'El más capaz y el más caro. Rara vez hace falta para esto.',
  },
];

/**
 * La conversación de venta razona (qué pidió, qué ya se sabe, qué regla
 * aplica): con Haiku confundía preguntar con pedir. Lo que se elija en el
 * panel manda sobre esto.
 */
export const MODELOS_DEFECTO: Modelos = {
  conversacion: 'claude-sonnet-5-5',
  redaccion: 'claude-haiku-4-5-20251001',
  clasificacion: 'claude-sonnet-5-5',
};

const CLAVE = 'modelos';
const TAREAS: TareaLlm[] = ['conversacion', 'redaccion', 'clasificacion'];

@Injectable()
export class ModelosService {
  constructor(private readonly flags: FlagsService) {}

  async actuales(): Promise<Modelos> {
    const guardados = await this.flags.get<Partial<Modelos>>(CLAVE, {});
    return normalizar({ ...MODELOS_DEFECTO, ...(guardados ?? {}) });
  }

  async para(tarea: TareaLlm): Promise<string> {
    return (await this.actuales())[tarea];
  }

  /** Guarda lo que venga; lo que no sea un modelo de la lista se ignora. */
  async guardar(parcial: Partial<Modelos>): Promise<Modelos> {
    const nuevos = normalizar({ ...(await this.actuales()), ...parcial });
    await this.flags.set(CLAVE, nuevos);
    return nuevos;
  }
}

export function esModeloValido(id: unknown): id is string {
  return MODELOS_DISPONIBLES.some((m) => m.id === id);
}

function normalizar(m: Modelos): Modelos {
  const salida = { ...MODELOS_DEFECTO };
  for (const tarea of TAREAS) {
    if (esModeloValido(m[tarea])) salida[tarea] = m[tarea];
  }
  return salida;
}
