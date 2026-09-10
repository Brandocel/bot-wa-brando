import { Injectable, Logger } from '@nestjs/common';
import { OpenWaMessageMapper } from '../../infrastructure/whatsapp/open-wa.mapper';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { OutboxDispatcher } from '../../infrastructure/persistence/outbox.dispatcher';
import { AuthorizationFilter } from '../pipeline/filters/authorization.filter';
import { IdempotencyFilter } from '../pipeline/filters/idempotency.filter';
import { KillSwitchFilter } from '../pipeline/filters/kill-switch.filter';
import { LoopGuardFilter } from '../pipeline/filters/loop-guard.filter';
import { RateLimitFilter } from '../pipeline/filters/rate-limit.filter';
import { OwnerCommandsService } from '../commands/owner-commands.service';
import { SupportCommandsService } from '../support/support-commands.service';
import { SourceFilter } from '../pipeline/filters/source.filter';
import { runPipeline, type MessageFilter, type PipelineContext } from '../pipeline/pipeline';

@Injectable()
export class HandleIncomingMessageUseCase {
  private readonly logger = new Logger(HandleIncomingMessageUseCase.name);
  private readonly filters: readonly MessageFilter[];

  constructor(
    private readonly mapper: OpenWaMessageMapper,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxDispatcher,
    private readonly ownerCommands: OwnerCommandsService,
    private readonly supportCommands: SupportCommandsService,
    source: SourceFilter,
    idempotency: IdempotencyFilter,
    loopGuard: LoopGuardFilter,
    authorization: AuthorizationFilter,
    killSwitch: KillSwitchFilter,
    rateLimit: RateLimitFilter,
  ) {
    // El orden es la regla de negocio: de lo más barato a lo más caro.
    // SourceFilter solo mira el payload; los demas pegan a la base.
    // El orden ES la regla de negocio, de lo más barato a lo más caro.
    // KillSwitch va después de Authorization porque necesita saber si soy yo:
    // a mí nunca me silencia, o no habría forma de mandar /reanuda.
    // RateLimit va al final: es la consulta más cara y no tiene sentido
    // pagarla por mensajes que igual se iban a descartar antes.
    this.filters = [
      source,
      idempotency,
      loopGuard,
      authorization,
      killSwitch,
      rateLimit,
    ];
  }

  async execute(raw: Record<string, unknown>): Promise<void> {
    const message = this.mapper.toDomain(raw);

    if (!message) {
      this.logger.warn('payload sin id o chatId: descartado');
      return;
    }

    // Este log es como averiguas tu OWNER_WA_ID la primera vez.
    this.logger.log(`entrante de=${message.senderId} chat=${message.chatId} fromMe=${message.isFromMe} self=${message.isSelfChat}`);

    const ctx = await runPipeline(this.filters, message, (c) => this.handle(c));

    if (ctx.stoppedBy) {
      this.logger.debug(`${message.id} cortado por ${ctx.stoppedBy}: ${ctx.stopReason}`);
    }
  }

  /**
   * FASE 1: eco. Aquí es donde en la Fase 3 entra el selector de Strategy
   * (Assistant / Sales / Support) y todo lo demás se queda igual.
   */
  private async handle(ctx: PipelineContext): Promise<void> {
    const { message, role } = ctx;

    await this.prisma.withChatLock(message.chatId, async (tx) => {
      const contact = await tx.contact.upsert({
        where: { waId: message.senderId },
        create: {
          waId: message.senderId,
          displayName: message.senderName,
          role: role === 'OWNER' ? 'OWNER' : 'PROSPECT',
        },
        update: {
          displayName: message.senderName ?? undefined,
        },
      });

      const conversation = await tx.conversation.upsert({
        where: { chatId: message.chatId },
        create: { chatId: message.chatId, contactId: contact.id },
        update: {},
      });

      await tx.message.create({
        data: {
          id: message.id,
          conversationId: conversation.id,
          direction: 'IN',
          kind: message.kind,
          body: message.body,
          raw: message.raw as object,
        },
      });

      // Fase 3: aqui entra el selector de Strategy. Por ahora, comandos
      // del dueno, comandos de soporte y eco para todo lo demas.
      //
      // El orden importa: los comandos del dueno ganan, para que /pausa
      // siga funcionando aunque el numero tambien tenga membresias.
      const ownerReply =
        role === 'OWNER' ? await this.ownerCommands.tryHandle(message) : null;

      const supportReply =
        ownerReply ??
        (await this.supportCommands.tryHandle(message, {
          contactId: contact.id,
          conversationId: conversation.id,
        }));

      // Un comando que nadie reclamó es un error de tecleo, no un mensaje
      // para el agente. Contestarlo aquí, y no en cada servicio, es lo que
      // permite que los registros de comandos se encadenen sin pisarse.
      const unknownCommand =
        supportReply === null && message.body.trim().startsWith('/')
          ? `No conozco ${message.body.trim().split(/\s+/)[0]}. Usa /ayuda para ver la lista.`
          : null;

      const reply =
        supportReply ??
        unknownCommand ??
        `eco (${role?.toLowerCase()}): ${message.body}`;

      // No se envía aquí: se escribe al outbox dentro de la MISMA transacción.
      // Si algo truena después, no queda un mensaje enviado sin registro ni
      // un registro sin mensaje.
      await tx.outboxMessage.create({
        data: { chatId: message.chatId, payload: { kind: 'text', text: reply } },
      });
    });

    // Fuera de la transacción: la red no va dentro de un lock.
    await this.outbox.drain();
  }
}
