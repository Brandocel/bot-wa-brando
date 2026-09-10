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

export interface LlmPort {
  /**
   * Devuelve un objeto que cumple el esquema, o null si no lo logró.
   * El null es parte del contrato: quien llama decide qué hacer, y lo que
   * hace es escalar a un humano, no adivinar.
   */
  extract<T>(input: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
    validate: (value: unknown) => T | null;
  }): Promise<T | null>;

  /** Redacta una respuesta corta a partir de datos ya resueltos. */
  draft(input: {
    system: string;
    user: string;
    maxTokens?: number;
  }): Promise<string | null>;
}

export const LLM_PORT = Symbol('LlmPort');
