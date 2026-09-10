import { Module } from '@nestjs/common';

import { AuthorizationFilter } from './application/pipeline/filters/authorization.filter';
import { IdempotencyFilter } from './application/pipeline/filters/idempotency.filter';
import { KillSwitchFilter } from './application/pipeline/filters/kill-switch.filter';
import { LoopGuardFilter } from './application/pipeline/filters/loop-guard.filter';
import { RateLimitFilter } from './application/pipeline/filters/rate-limit.filter';
import { DriveCommandsService } from './application/commands/drive-commands.service';
import { OwnerCommandsService } from './application/commands/owner-commands.service';
import { SourceFilter } from './application/pipeline/filters/source.filter';
import { AccessScopeService } from './application/support/access-scope.service';
import { ConversationStateService } from './application/support/conversation-state.service';
import { DirectoryService } from './application/support/directory.service';
import { DocumentDeliveryService } from './application/support/document-delivery.service';
import { DriveSyncService } from './application/support/drive-sync.service';
import { SlotExtractorService } from './application/support/slot-extractor.service';
import { SupportStrategy } from './application/support/support.strategy';
import { DocumentSearchService } from './application/support/document-search.service';
import { SupportCommandsService } from './application/support/support-commands.service';
import { TicketService } from './application/support/ticket.service';
import { DOCUMENT_SOURCE_PORT } from './application/ports/document-source.port';
import { LLM_PORT } from './application/ports/llm.port';
import { MESSAGING_PORT } from './application/ports/messaging.port';
import { HandleIncomingMessageUseCase } from './application/use-cases/handle-incoming-message.use-case';

import { HealthController } from './infrastructure/http/health.controller';
import { WaWebhookController } from './infrastructure/http/wa-webhook.controller';
import { PanelApiController } from './infrastructure/http/panel/panel-api.controller';
import { PanelAuthService } from './infrastructure/http/panel/panel-auth.service';
import { PanelController } from './infrastructure/http/panel/panel.controller';
import { PanelGuard } from './infrastructure/http/panel/panel.guard';
import { OutboxDispatcher } from './infrastructure/persistence/outbox.dispatcher';
import { FlagsService } from './infrastructure/persistence/flags.service';
import { PrismaService } from './infrastructure/persistence/prisma.service';
import { MessageWorker } from './infrastructure/queue/message.worker';
import { QueueService } from './infrastructure/queue/queue.service';
import { GoogleDriveAdapter } from './infrastructure/drive/google-drive.adapter';
import { AnthropicAdapter } from './infrastructure/llm/anthropic.adapter';
import { GatewayMessagingAdapter } from './infrastructure/whatsapp/gateway-messaging.adapter';
import { OpenWaMessageMapper } from './infrastructure/whatsapp/open-wa.mapper';

@Module({
  controllers: [
    HealthController,
    WaWebhookController,
    PanelController,
    PanelApiController,
  ],
  providers: [
    // ── Infraestructura ────────────────────────────────────────────────
    PrismaService,
    FlagsService,
    QueueService,
    MessageWorker,
    OutboxDispatcher,
    OpenWaMessageMapper,
    PanelAuthService,
    PanelGuard,

    // Aquí, y solo aquí, se decide con qué se habla WhatsApp.
    // Migrar a Baileys = cambiar esta línea.
    { provide: MESSAGING_PORT, useClass: GatewayMessagingAdapter },

    // Igual para el repositorio documental: cambiar Drive por SharePoint es
    // un adaptador nuevo y esta línea.
    { provide: DOCUMENT_SOURCE_PORT, useClass: GoogleDriveAdapter },
    { provide: LLM_PORT, useClass: AnthropicAdapter },

    // ── Pipeline ───────────────────────────────────────────────────────
    SourceFilter,
    IdempotencyFilter,
    LoopGuardFilter,
    AuthorizationFilter,
    KillSwitchFilter,
    RateLimitFilter,

    // ── Soporte documental ─────────────────────────────────────────────
    AccessScopeService,
    DocumentSearchService,
    TicketService,
    SupportCommandsService,
    DocumentDeliveryService,
    DriveSyncService,
    SlotExtractorService,
    SupportStrategy,
    ConversationStateService,
    DirectoryService,

    // ── Casos de uso ───────────────────────────────────────────────────
    DriveCommandsService,
    OwnerCommandsService,
    HandleIncomingMessageUseCase,
  ],
})
export class AppModule {}
