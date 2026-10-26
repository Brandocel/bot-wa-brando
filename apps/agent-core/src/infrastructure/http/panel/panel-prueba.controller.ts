import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DOCUMENT_SOURCE_PORT, type DocumentSourcePort } from '../../../application/ports/document-source.port';
import { HandleIncomingMessageUseCase } from '../../../application/use-cases/handle-incoming-message.use-case';
import { InvalidPhoneError, normalizePhone } from '../../../domain/contact/phone';
import { LINEA_PRINCIPAL } from '../../../domain/message/linea';
import { MARCA_PRUEBA, chatDePrueba } from '../../../domain/message/prueba';
import { OutboxDispatcher } from '../../persistence/outbox.dispatcher';
import { PrismaService } from '../../persistence/prisma.service';
import { VozService } from '../../voz/voz.service';
import { PanelGuard, type PanelRequest } from './panel.guard';

interface Destino {
  linea: string | null;
  waId: string;
  chatId: string;
  /** Una PERSONA escribiéndose a sí misma en su línea: su chat propio. */
  propio: boolean;
}

/**
 * Chat de prueba del equipo: control de calidad del bot sin WhatsApp.
 *
 * El mensaje entra por el MISMO flujo que uno real (filtros, permisos,
 * búsqueda, entrega), con el número de quien se elige, pero en un chat
 * marcado (domain/message/prueba.ts): nada sale al gateway y el panel lo
 * esconde de Conversaciones, Pendientes y Tickets.
 *
 * Solo el equipo: sin @ParaEmpresa, el guard se lo niega a un usuario de
 * empresa.
 */
