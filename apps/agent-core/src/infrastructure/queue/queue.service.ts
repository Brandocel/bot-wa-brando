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

  /**
   * Varios trabajadores en paralelo, uno por mensaje.
   *
   * Con uno solo, diez personas escribiendo a la vez formaban fila: cada
   * turno tarda unos segundos (modelo, Drive) y la décima esperaba medio
   * minuto por una respuesta. Con varios, cada chat va por su lado. La
   * serialización DENTRO de un chat no depende de esto: la da el advisory
   * lock de PrismaService.withChatLock, así que dos mensajes de la misma
   * persona nunca se procesan cruzados aunque haya trabajadores libres.
   *
   * Se llama a `work` varias veces (y no batchSize > 1) para que cada
   * trabajo se complete o falle por su cuenta: en un lote, un fallo
   * reintentaría también los que sí salieron bien.
   */
  async workIncoming(handler: (job: IncomingJob) => Promise<void>): Promise<void> {
    for (let i = 0; i < config.queue.workers; i++) {
      await this.boss.work<IncomingJob>(
        INCOMING_QUEUE,
        { batchSize: 1 },
        async (jobs) => {
          for (const job of jobs) {
            await handler(job.data);
          }
        },
      );
    }
  }
}
