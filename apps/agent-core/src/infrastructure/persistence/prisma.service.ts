import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * El cliente que Prisma entrega dentro de `$transaction`.
 *
 * Tiene nombre propio porque hace falta pasarlo entre servicios: escribir
 * con `this.prisma` mientras hay una transacción abierta usa OTRA conexión,
 * que no ve lo que la transacción todavía no ha confirmado.
 */
export type TransactionClient = Parameters<
  Parameters<PrismaClient['$transaction']>[0]
>[0];

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Serializa el procesamiento por chat usando un advisory lock de Postgres.
   *
   * La cola sola no garantiza esto: dos workers pueden tomar dos mensajes del
   * mismo chat a la vez y responder cruzado. El lock es por transacción, así
   * que se libera solo — incluso si el handler truena.
   */
  async withChatLock<T>(
    chatId: string,
    fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatId})::bigint)`;
        return fn(tx);
      },
      {
        // El turno llama al LLM y descarga de Drive dentro del lock, y eso
        // pasa de largo los 5 s que Prisma da por defecto: la transacción se
        // aborta a media respuesta.
        //
        // Se sube el tope en vez de sacar la red del lock porque el lock ES
        // la garantía de que dos mensajes del mismo chat no se contesten
        // cruzados. El costo es una conexión ocupada mientras se piensa la
        // respuesta; con una línea de WhatsApp eso sobra. Si algún día hay
        // muchas conversaciones a la vez, lo que toca es sacar la generación
        // de la respuesta fuera de la transacción, no subir más este número.
        timeout: 60_000,
        maxWait: 10_000,
      },
    );
  }
}
