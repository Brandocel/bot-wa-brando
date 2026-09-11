import { Injectable } from '@nestjs/common';
import { FlagsService } from '../../infrastructure/persistence/flags.service';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { IncomingMessage } from '../../domain/message/incoming-message';
import { DriveCommandsService } from './drive-commands.service';
import { EnvioCommandsService } from './envio-commands.service';
import { AgentAdminCommandsService } from './agent-admin-commands.service';

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
    private readonly drive: DriveCommandsService,
    private readonly envio: EnvioCommandsService,
    private readonly agentes: AgentAdminCommandsService,
  ) {
    this.commands = {
      agente: {
        help: 'da de alta un agente de soporte: /agente <nombre> | <teléfono>',
        run: async (args) => this.agentes.alta(args),
      },

      'agente-baja': {
        help: 'da de baja un agente y reparte sus tickets: /agente-baja <teléfono>',
        run: async (args) => this.agentes.baja(args),
      },

      agentes: {
        help: 'lista de agentes de soporte y su carga',
        run: async () => this.agentes.lista(),
      },

      asignar: {
        help: 'manda un ticket a un agente: /asignar <número> <teléfono>',
        run: async (args) => this.agentes.asignar(args),
      },

      empresa: {
        help: 'da de alta una empresa: /empresa <nombre> | <id de carpeta>',
        run: async (args) => this.drive.registerOrganization(args),
      },

      'empresa-baja': {
        help: 'da de baja una empresa (deja de sincronizar): /empresa-baja <nombre>',
        run: async (args) => this.drive.deactivateOrganization(args),
      },

      sync: {
        help: 'sincroniza ya con Drive, sin esperar al temporizador',
        run: async () => this.drive.runSync(),
      },

      drive: {
        help: 'diagnóstico de Drive: cuenta, empresas y última sincronización',
        run: async () => this.drive.status(),
      },

      cuarentena: {
        help: 'archivos que Drive tiene pero el bot no pudo clasificar',
        run: async () => this.drive.listQuarantine(),
      },

      resync: {
        help: 'borra el cursor de Drive para rehacer el barrido completo',
        run: async () => this.drive.fullResync(),
      },

      diag: {
        help: 'por qué no salen los archivos en este chat: /diag [destino]',
        run: async (args, message) => this.envio.diagnosticar(args, message),
      },

      probar: {
        help: 'manda un mensaje y un PDF de prueba: /probar <destino>',
        run: async (args) => this.envio.probar(args),
      },

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
            'Comandos de dueño:',
            ...Object.entries(this.commands).map(
              ([name, cmd]) => `/${name} — ${cmd.help}`,
            ),
            '',
            'Comandos de soporte (los tiene cualquier número autorizado):',
            '/buscar <qué> — busca un documento y te lo manda',
            '/permisos — qué puedes consultar y de qué empresas',
            '/tickets — tus últimos tickets en esta conversación',
            '/id — tus identificadores de WhatsApp',
            '',
            'Comandos de agente de soporte (solo números dados de alta con /agente):',
            '/mios — tus tickets pendientes',
            '/tomar <número> — te asigna un ticket',
            '/cerrar <número> [nota] — cierra un ticket tuyo',
          ].join('\n'),
      },
    };
  }

  /**
   * Devuelve la respuesta al comando, o `null` si no es un comando MÍO.
   *
   * Ese null importa: antes esta función contestaba "No conozco /x" a
   * cualquier cosa con barra, y con eso se tragaba /buscar y /permisos —
   * los comandos de soporte, que corren después. El dueño también es
   * usuario del sistema de soporte. Quien decide que un comando no existe
   * es el caso de uso, cuando ya nadie lo reclamó.
   */
  async tryHandle(message: IncomingMessage): Promise<string | null> {
    const text = message.body.trim();
    if (!text.startsWith('/')) return null;

    const [rawName, ...rest] = text.slice(1).split(/\s+/);
    const name = (rawName ?? '').toLowerCase();
    const command = this.commands[name];

    if (!command) return null;

    return command.run(rest.join(' '), message);
  }
}
