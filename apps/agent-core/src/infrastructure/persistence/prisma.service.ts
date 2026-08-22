import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatId})::bigint)`;
      return fn(tx);
    });
  }
}
