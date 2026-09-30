import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { FlagsService } from './flags.service';
import { PrismaService } from './prisma.service';

/**
 * Topes de mensajes salientes, configurables desde el panel.
 *
 * Existen porque el número del bot se conecta como WhatsApp Web (Baileys),
 * no por la API oficial: si manda demasiado y muy seguido, WhatsApp puede
 * bloquearlo, y con él se cae la atención de TODAS las empresas. Subirlos
 * es posible; quitarlos, no.
 */
export interface Limites {
  /** Respuestas por hora a un mismo chat. */
  porChatHora: number;
  /** Respuestas por hora sumando todos los chats. */
  globalHora: number;
  /** Respuestas por minuto a un mismo chat: el seguro contra bucles. */
  porChatMinuto: number;
  /**
   * ¿Los documentos cuentan para los topes por chat? false = solo el texto:
   * un pedido de diez facturas no deja a la persona sin respuesta, y un
   * bucle se nota en el texto, no en los archivos.
   */
  contarDocumentos: boolean;
}

export const LIMITES_DEFECTO: Limites = {
  porChatHora: 60,
  globalHora: 600,
  porChatMinuto: 8,
  contarDocumentos: false,
};

/** Lo mínimo y lo máximo que se deja poner desde el panel. */
export const LIMITES_RANGO: Record<'porChatHora' | 'globalHora' | 'porChatMinuto', [number, number]> = {
  porChatHora: [10, 300],
  globalHora: [50, 3000],
  porChatMinuto: [3, 20],
};

const CLAVE = 'limites';
const HORA_MS = 60 * 60 * 1000;
/** Los documentos se registran con este prefijo en Message.body. */
const PREFIJO_DOCUMENTO = '[documento]';

export interface UsoLimites {
  limites: Limites;
  desde: string;
  global: number;
  chats: { chatId: string; nombre: string | null; cuenta: number }[];
}

@Injectable()
export class LimitesService {
  constructor(
    private readonly flags: FlagsService,
    private readonly prisma: PrismaService,
  ) {}

  async actuales(): Promise<Limites> {
    const guardados = await this.flags.get<Partial<Limites>>(CLAVE, {});
    return normalizar({ ...LIMITES_DEFECTO, ...(guardados ?? {}) });
  }

  /** Guarda lo que venga, dentro de rango. Devuelve cómo quedó. */
  async guardar(parcial: Partial<Limites>): Promise<Limites> {
    const nuevos = normalizar({ ...(await this.actuales()), ...parcial });
    await this.flags.set(CLAVE, nuevos);
    return nuevos;
  }

  /**
   * Los salientes que cuentan para un tope por chat. Los documentos solo
   * si así se configuró.
   */
  salientesQueCuentan(limites: Limites): Prisma.MessageWhereInput {
    return limites.contarDocumentos
      ? { direction: 'OUT' }
      : { direction: 'OUT', NOT: { body: { startsWith: PREFIJO_DOCUMENTO } } };
  }

  /** Cuántos lleva: el total de la hora y los chats que más han recibido. */
  async uso(): Promise<UsoLimites> {
    const limites = await this.actuales();
    const desde = new Date(Date.now() - HORA_MS);

    const [global, porConversacion] = await Promise.all([
      this.prisma.message.count({ where: { direction: 'OUT', createdAt: { gte: desde } } }),
      this.prisma.message.groupBy({
        by: ['conversationId'],
        where: { ...this.salientesQueCuentan(limites), createdAt: { gte: desde } },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: 8,
      }),
    ]);

    const conversaciones = await this.prisma.conversation.findMany({
      where: { id: { in: porConversacion.map((c) => c.conversationId) } },
      select: { id: true, chatId: true, contact: { select: { displayName: true } } },
    });
    const porId = new Map(conversaciones.map((c) => [c.id, c]));

    return {
      limites,
      desde: desde.toISOString(),
      global,
      chats: porConversacion.map((c) => ({
        chatId: porId.get(c.conversationId)?.chatId ?? c.conversationId,
        nombre: porId.get(c.conversationId)?.contact?.displayName ?? null,
        cuenta: c._count._all,
      })),
    };
  }
}

function normalizar(l: Limites): Limites {
  const acotar = (clave: keyof typeof LIMITES_RANGO, valor: unknown): number => {
    const [min, max] = LIMITES_RANGO[clave];
    const n = Math.round(Number(valor));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : LIMITES_DEFECTO[clave];
  };
  return {
    porChatHora: acotar('porChatHora', l.porChatHora),
    globalHora: acotar('globalHora', l.globalHora),
    porChatMinuto: acotar('porChatMinuto', l.porChatMinuto),
    contarDocumentos: l.contarDocumentos === true,
  };
}
