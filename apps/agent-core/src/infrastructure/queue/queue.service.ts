import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import PgBoss from 'pg-boss';
import { config } from '../../config';

export const INCOMING_QUEUE = 'incoming-message';

export interface IncomingJob {
  /** Payload crudo de open-wa. Se mapea en el worker, no aquí. */
  raw: Record<string, unknown>;
}

/**
 * Cola sobre Postgres (pg-boss) en vez de Redis.
 *
 * No es solo por ahorrarse los $10/mes del Key Value de Render: encolar el
 * job y escribir el outbox ocurren contra la MISMA base, así que pueden ir
 * en una sola transacción. Con Redis serían dos sistemas que se desincronizan.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private boss!: PgBoss;

  async onModuleInit(): Promise<void> {
    this.boss = new PgBoss({
      connectionString: config.databaseUrl,
      // Render Postgres Basic da 100 conexiones y Prisma ya usa varias.
      max: 3,
    });

    this.boss.on('error', (err) => this.logger.error(`pg-boss: ${String(err)}`));

    await this.boss.start();
    await this.boss.createQueue(INCOMING_QUEUE);

    this.logger.log('cola lista');
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true });
  }

  async enqueueIncoming(job: IncomingJob): Promise<string | null> {
    return this.boss.send(INCOMING_QUEUE, job, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      // Si un mensaje lleva 10 min sin procesarse, ya no sirve contestarlo.
      expireInMinutes: 10,
    });
  }

  async workIncoming(handler: (job: IncomingJob) => Promise<void>): Promise<void> {
    await this.boss.work<IncomingJob>(
      INCOMING_QUEUE,
      { batchSize: 1 },
      async (jobs) => {
        // pg-boss entrega un array; la serialización real por chat la da el
        // advisory lock de PrismaService.withChatLock, no el batchSize.
        for (const job of jobs) {
          await handler(job.data);
        }
      },
    );
  }
}
