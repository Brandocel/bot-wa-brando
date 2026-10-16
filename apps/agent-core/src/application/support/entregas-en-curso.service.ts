import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/** Qué tan atrás se mira: una entrega de ayer ya no es "lo que va saliendo". */
const VENTANA_MS = 2 * 60 * 60 * 1000;

export interface EstadoEntregas {
  /** Encolados que todavía no salen. */
  pendientes: string[];
  /** Ya salieron en la ventana. */
  enviados: string[];
  /** Se rindió con ellos. */
  fallidos: string[];
}

/**
 * Las entregas de documentos de un chat, tal como están en el outbox.
 *
 * Es lo que permite contestar "¿cómo va?" con la verdad: cuántos salieron,
 * cuántos faltan y cuáles no se pudieron mandar. El modelo nunca contesta
 * esto; antes inventaba "ya van en camino" sin que hubiera nada en cola.
 */
@Injectable()
export class EntregasEnCursoService {
  constructor(private readonly prisma: PrismaService) {}

  async estado(chatId: string): Promise<EstadoEntregas> {
    const filas = await this.prisma.outboxMessage.findMany({
      where: {
        chatId,
        createdAt: { gte: new Date(Date.now() - VENTANA_MS) },
        payload: { path: ['kind'], equals: 'file' },
      },
      orderBy: { createdAt: 'asc' },
      select: { status: true, payload: true },
    });

    const estado: EstadoEntregas = { pendientes: [], enviados: [], fallidos: [] };
    for (const f of filas) {
      const nombre = String((f.payload as { filename?: unknown }).filename ?? 'documento');
      if (f.status === 'SENT') estado.enviados.push(nombre);
      else if (f.status === 'FAILED') estado.fallidos.push(nombre);
      else estado.pendientes.push(nombre);
    }
    return estado;
  }
}
