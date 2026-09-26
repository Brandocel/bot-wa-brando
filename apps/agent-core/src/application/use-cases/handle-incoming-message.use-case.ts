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
import { AgentCommandsService } from '../commands/agent-commands.service';
import { SupportCommandsService } from '../support/support-commands.service';
import { ConversationStateService } from '../support/conversation-state.service';
import { SupportStrategy } from '../support/support.strategy';
import { clasificar, type Clasificacion } from '../support/message-classifier';
import type { TransactionClient } from '../../infrastructure/persistence/prisma.service';
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
    private readonly agentCommands: AgentCommandsService,
    private readonly supportCommands: SupportCommandsService,
    private readonly supportStrategy: SupportStrategy,
    private readonly conversations: ConversationStateService,
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
  /**
   * El turno, en dos fases.
   *
   * FASE 1 registra al contacto, la conversación y el mensaje entrante, y
   * confirma. FASE 2 decide y escribe la respuesta.
   *
   * Están separadas por una razón concreta: dentro de una transacción sin
   * confirmar, cualquier servicio que escriba con OTRA conexión no ve lo que
   * esa transacción acaba de crear. Con un hilo que ya existía no se notaba;
   * con uno nuevo, el ticket apuntaba a una conversación invisible y el
   * turno entero moría. El síntoma era que el bot no contestaba justo a los
   * números recién dados de alta.
   *
   * Las dos fases siguen bajo el mismo lock por chat, así que dos mensajes
   * de la misma conversación se siguen atendiendo en orden. Lo que se pierde
   * es la atomicidad entre "mensaje registrado" y "respuesta encolada": si
   * el proceso muere entre ambas, queda el entrante sin contestar. Eso es
   * visible y recuperable; lo otro era una caída silenciosa.
   */
  private async handle(ctx: PipelineContext): Promise<void> {
    const { message, role } = ctx;
    const ahora = new Date();

    // ── FASE 1: registrar lo que llegó ──────────────────────────────────
    const { contactId, conversationId, enManosDePersona } = await this.prisma.withChatLock(
      message.chatId,
      async (tx) => {
        const contact = await tx.contact.upsert({
          where: { waId: message.senderId },
          create: {
            waId: message.senderId,
            displayName: message.senderName,
            role: role === 'OWNER' ? 'OWNER' : 'PROSPECT',
          },
          update: { displayName: message.senderName ?? undefined },
        });

        const conversation = await tx.conversation.upsert({
          where: { chatId: message.chatId },
          create: {
            chatId: message.chatId,
            contactId: contact.id,
            awaiting: 'BOT',
            lastInboundAt: ahora,
            seenAt: ahora,
          },
          update: { awaiting: 'BOT', lastInboundAt: ahora, seenAt: ahora },
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

        return {
          contactId: contact.id,
          conversationId: conversation.id,
          enManosDePersona:
            conversation.handoffUntil !== null &&
            conversation.handoffUntil.getTime() > Date.now(),
        };
      },
    );

    // Acuse de recibo en WhatsApp. Fuera de toda transacción: es red.
    await this.conversations.onInbound({ chatId: message.chatId });

    // ── FASE 2: decidir y responder ─────────────────────────────────────
    await this.prisma.withChatLock(message.chatId, async (tx) => {
      // Los comandos del dueño ganan, para que /pausa siga funcionando
      // aunque ese número también tenga membresías.
      const ownerReply =
        role === 'OWNER' ? await this.ownerCommands.tryHandle(message) : null;

      // Los agentes de soporte van antes que los comandos de cliente: un
      // agente también puede tener membresías, y /cerrar es suyo.
      const agentReply =
        ownerReply ?? (await this.agentCommands.tryHandle(message));

      const supportReply =
        agentReply ??
        (await this.supportCommands.tryHandle(message, {
          contactId,
          conversationId,
        }));

      // Un comando que nadie reclamó es un error de tecleo, no un mensaje
      // para el agente. Solo se le avisa a quien está en el directorio: a
      // un desconocido, "no conozco ese comando" ya le confirma que del
      // otro lado hay un bot.
      const isCommand = looksLikeCommand(message.body);

      const unknownCommand =
        supportReply === null &&
        isCommand &&
        (await enElDirectorio(tx, contactId, message.senderId, role))
          ? `No conozco ${message.body.trim().split(/\s+/)[0]}. Usa /ayuda para ver la lista.`
          : null;

      // La Strategy solo ve lo que NO es un comando: uno mal escrito no debe
      // gastar una llamada al modelo.
      //
      // Y no habla mientras una persona atiende el hilo desde el panel: dos
      // voces en el mismo chat es lo que más desconcierta a un cliente. Lo
      // que llega se registra igual, para que la persona lo vea.
      if (enManosDePersona && supportReply === null && !isCommand) {
        // Se clasifica igual: una queja mientras la atiende una persona es
        // justo lo que esa persona tiene que ver resaltado.
        await etiquetar(tx, message.id, clasificar(message.body));
        await this.conversations.onOutbound({ conversationId, awaiting: 'AGENTE', tx });
        return;
      }

      const strategyReply =
        supportReply === null && !isCommand
          ? await this.supportStrategy.handle(message, {
              contactId,
              conversationId,
            })
          : null;

      /**
       * Sin nada que decir, no se dice nada.
       *
       * Antes salía un eco con el mensaje de vuelta. A un número que no
       * está en el directorio eso le contestaba —y le confirmaba que del
       * otro lado hay algo automático— cuando lo correcto es guardar lo que
       * escribió y dejar que una persona lo vea. El hilo se queda esperando
       * por nosotros, así que sale en la bandeja como "sin responder".
       */
      const reply = supportReply ?? unknownCommand ?? strategyReply?.text ?? null;

      if (reply === null) {
        if (!isCommand) await etiquetar(tx, message.id, clasificar(message.body));
        return;
      }

      // Texto vacío = la Strategy ya encoló lo que había que mandar (un
      // archivo con su leyenda) y no quiere un mensaje aparte.
      if (reply !== '') {
        await tx.outboxMessage.create({
          data: { chatId: message.chatId, payload: { kind: 'text', text: reply } },
        });
      }

      // De quién queda el turno. Solo la Strategy sabe si lo que acaba de
      // decir era una pregunta, una entrega o un escalado; un comando no
      // deja nada pendiente.
      await this.conversations.onOutbound({
        conversationId,
        awaiting: strategyReply?.awaiting ?? 'NADIE',
        topic: strategyReply?.topic ?? null,
        tx,
      });

      if (strategyReply?.clasificacion) {
        await etiquetar(tx, message.id, strategyReply.clasificacion);
      }
    });

    // Fuera de la transacción: la red no va dentro de un lock.
    await this.outbox.drain();
  }
}

/**
 * ¿Este número es alguien del sistema: el dueño, un agente de soporte o un
 * contacto con membresía viva?
 *
 * Es la frontera de a quién le habla el bot. Al resto no se le contesta
 * nada —ni un eco, ni "no conozco ese comando"—: su mensaje se guarda y
 * aparece en el panel para que una persona decida qué hacer con él.
 */
async function enElDirectorio(
  tx: TransactionClient,
  contactId: string,
  waId: string,
  role: string | null | undefined,
): Promise<boolean> {
  if (role === 'OWNER') return true;

  const [membresias, agentes] = await Promise.all([
    tx.membership.count({ where: { contactId, revokedAt: null } }),
    tx.supportAgent.count({ where: { waId, active: true } }),
  ]);

  return membresias > 0 || agentes > 0;
}

/**
 * Guarda en el mensaje entrante qué clase de mensaje fue. Es lo que deja
 * ver en la bandeja quién vino a pedir algo y quién vino a quejarse.
 */
async function etiquetar(
  tx: TransactionClient,
  messageId: string,
  c: Clasificacion,
): Promise<void> {
  await tx.message.update({
    where: { id: messageId },
    data: { intent: c.tipo, motivo: c.motivo, molesto: c.molesto },
    select: { id: true },
  });
}

/**
 * ¿Esto es un comando o solo empieza con barra?
 *
 * No basta con mirar el primer carácter. Una URL pegada, una fracción
 * escrita a mano o cualquier texto que arranque con `/` acababa recibiendo
 * un "No conozco ...". Un comando de verdad es una palabra corta, sin
 * espacios, y con caracteres de nombre.
 *
 * El tope de longitud no es cosmético: es lo que impide que un texto largo
 * se devuelva entero dentro del mensaje de error.
 */
function looksLikeCommand(body: string): boolean {
  return /^\/[a-záéíóúñ0-9_-]{1,24}(\s|$)/i.test(body.trim());
}
