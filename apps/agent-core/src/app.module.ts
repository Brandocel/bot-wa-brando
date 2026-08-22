import { Module } from '@nestjs/common';

import { AuthorizationFilter } from './application/pipeline/filters/authorization.filter';
import { IdempotencyFilter } from './application/pipeline/filters/idempotency.filter';
import { KillSwitchFilter } from './application/pipeline/filters/kill-switch.filter';
import { LoopGuardFilter } from './application/pipeline/filters/loop-guard.filter';
import { RateLimitFilter } from './application/pipeline/filters/rate-limit.filter';
import { OwnerCommandsService } from './application/commands/owner-commands.service';
import { SourceFilter } from './application/pipeline/filters/source.filter';
import { MESSAGING_PORT } from './application/ports/messaging.port';
import { HandleIncomingMessageUseCase } from './application/use-cases/handle-incoming-message.use-case';

import { HealthController } from './infrastructure/http/health.controller';
import { WaWebhookController } from './infrastructure/http/wa-webhook.controller';
import { OutboxDispatcher } from './infrastructure/persistence/outbox.dispatcher';
import { FlagsService } from './infrastructure/persistence/flags.service';
import { PrismaService } from './infrastructure/persistence/prisma.service';
import { MessageWorker } from './infrastructure/queue/message.worker';
import { QueueService } from './infrastructure/queue/queue.service';
import { GatewayMessagingAdapter } from './infrastructure/whatsapp/gateway-messaging.adapter';
import { OpenWaMessageMapper } from './infrastructure/whatsapp/open-wa.mapper';

@Module({
  controllers: [HealthController, WaWebhookController],
  providers: [
    // ── Infraestructura ────────────────────────────────────────────────
    PrismaService,
    FlagsService,
    QueueService,
    MessageWorker,
    OutboxDispatcher,
    OpenWaMessageMapper,

    // Aquí, y solo aquí, se decide con qué se habla WhatsApp.
    // Migrar a Baileys = cambiar esta línea.
    { provide: MESSAGING_PORT, useClass: GatewayMessagingAdapter },

    // ── Pipeline ───────────────────────────────────────────────────────
    SourceFilter,
    IdempotencyFilter,
    LoopGuardFilter,
    AuthorizationFilter,
    KillSwitchFilter,
    RateLimitFilter,

    // ── Casos de uso ───────────────────────────────────────────────────
    OwnerCommandsService,
    HandleIncomingMessageUseCase,
  ],
})
export class AppModule {}
