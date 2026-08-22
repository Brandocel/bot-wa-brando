import { Injectable } from '@nestjs/common';
import { FlagsService } from '../../infrastructure/persistence/flags.service';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { IncomingMessage } from '../../domain/message/incoming-message';

interface OwnerCommand {
  readonly help: string;
  run(args: string, message: IncomingMessage): Promise<string>;
}

/**
 * Comandos del dueño: el panel de control del bot, desde WhatsApp.
 *
 * Esto es el patrón Command + Registry en versión mínima. En la Fase 3, las
 * herramientas que use el LLM van a implementar esta misma forma, de modo que
 * un comando escrito a mano y una llamada del modelo ejecuten el mismo código.
 */
@Injectable()
export class OwnerCommandsService {
  private readonly commands: Record<string, OwnerCommand>;

  constructor(
    private readonly flags: FlagsService,
    private readonly prisma: PrismaService,
  ) {
    this.commands = {
      pausa: {
        help: 'silencia al bot con todos menos conmigo',
        run: async () => {
          await this.flags.setPaused(true);
          return '⏸️ Bot en pausa. Nadie recibe respuestas automáticas.\nUsa /reanuda para volver.';
        },
      },

      reanuda: {
        help: 'reactiva las respuestas automáticas',
        run: async () => {
          await this.flags.setPaused(false);
          return '▶️ Bot activo otra vez.';
        },
      },

      estado: {
        help: 'resumen de qué está pasando',
        run: async () => {
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [paused, contacts, replies24h, pending] = await Promise.all([
            this.flags.isPaused(),
            this.prisma.contact.count({ where: { role: 'PROSPECT' } }),
            this.prisma.message.count({
              where: { direction: 'OUT', createdAt: { gte: since } },
            }),
            this.prisma.outboxMessage.count({ where: { status: 'PENDING' } }),
          ]);

          return [
            `Estado: ${paused ? '⏸️ EN PAUSA' : '▶️ activo'}`,
            `Prospectos: ${contacts}`,
            `Respuestas en 24h: ${replies24h}`,
            `Pendientes de enviar: ${pending}`,
          ].join('\n');
        },
      },

      id: {
        help: 'muestra los identificadores de este chat',
        run: async (_args, message) =>
          [
            `chatId: ${message.chatId}`,
            `senderId: ${message.senderId}`,
            `chat propio: ${message.isSelfChat ? 'sí' : 'no'}`,
          ].join('\n'),
      },

      ayuda: {
        help: 'esta lista',
        run: async () =>
          [
            'Comandos disponibles:',
            ...Object.entries(this.commands).map(
              ([name, cmd]) => `/${name} — ${cmd.help}`,
            ),
          ].join('\n'),
      },
    };
  }

  /**
   * Devuelve la respuesta al comando, o `null` si el texto no es un comando.
   * Ese `null` es lo que deja pasar el mensaje al agente en la Fase 3.
   */
  async tryHandle(message: IncomingMessage): Promise<string | null> {
    const text = message.body.trim();
    if (!text.startsWith('/')) return null;

    const [rawName, ...rest] = text.slice(1).split(/\s+/);
    const name = (rawName ?? '').toLowerCase();
    const command = this.commands[name];

    if (!command) {
      return `No conozco /${name}. Usa /ayuda para ver la lista.`;
    }

    return command.run(rest.join(' '), message);
  }
}
