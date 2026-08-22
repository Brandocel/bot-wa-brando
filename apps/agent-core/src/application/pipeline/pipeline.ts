import type { IncomingMessage, Role } from '../../domain/message/incoming-message';

/**
 * Chain of Responsibility.
 *
 * El 80% de los bugs de un bot son "respondió cuando no debía". Cada regla
 * vive en un eslabón con una sola responsabilidad, y un eslabón que decide
 * cortar simplemente no llama a next().
 */

export interface PipelineContext {
  readonly message: IncomingMessage;
  role: Role | null;
  /** Nombre del filtro que cortó la cadena, si alguno lo hizo. */
  stoppedBy: string | null;
  stopReason: string | null;
}

export type Next = () => Promise<void>;

export interface MessageFilter {
  readonly name: string;
  handle(ctx: PipelineContext, next: Next): Promise<void>;
}

export function stop(
  ctx: PipelineContext,
  filterName: string,
  reason: string,
): void {
  ctx.stoppedBy = filterName;
  ctx.stopReason = reason;
}

/**
 * Compone los filtros y ejecuta. `terminal` solo corre si nadie cortó.
 * El orden importa: de más barato a más caro (los que solo miran el payload
 * antes de los que pegan a la base o al LLM).
 */
export async function runPipeline(
  filters: readonly MessageFilter[],
  message: IncomingMessage,
  terminal: (ctx: PipelineContext) => Promise<void>,
): Promise<PipelineContext> {
  const ctx: PipelineContext = {
    message,
    role: null,
    stoppedBy: null,
    stopReason: null,
  };

  let index = -1;

  const dispatch = async (i: number): Promise<void> => {
    if (i <= index) throw new Error('next() llamado dos veces en el pipeline');
    index = i;

    if (i === filters.length) {
      await terminal(ctx);
      return;
    }

    const filter = filters[i]!;
    await filter.handle(ctx, () => dispatch(i + 1));
  };

  await dispatch(0);
  return ctx;
}
