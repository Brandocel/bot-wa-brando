/**
 * PORT hacia el modelo de lenguaje.
 *
 * Deliberadamente estrecho: dos métodos, y ninguno decide nada. El modelo
 * extrae datos de un texto y redacta un texto a partir de datos. Buscar,
 * autorizar, escalar y cerrar tickets siguen siendo código.
 *
 * Esa estrechez es la que hace que un prompt malicioso no pueda hacer daño:
 * no hay ninguna herramienta que el modelo pueda invocar desde aquí.
 */

/**
 * Para qué se llama al modelo. Cada tarea puede ir con un modelo distinto
 * (se elige en el panel): no todas pesan ni cuestan lo mismo.
 */
export type TareaLlm = 'conversacion' | 'redaccion' | 'clasificacion';

export interface LlmPort {
  /**
   * Devuelve un objeto que cumple el esquema, o null si no lo logró.
   * El null es parte del contrato: quien llama decide qué hacer, y lo que
   * hace es escalar a un humano, no adivinar.
   */
  extract<T>(input: {
    tarea: TareaLlm;
    system: string;
    user: string;
    schema: Record<string, unknown>;
    validate: (value: unknown) => T | null;
  }): Promise<T | null>;

  /** Redacta una respuesta corta a partir de datos ya resueltos. */
  draft(input: {
    tarea: TareaLlm;
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<string | null>;

  /**
   * Un turno con herramientas: el modelo decide cuáles usar y cuántas
   * veces, y termina con el texto para la persona. Las herramientas son
   * código nuestro (`ejecutar`): ahí viven permisos y entregas, y el
   * modelo solo ve lo que devuelven. null = el modelo no respondió.
   *
   * Opcional: un adaptador sin herramientas deja el flujo de siempre.
   */
  agente?(input: {
    tarea: TareaLlm;
    system: string;
    mensajes: ReadonlyArray<{ rol: 'cliente' | 'bot'; texto: string }>;
    herramientas: readonly HerramientaLlm[];
    ejecutar: (nombre: string, entrada: Record<string, unknown>) => Promise<string>;
    maxPasos?: number;
    /** Un modelo fijo en vez del que se eligió en el panel para la tarea (la demo pública va con uno barato). */
    modelo?: string;
  }): Promise<string | null>;
}

export interface HerramientaLlm {
  nombre: string;
  descripcion: string;
  /** JSON Schema de la entrada. */
  esquema: Record<string, unknown>;
}

export const LLM_PORT = Symbol('LlmPort');
