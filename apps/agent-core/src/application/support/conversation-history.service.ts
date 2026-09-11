import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/**
 * Los últimos mensajes del hilo, listos para meterlos en un prompt.
 *
 * Es la "memoria de conversación" que el modelo SÍ recibe. Los slots del
 * ticket siguen siendo la verdad sobre la solicitud —qué documento, de qué
 * mes, de qué empresa—; esto es lo otro: qué se dijo, en qué orden, y qué
 * contestó el bot. Sin esto el modelo saluda dos veces, pregunta lo que la
 * persona acaba de decir y redacta cada turno como si fuera el primero.
 *
 * Ventana corta a propósito. Mandarle cuarenta mensajes es la causa número
 * uno de que un bot se pierda, y cada turno costaría más que el anterior.
 */

/** Cuántos mensajes hacia atrás se le enseñan al modelo. */
const VENTANA = 8;

/** Más viejo que esto ya no es la misma conversación, aunque sea el mismo chat. */
const VIGENCIA_MS = 6 * 60 * 60 * 1000;

/** Un mensaje muy largo se recorta: el modelo no necesita el texto entero. */
const MAX_CHARS = 160;

export interface HistoryTurn {
  role: 'cliente' | 'bot';
  text: string;
  at: Date;
}

@Injectable()
export class ConversationHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Los mensajes recientes en orden cronológico, sin el que se está
   * atendiendo ahora mismo: ese ya va aparte como "el último mensaje".
   */
  async recent(
    conversationId: string,
    options: { excludeId?: string } = {},
  ): Promise<HistoryTurn[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        createdAt: { gte: new Date(Date.now() - VIGENCIA_MS) },
        ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: VENTANA,
      select: { direction: true, body: true, createdAt: true },
    });

    return rows
      .reverse()
      .filter((row) => row.body.trim() !== '')
      .map((row) => ({
        role: row.direction === 'IN' ? 'cliente' : 'bot',
        text: recortar(row.body),
        at: row.createdAt,
      }));
  }
}

/**
 * El historial como bloque de texto para un prompt.
 *
 * Las URL se quitan: el enlace de descarga de una entrega anterior no le
 * sirve al modelo para nada y, si lo copiara en una respuesta, estaría
 * repartiendo un enlace que probablemente ya venció.
 */
export function formatHistory(turns: readonly HistoryTurn[]): string {
  if (turns.length === 0) return '(sin mensajes anteriores)';

  return turns
    .map((t) => `${t.role === 'cliente' ? 'Cliente' : 'Bot'}: ${sinUrls(t.text)}`)
    .join('\n');
}

function recortar(text: string): string {
  const limpio = text.replace(/\s+/g, ' ').trim();
  return limpio.length > MAX_CHARS ? `${limpio.slice(0, MAX_CHARS)}…` : limpio;
}

function sinUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '[enlace]');
}