@UseGuards(PanelGuard)
@Controller('panel/api/prueba')
export class PanelPruebaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entrante: HandleIncomingMessageUseCase,
    private readonly outbox: OutboxDispatcher,
    @Inject(DOCUMENT_SOURCE_PORT) private readonly source: DocumentSourcePort,
    private readonly voz: VozService,
  ) {}

  @Get()
  async chat(@Query('empresa') empresa?: string, @Query('numero') numero?: string) {
    const d = await this.destino(empresa, numero);
    const conv = await this.prisma.conversation.findUnique({
      where: { chatId: d.chatId },
      select: {
        awaiting: true,
        topic: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 300,
          select: { id: true, direction: true, kind: true, body: true, sentBy: true, createdAt: true, raw: true },
        },
        tickets: {
          where: { state: { not: 'CERRADO' } },
          select: { number: true, state: true, subject: true },
        },
      },
    });
    return {
      remitente: d.waId,
      propio: d.propio,
      linea: d.linea,
      awaiting: conv?.awaiting ?? null,
      topic: conv?.topic ?? null,
      tickets: conv?.tickets ?? [],
      mensajes: (conv?.messages ?? []).map(({ raw, ...m }) => {
        const r = raw as { documentId?: unknown; type?: unknown } | null;
        return {
          ...m,
          documentId: r?.documentId ?? null,
          // Lo mandó como nota de voz: el texto es la transcripción.
          esVoz: r?.type === 'ptt' || r?.type === 'audio',
        };
      }),
    };
  }

  /**
   * El archivo que el bot entregó en la prueba, para revisar que sea lo que
   * se pidió. Se abre en el navegador; solo el equipo (el guard niega a
   * una empresa) y queda en la auditoría.
   */
  @Get('documento')
  async documento(@Req() req: PanelRequest, @Query('id') id: string | undefined, @Res() res: Response): Promise<void> {
    const doc = id ? await this.prisma.document.findUnique({ where: { id } }) : null;
    if (!doc || doc.status === 'DELETED') throw new NotFoundException('ese documento ya no existe');

    const bytes = await this.source.download(doc.driveFileId);
    await this.prisma.accessAudit.create({
      data: {
        waId: `panel:${req.panelUser?.email ?? '?'}`,
        query: `prueba: ver ${doc.name}`,
        documentId: doc.id,
        decision: 'ALLOW',
        decidedBy: 'chat de prueba del equipo',
      },
    });
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  }

  /**
   * Manda un mensaje como esa persona y corre el turno completo. Con
   * `audio` (lo grabado en el navegador) entra como nota de voz y pasa por
   * la misma transcripción que una de WhatsApp.
   */
  @Post('mensaje')
  async mensaje(@Body() body: { empresa?: string; numero?: string; texto?: string; audio?: { base64?: string; mimetype?: string } }) {
    const texto = body.texto?.trim() ?? '';
    const audio = body.audio?.base64 && body.audio.mimetype?.startsWith('audio/') ? body.audio : null;
    if (!texto && !audio) throw new BadRequestException('escribe algo o graba un audio');
    const d = await this.destino(body.empresa, body.numero);

    const id = `${MARCA_PRUEBA}${randomUUID()}`;
    const chat = d.chatId.slice(d.chatId.lastIndexOf(MARCA_PRUEBA));
    await this.entrante.execute({
      id,
      linea: d.linea ?? LINEA_PRINCIPAL,
      chatId: chat,
      from: d.waId,
      // Distinto de `from`: en el principal, to === from se leería como el
      // chat propio del dueño.
      to: d.propio ? d.waId : 'bot@prueba',
      sender: { id: d.waId, pushname: null, formattedName: null },
      chat: { id: chat, contact: { isMe: d.propio } },
      type: audio ? 'ptt' : 'chat',
      body: audio ? '' : texto,
      ...(audio
        ? { media: { mimetype: audio.mimetype!.split(';')[0], filename: 'nota-de-voz', base64: audio.base64!.replace(/^data:[^;]+;base64,/, '') } }
        : {}),
      fromMe: d.propio,
      isGroupMsg: false,
      isBroadcast: false,
      t: Math.floor(Date.now() / 1000),
    });

    // Lo que no llegó a guardarse lo cortó un filtro antes del turno.
    const procesado = (await this.prisma.message.count({ where: { id } })) > 0;
    void this.outbox.drain().catch(() => undefined);
    return { procesado };
  }

  /** La respuesta en voz de un mensaje del bot en la prueba, para escucharla en el panel. */
  @Get('voz')
  async escuchar(@Query('id') id: string | undefined, @Res() res: Response): Promise<void> {
    const m = id ? await this.prisma.message.findUnique({ where: { id }, select: { body: true, conversation: { select: { chatId: true } } } }) : null;
    if (!m || !m.conversation.chatId.includes(MARCA_PRUEBA)) throw new NotFoundException('no existe ese mensaje');
    const mp3 = await this.voz.hablar(m.body.replace(/^\[voz\]\s*/, ''));
    if (!mp3) throw new NotFoundException('no se pudo generar la voz');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(mp3);
  }

  /** Borra el chat de prueba: el bot vuelve a atenderlo desde cero. */
  @Post('reiniciar')
  async reiniciar(@Body() body: { empresa?: string; numero?: string }) {
    const d = await this.destino(body.empresa, body.numero);
    await this.prisma.outboxMessage.deleteMany({ where: { chatId: d.chatId } });
    // En cascada se llevan mensajes y tickets de la prueba.
    await this.prisma.conversation.deleteMany({ where: { chatId: d.chatId } });
    return { ok: true };
  }

  /**
   * Por dónde y como quién se escribe. Con empresa, por su línea si tiene;
   * sin ella, por el número principal. A una PERSONA, sin número, se le
   * escribe como ella misma en su chat propio.
   */
  private async destino(empresa?: string, numero?: string): Promise<Destino> {
    const org = empresa
      ? await this.prisma.organization.findUnique({
          where: { id: empresa },
          select: { kind: true, waLineId: true, waNumber: true },
        })
      : null;
    if (empresa && !org) throw new BadRequestException('no existe esa empresa');

    const persona = org?.kind === 'PERSONA';
    const tecleado = numero?.trim() || (persona ? org?.waNumber : null);
    if (!tecleado) throw new BadRequestException('falta el número de quien escribe');

    let waId: string;
    try {
      waId = normalizePhone(tecleado).waId;
    } catch (err) {
      if (err instanceof InvalidPhoneError) throw new BadRequestException(err.message);
      throw err;
    }

    const linea = org?.waLineId ?? null;
    const propio =
      persona && linea !== null && !!org?.waNumber && normalizePhone(org.waNumber).waId === waId;
    return { linea, waId, chatId: chatDePrueba(linea, waId), propio };
  }
}
