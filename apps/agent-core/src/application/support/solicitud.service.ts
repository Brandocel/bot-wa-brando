import { Injectable } from '@nestjs/common';
import type { DocCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/**
 * La solicitud en curso de una conversación: qué documento está pidiendo
 * la persona, qué se le preguntó, qué lista se le ofreció.
 *
 * Vive en `Conversation.context`, NO en un ticket. Un ticket es un caso de
 * soporte: existe solo cuando el bot no pudo resolver y una persona tiene
 * que entrar. Pedir una factura y recibirla no es un caso de soporte, y
 * abrir un folio por cada entrega llenaba el panel de tickets que nadie
 * tenía que atender.
 *
 * Caduca sola: media hora sin actividad y lo que se pidió ya no cuenta.
 * Y se cierra al resolver: entregado el documento, la siguiente petición
 * empieza limpia. Lo único que sobrevive es qué se entregó por última
 * vez, para "no me llegó" y para entender "y la de marzo".
 */

/** Media hora sin actividad y la solicitud se da por terminada. */
const VIGENCIA_MS = 30 * 60 * 1000;

export type SlotPendiente = 'categoria' | 'periodo' | 'empresa';

export interface Opcion {
  n: number;
  tipo: 'empresa' | 'documento';
  id: string;
  nombre: string;
}

export interface Solicitud {
  category: DocCategory | null;
  /** ISO del primer día del mes. */
  period: string | null;
  folio: string | null;
  organizationId: string | null;
  opciones: Opcion[] | null;
  preguntas: number;
  preguntado: Partial<Record<SlotPendiente, boolean>>;
  ultimaPregunta: SlotPendiente | null;
  fallos: number;
  /** Cuándo se tocó por última vez. null = no hay solicitud en curso. */
  updatedAt: string | null;
}

export interface UltimaEntrega {
  documentId: string;
  name: string;
  category: DocCategory;
  period: string | null;
  at: string;
}

const VACIA: Solicitud = {
  category: null,
  period: null,
  folio: null,
  organizationId: null,
  opciones: null,
  preguntas: 0,
  preguntado: {},
  ultimaPregunta: null,
  fallos: 0,
  updatedAt: null,
};

@Injectable()
export class SolicitudService {
  constructor(private readonly prisma: PrismaService) {}

  /** La solicitud en curso, o una vacía si no hay o ya caducó. */
  async actual(conversationId: string): Promise<Solicitud> {
    const ctx = await this.leer(conversationId);
    const raw = ctx.solicitud as Partial<Solicitud> | undefined;
    if (!raw?.updatedAt) return { ...VACIA };

    if (Date.now() - new Date(raw.updatedAt).getTime() > VIGENCIA_MS) {
      return { ...VACIA };
    }

    return { ...VACIA, ...raw };
  }

  /** Mezcla campos en la solicitud y la mantiene viva. */
  async guardar(
    conversationId: string,
    patch: Partial<Solicitud>,
  ): Promise<Solicitud> {
    const actual = await this.actual(conversationId);
    const nueva: Solicitud = {
      ...actual,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await this.escribir(conversationId, { solicitud: nueva });
    return nueva;
  }

  /**
   * La solicitud quedó resuelta (o abandonada): se borra entera.
   *
   * Es lo que hace que "y ahora la cotización" no arrastre el mes, el
   * folio ni los fallos de la factura que ya se entregó.
   */
  async cerrar(conversationId: string): Promise<void> {
    await this.escribir(conversationId, { solicitud: null });
  }

  async registrarEntrega(
    conversationId: string,
    doc: { id: string; name: string; category: DocCategory; period: Date | null },
  ): Promise<void> {
    const entrega: UltimaEntrega = {
      documentId: doc.id,
      name: doc.name,
      category: doc.category,
      period: doc.period?.toISOString() ?? null,
      at: new Date().toISOString(),
    };
    await this.escribir(conversationId, { ultimaEntrega: entrega });
  }

  /** Lo último que se entregó en este hilo, si fue hace menos de 6 h. */
  async ultimaEntrega(conversationId: string): Promise<UltimaEntrega | null> {
    const ctx = await this.leer(conversationId);
    const raw = ctx.ultimaEntrega as UltimaEntrega | undefined;
    if (!raw?.documentId) return null;
    if (Date.now() - new Date(raw.at).getTime() > 6 * 60 * 60 * 1000) return null;
    return raw;
  }

  private async leer(conversationId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { context: true },
    });
    const ctx = row?.context;
    return typeof ctx === 'object' && ctx !== null && !Array.isArray(ctx)
      ? (ctx as Record<string, unknown>)
      : {};
  }

  private async escribir(
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const actual = await this.leer(conversationId);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { context: { ...actual, ...patch } as Prisma.InputJsonValue },
    });
  }
}
