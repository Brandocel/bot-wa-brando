import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HandleIncomingMessageUseCase } from '../../application/use-cases/handle-incoming-message.use-case';
import { QueueService } from './queue.service';

/**
 * Consumidor. Nest inicializa QueueService antes que esto por la dependencia,
 * así que la cola ya está arriba cuando registramos el worker.
 */
@Injectable()
export class MessageWorker implements OnModuleInit {
  private readonly logger = new Logger(MessageWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly useCase: HandleIncomingMessageUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.workIncoming(async (job) => {
      try {
        await this.useCase.execute(job.raw);
      } catch (err) {
        // Se relanza a propósito: que pg-boss lo reintente con backoff.
        this.logger.error(`fallo procesando job: ${String(err)}`);
        throw err;
      }
    });

    this.logger.log('worker escuchando mensajes entrantes');
  }
}
