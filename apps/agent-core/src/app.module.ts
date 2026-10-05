import { Module } from '@nestjs/common';

import { AuthorizationFilter } from './application/pipeline/filters/authorization.filter';
import { IdempotencyFilter } from './application/pipeline/filters/idempotency.filter';
import { KillSwitchFilter } from './application/pipeline/filters/kill-switch.filter';
import { LoopGuardFilter } from './application/pipeline/filters/loop-guard.filter';
import { RateLimitFilter } from './application/pipeline/filters/rate-limit.filter';
import { DriveCommandsService } from './application/commands/drive-commands.service';
import { EnvioCommandsService } from './application/commands/envio-commands.service';
import { OwnerCommandsService } from './application/commands/owner-commands.service';
import { AgentCommandsService } from './application/commands/agent-commands.service';
import { AgentAdminCommandsService } from './application/commands/agent-admin-commands.service';
import { TicketAssignmentService } from './application/support/ticket-assignment.service';
import { SolicitudService } from './application/support/solicitud.service';
import { SourceFilter } from './application/pipeline/filters/source.filter';
import { AccessScopeService } from './application/support/access-scope.service';
import { ConversationStateService } from './application/support/conversation-state.service';
import { DirectoryService } from './application/support/directory.service';
import { DocumentLinkService } from './application/support/document-link.service';
import { EntregaVigenteService } from './application/support/entrega-vigente.service';
import { DocumentDeliveryService } from './application/support/document-delivery.service';
import { DriveSyncService } from './application/support/drive-sync.service';
import { SlotExtractorService } from './application/support/slot-extractor.service';
import { ConversationHistoryService } from './application/support/conversation-history.service';
import { ReplyWriterService } from './application/support/reply-writer.service';
import { SupportStrategy } from './application/support/support.strategy';
import { SalesStrategy } from './application/sales/sales.strategy';
import { DocumentSearchService } from './application/support/document-search.service';
import { DocumentContentService } from './application/support/document-content.service';
import { DocumentClassifierService } from './application/support/document-classifier.service';
import { SupportCommandsService } from './application/support/support-commands.service';
import { TicketService } from './application/support/ticket.service';
import { DOCUMENT_SOURCE_PORT } from './application/ports/document-source.port';
import { LLM_PORT } from './application/ports/llm.port';
import { MESSAGING_PORT } from './application/ports/messaging.port';
import { FACTURACION_PORT } from './application/ports/facturacion.port';
import { FacturacionService } from './application/facturacion/facturacion.service';
import { FacturaChatService } from './application/facturacion/factura-chat.service';
import { FacturaEquipoService } from './application/facturacion/factura-equipo.service';
import { FacturaComAdapter } from './infrastructure/facturacion/factura-com.adapter';
import { PanelFacturasController } from './infrastructure/http/panel/panel-facturas.controller';
import { PanelPendientesController } from './infrastructure/http/panel/panel-pendientes.controller';
import { HandleIncomingMessageUseCase } from './application/use-cases/handle-incoming-message.use-case';

import { ConnectorService } from './application/support/connector.service';
import { ConnectorController } from './infrastructure/http/connector.controller';
import { DownloadController } from './infrastructure/http/download.controller';
import { PanelVentasController } from './infrastructure/http/panel/panel-ventas.controller';
import { PanelConnectorController } from './infrastructure/http/panel/panel-connector.controller';
import { RoutingDocumentSource } from './infrastructure/storage/routing-document-source';
import { HealthController } from './infrastructure/http/health.controller';
import { WaWebhookController } from './infrastructure/http/wa-webhook.controller';
import { PanelApiController } from './infrastructure/http/panel/panel-api.controller';
import { PanelAuthService } from './infrastructure/http/panel/panel-auth.service';
import { PanelController } from './infrastructure/http/panel/panel.controller';
import { PanelGuard } from './infrastructure/http/panel/panel.guard';
import { OutboxDispatcher } from './infrastructure/persistence/outbox.dispatcher';
import { FlagsService } from './infrastructure/persistence/flags.service';
import { LimitesService } from './infrastructure/persistence/limites.service';
import { ModelosService } from './infrastructure/persistence/modelos.service';
import { LineasGatewayService } from './infrastructure/whatsapp/lineas-gateway.service';
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
    DownloadController,
    WaWebhookController,
    PanelController,
    PanelApiController,
    PanelConnectorController,
    PanelVentasController,
    PanelFacturasController,
    PanelPendientesController,
    ConnectorController,
  ],
  providers: [
    // ── Infraestructura ────────────────────────────────────────────────
    PrismaService,
    FlagsService,
    LimitesService,
    ModelosService,
    LineasGatewayService,
    QueueService,
    MessageWorker,
    OutboxDispatcher,
    OpenWaMessageMapper,
    PanelAuthService,
    PanelGuard,

    // Aquí, y solo aquí, se decide con qué se habla WhatsApp.
    // Migrar a Baileys = cambiar esta línea.
    { provide: MESSAGING_PORT, useClass: GatewayMessagingAdapter },

    // Igual para el repositorio documental. Cada empresa elige su origen
    // (Drive o su PC); el enrutador manda cada id a donde vive.
    GoogleDriveAdapter,
    { provide: DOCUMENT_SOURCE_PORT, useClass: RoutingDocumentSource },
    { provide: LLM_PORT, useClass: AnthropicAdapter },
    // El PAC. Cambiar de proveedor = otro adaptador aquí.
    { provide: FACTURACION_PORT, useClass: FacturaComAdapter },

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
    DocumentContentService,
    DocumentClassifierService,
    TicketService,
    TicketAssignmentService,
    SolicitudService,
    SupportCommandsService,
    DocumentDeliveryService,
    DriveSyncService,
    ConnectorService,
    SlotExtractorService,
    ConversationHistoryService,
    ReplyWriterService,
    SupportStrategy,
    SalesStrategy,
    ConversationStateService,
    DirectoryService,
    DocumentLinkService,
    EntregaVigenteService,

    // ── Facturación ────────────────────────────────────────────────────
    FacturacionService,
    FacturaChatService,
    FacturaEquipoService,

    // ── Casos de uso ───────────────────────────────────────────────────
    DriveCommandsService,
    EnvioCommandsService,
    OwnerCommandsService,
    AgentCommandsService,
    AgentAdminCommandsService,
    HandleIncomingMessageUseCase,
  ],
})
export class AppModule {}
