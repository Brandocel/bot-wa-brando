import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type {
  DocCategory,
  MemberRole,
  Prisma,
  TicketState,
} from '@prisma/client';
import { DirectoryService } from '../../../application/support/directory.service';
import { PrismaService } from '../../persistence/prisma.service';
import { OutboxDispatcher } from '../../persistence/outbox.dispatcher';
import { PanelAuthService, SESSION_COOKIE } from './panel-auth.service';
import { PanelGuard, readCookie, type PanelRequest } from './panel.guard';

/**
 * API del panel. Etapa 1: SOLO LECTURA.
 *
 * Nada de esto modifica permisos, tickets ni documentos. La edición viene
 * después, y llega a una superficie que ya tiene autenticación, sesiones
 * revocables y roles probados — que es el orden correcto cuando lo que se
 * edita es quién puede ver las facturas de quién.
 */
/** Cuánto conserva una persona el hilo desde el panel sin renovarlo. */
const HANDOFF_MS = 4 * 60 * 60 * 1000;

@Controller('panel/api')
export class PanelApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: PanelAuthService,
    private readonly directory: DirectoryService,
    private readonly outbox: OutboxDispatcher,
  ) {}

  /**
   * Solo ADMIN toca el directorio.
   *
   * Un AGENTE ve tickets y contesta; conceder acceso a las facturas de una
   * empresa es otra cosa. Se comprueba en el servidor y no escondiendo el
   * boton: quien sabe abrir las herramientas del navegador puede llamar al
   * endpoint igual.
   */
  private requireAdmin(req: PanelRequest): string {
    if (req.panelUser?.role !== 'ADMIN') {
      throw new ForbiddenException('hace falta ser ADMIN');
    }
    return req.panelUser.email;
  }

  @Post('login')
  async login(
    @Body() body: { email?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    const token = await this.auth.login(body.email ?? '', body.password ?? '');

    if (!token) {
      res.status(401);
      return { ok: false };
    }

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, // fuera del alcance de cualquier script de la página
      secure: true, // Render sirve siempre por HTTPS
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return { ok: true };
  }

  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    await this.auth.logout(readCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @UseGuards(PanelGuard)
  @Get('me')
  me(@Req() req: PanelRequest) {
    return req.panelUser;
  }

  /** Números de la portada. Una consulta por dato, todas indexadas. */
  @UseGuards(PanelGuard)
  @Get('resumen')
  async summary() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [abiertos, revision, alta, cuarentena, entregas24h, denegados24h] =
      await Promise.all([
        this.prisma.conversation.count({ where: { awaiting: 'BOT' } }),
        // Conversaciones, no tickets: una persona con tres tickets
        // escalados es UNA persona esperando. Contar tickets daba 18 en
        // la tarjeta y una bandeja vacía debajo.
        this.prisma.conversation.count({
          where: {
            OR: [
              { awaiting: 'AGENTE' },
              { tickets: { some: { state: 'EN_REVISION' } } },
            ],
          },
        }),
        this.prisma.ticket.count({
          where: { priority: 'ALTA', state: { not: 'CERRADO' } },
        }),
        this.prisma.document.count({ where: { status: 'QUARANTINE' } }),
        this.prisma.accessAudit.count({
          where: { decision: 'ALLOW', createdAt: { gte: since } },
        }),
        this.prisma.accessAudit.count({
          where: { decision: { not: 'ALLOW' }, createdAt: { gte: since } },
        }),
      ]);

    return { abiertos, revision, alta, cuarentena, entregas24h, denegados24h };
  }

  @UseGuards(PanelGuard)
  @Get('tickets')
  async tickets(@Query('estado') estado?: string) {
    const state = toState(estado);

    return this.prisma.ticket.findMany({
      where: state ? { state } : {},
      orderBy: [{ state: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        number: true,
        subject: true,
        state: true,
        priority: true,
        level: true,
        createdAt: true,
        closeReason: true,
        organization: { select: { name: true } },
        contact: { select: { waId: true, displayName: true } },
      },
    });
  }

  /** Detalle con su bitácora. La bitácora ES la verdad de lo que pasó. */
  @UseGuards(PanelGuard)
  @Get('ticket')
  async ticket(@Query('id') id: string) {
    return this.prisma.ticket.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        organization: { select: { name: true } },
        contact: { select: { waId: true, displayName: true } },
      },
    });
  }

  /** Documentos que Drive tiene y el bot no pudo clasificar. */
  @UseGuards(PanelGuard)
  @Get('cuarentena')
  async quarantine() {
    return this.prisma.document.findMany({
      where: { status: 'QUARANTINE' },
      orderBy: { indexedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        mimeType: true,
        indexedAt: true,
        organization: { select: { name: true } },
      },
    });
  }

  /**
   * Bitácora de accesos. Aquí sí se ve el motivo real de una negación, que
   * al usuario nunca se le dice —a él siempre se le contesta "no encontré"—
   * porque distinguirlo permitiría mapear el Drive de otra empresa.
   */
  @UseGuards(PanelGuard)
  @Get('auditoria')
  async audit(@Query('decision') decision?: string) {
    return this.prisma.accessAudit.findMany({
      where: decision && decision !== 'todas' ? { decision } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Empresas con sus conteos. Solo lectura por ahora. */
  @UseGuards(PanelGuard)
  @Get('empresas')
  async organizations() {
    return this.prisma.organization.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        taxId: true,
        driveFolderId: true,
        active: true,
        _count: { select: { memberships: true, documents: true, tickets: true } },
      },
    });
  }

  /** Números autorizados y qué puede ver cada uno. */
  @UseGuards(PanelGuard)
  @Get('numeros')
  async members() {
    return this.prisma.membership.findMany({
      where: { revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        role: true,
        verifiedAt: true,
        validUntil: true,
        contact: { select: { waId: true, displayName: true } },
        organization: { select: { name: true } },
        grants: {
          where: { revokedAt: null },
          select: { category: true, periodFrom: true, periodTo: true },
        },
      },
    });
  }

  /**
   * La bandeja: conversaciones ordenadas por quién debe mover ficha.
   *
   * Ordenar por fecha sin más pondría arriba lo que ya está contestado. Lo
   * que necesita el operador es lo contrario: primero lo que nos espera a
   * nosotros, y de eso, lo que lleva más tiempo esperando.
   */
  @UseGuards(PanelGuard)
  @Get('bandeja')
  async inbox(@Query('esperando') esperando?: string) {
    /**
     * "persona" = lo que espera a un humano: el hilo lo pide, o tiene un
     * ticket en revisión. Antes solo se miraba `awaiting`, y como una
     * entrega posterior lo ponía en NADIE, la tarjeta decía 18 y la lista
     * decía "nada pendiente".
     */
    const filtro: Prisma.ConversationWhereInput =
      esperando === 'persona'
        ? {
            OR: [
              { awaiting: 'AGENTE' },
              { tickets: { some: { state: 'EN_REVISION' } } },
            ],
          }
        : esperando === 'BOT' || esperando === 'CLIENTE'
          ? { awaiting: esperando }
          : // Todas las que tuvieron actividad reciente. Es la bandeja de
            // WhatsApp, no una cola: se ve de qué está hablando la gente.
            { lastInboundAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } };

    const rows = await this.prisma.conversation.findMany({
      where: filtro,
      orderBy: { lastInboundAt: 'desc' },
      take: 100,
      select: {
        id: true,
        chatId: true,
        topic: true,
        awaiting: true,
        seenAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        handoffUntil: true,
        contact: { select: { displayName: true, waId: true } },
        tickets: {
          where: { state: { not: 'CERRADO' } },
          select: { number: true, state: true, priority: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, direction: true, createdAt: true },
        },
      },
    });

    return rows.map((row) => ({
      ...row,
      // El tiempo de espera se calcula aquí y no en el navegador: es el
      // dato por el que se ordena, y dos relojes distintos darían dos
      // ordenaciones distintas.
      esperando: quietFor(row.lastInboundAt),
      enManosDePersona:
        row.handoffUntil !== null && row.handoffUntil.getTime() > Date.now(),
      ultimo: row.messages[0] ?? null,
    }));
  }


  /**
   * Un hilo completo: mensajes y los tickets que salieron de él.
   *
   * Agrupar por conversación y no por ticket es lo que hace legible el
   * trabajo: el operador no atiende "el ticket #6", atiende a una persona
   * que lleva tres solicitudes y una queja. Ver la charla entera es lo que
   * evita contestar algo que ya se contestó dos mensajes antes.
   */
  @UseGuards(PanelGuard)
  @Get('conversacion')
  async thread(@Query('chatId') chatId: string) {
    if (!chatId) throw new BadRequestException('falta chatId');

    const conversation = await this.prisma.conversation.findUnique({
      where: { chatId },
      select: {
        id: true,
        chatId: true,
        topic: true,
        awaiting: true,
        seenAt: true,
        lastInboundAt: true,
        handoffUntil: true,
        contact: {
          select: {
            waId: true,
            displayName: true,
            memberships: {
              where: { revokedAt: null },
              select: {
                role: true,
                verifiedAt: true,
                organization: { select: { name: true } },
              },
            },
          },
        },
        tickets: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            number: true,
            subject: true,
            state: true,
            priority: true,
            level: true,
            createdAt: true,
            closeReason: true,
            events: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    if (!conversation) return null;

    // Los últimos 60, pero se devuelven en orden de lectura: la conversación
    // se lee de arriba abajo, no al revés.
    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true,
        direction: true,
        kind: true,
        body: true,
        createdAt: true,
      },
    });

    /**
     * Lo que está por salir también se enseña, marcado como pendiente.
     *
     * Un mensaje del panel se escribe en el outbox y sale unos segundos
     * después; hasta que sale no está en la tabla de mensajes. Sin esto el
     * operador escribía, el hilo se refrescaba sin su mensaje, y la lectura
     * era "no mandó nada".
     */
    const pendientes = await this.prisma.outboxMessage.findMany({
      where: { chatId, status: { in: ['PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, payload: true, status: true, lastError: true, createdAt: true },
    });

    return {
      ...conversation,
      enManosDePersona:
        conversation.handoffUntil !== null &&
        conversation.handoffUntil.getTime() > Date.now(),
      messages: messages.reverse(),
      pendientes: pendientes.map((p) => {
        const payload = p.payload as { kind?: string; text?: string; filename?: string; caption?: string };
        return {
          id: p.id,
          body: payload.kind === 'file'
            ? `[documento] ${payload.filename ?? ''}${payload.caption ? `\n${payload.caption}` : ''}`
            : payload.text ?? '',
          status: p.status,
          error: p.lastError,
          createdAt: p.createdAt,
        };
      }),
    };
  }

  /**
   * Una persona toma (o suelta) el hilo desde el panel.
   *
   * Mientras lo tiene, el bot registra lo que llega y no contesta. Vence
   * solo a las cuatro horas: un operador que se olvida de soltarlo no deja
   * al cliente sin atención para siempre.
   */
  @UseGuards(PanelGuard)
  @Post('conversacion/atender')
  async takeOver(
    @Req() req: PanelRequest,
    @Body() body: { chatId?: string; activo?: boolean },
  ) {
    if (!body.chatId) throw new BadRequestException('falta chatId');

    const handoffUntil = body.activo === false ? null : new Date(Date.now() + HANDOFF_MS);

    await this.prisma.conversation.update({
      where: { chatId: body.chatId },
      data: {
        handoffUntil,
        awaiting: body.activo === false ? 'NADIE' : 'AGENTE',
      },
    });

    return { ok: true, handoffUntil, por: req.panelUser?.email };
  }

  // ── Escritura ───────────────────────────────────────────────────────────

  /**
   * Vista previa del número: qué se guardaría, sin guardar nada.
   *
   * El operador teclea "9984862017" y aquí ve "+52 1 998 486 2017" y si
   * WhatsApp lo reconoce. Enseñar el resultado ANTES de guardar es lo que
   * evita el alta mal formateada, que después se manifiesta como "el bot
   * dice que no tengo acceso" y no apunta al formato por ningún lado.
   */
  @UseGuards(PanelGuard)
  @Post('numeros/preview')
  async previewNumber(@Body() body: { phone?: string }) {
    if (!body.phone) throw new BadRequestException('falta el número');
    return this.directory.preview(body.phone);
  }

  @UseGuards(PanelGuard)
  @Post('numeros')
  async addNumber(
    @Req() req: PanelRequest,
    @Body()
    body: {
      organizationId?: string;
      phone?: string;
      displayName?: string;
      role?: MemberRole;
      categories?: DocCategory[];
    },
  ) {
    const grantedBy = this.requireAdmin(req);

    if (!body.organizationId || !body.phone) {
      throw new BadRequestException('faltan la empresa o el número');
    }

    return this.directory.addMember({
      organizationId: body.organizationId,
      phone: body.phone,
      displayName: body.displayName,
      role: body.role ?? 'VIEWER',
      categories: body.categories ?? [],
      grantedBy,
    });
  }

  @UseGuards(PanelGuard)
  @Post('numeros/verificar')
  async verifyNumber(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');

    await this.directory.verifyMember(body.id);
    return { ok: true };
  }

  @UseGuards(PanelGuard)
  @Post('numeros/revocar')
  async revokeNumber(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');

    await this.directory.revokeMember(body.id);
    return { ok: true };
  }

  @UseGuards(PanelGuard)
  @Post('numeros/permiso')
  async setGrant(
    @Req() req: PanelRequest,
    @Body()
    body: { membershipId?: string; category?: DocCategory; enabled?: boolean },
  ) {
    const grantedBy = this.requireAdmin(req);

    if (!body.membershipId || !body.category) {
      throw new BadRequestException('faltan datos del permiso');
    }

    await this.directory.setGrant({
      membershipId: body.membershipId,
      category: body.category,
      enabled: body.enabled === true,
      grantedBy,
    });

    return { ok: true };
  }

  @UseGuards(PanelGuard)
  @Post('empresas')
  async addOrganization(
    @Req() req: PanelRequest,
    @Body() body: { name?: string; driveFolderId?: string; taxId?: string },
  ) {
    this.requireAdmin(req);

    if (!body.name || !body.driveFolderId) {
      throw new BadRequestException('faltan el nombre o la carpeta de Drive');
    }

    return this.directory.addOrganization({
      name: body.name,
      driveFolderId: body.driveFolderId,
      taxId: body.taxId,
    });
  }

  /**
   * Corregir una empresa. Sobre todo, su carpeta de Drive.
   *
   * Hace falta porque el id de la carpeta se equivoca con facilidad —se
   * copia de una URL— y porque las empresas sembradas para probar apuntan a
   * carpetas que no existen. Sin esto habría que crear una empresa nueva y
   * mover los números uno por uno.
   */
  @UseGuards(PanelGuard)
  @Post('empresas/actualizar')
  async updateOrganization(
    @Req() req: PanelRequest,
    @Body()
    body: {
      id?: string;
      name?: string;
      taxId?: string;
      driveFolderId?: string;
      active?: boolean;
    },
  ) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');

    const organization = await this.prisma.organization.update({
      where: { id: body.id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.taxId !== undefined ? { taxId: body.taxId.trim() || null } : {}),
        ...(body.driveFolderId ? { driveFolderId: body.driveFolderId.trim() } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    // Cambiar de carpeta invalida el cursor de Drive: el barrido incremental
    // solo trae CAMBIOS, y la carpeta nueva no ha cambiado desde entonces —
    // sus archivos son viejos y no aparecerían nunca. Borrar el cursor
    // fuerza un barrido completo en el siguiente /sync.
    if (body.driveFolderId) {
      // Marcarla como no barrida basta: la siguiente pasada automática la
      // recorre entera. Antes se borraba el cursor global, lo que obligaba
      // a rebarrer TODAS las empresas por cambiar una sola.
      await this.prisma.organization.update({
        where: { id: body.id },
        data: { lastScanAt: null },
      });
    }

    return { id: organization.id, name: organization.name };
  }

  /**
   * Enviar un mensaje a mano desde el panel.
   *
   * Va por el outbox y no directo al gateway: así queda en el historial de
   * la conversación, se reintenta si WhatsApp está caído, y el operador ve
   * en el hilo lo mismo que ve el cliente. Un mensaje enviado por fuera es
   * un mensaje que no existe para el resto del sistema.
   */
  @UseGuards(PanelGuard)
  @Post('mensaje')
  async sendMessage(
    @Req() req: PanelRequest,
    @Body() body: { chatId?: string; text?: string },
  ) {
    if (!body.chatId || !body.text?.trim()) {
      throw new BadRequestException('faltan el chat o el texto');
    }

    await this.prisma.outboxMessage.create({
      data: {
        chatId: body.chatId,
        payload: { kind: 'text', text: body.text.trim() },
      },
    });

    // Contestar deja la pelota del lado del cliente, y toma el hilo: si
    // una persona ya está escribiendo aquí, el bot se calla hasta que lo
    // suelte o venza el plazo. Antes el cliente contestaba al operador y
    // el bot se metía en medio con "¿qué documento necesitas?".
    await this.prisma.conversation.updateMany({
      where: { chatId: body.chatId },
      data: {
        awaiting: 'CLIENTE',
        lastOutboundAt: new Date(),
        handoffUntil: new Date(Date.now() + HANDOFF_MS),
      },
    });

    // Sale ya, no en el siguiente barrido: quince segundos mirando un
    // hilo sin el mensaje que acabas de escribir se sienten como un fallo.
    await this.outbox.drain();

    return { ok: true, enviadoPor: req.panelUser?.email };
  }

  /** Cierra un ticket a mano, con su autor en la bitácora. */
  @UseGuards(PanelGuard)
  @Post('ticket/cerrar')
  async closeTicket(
    @Req() req: PanelRequest,
    @Body() body: { id?: string; motivo?: string },
  ) {
    if (!body.id) throw new BadRequestException('falta el id');

    await this.prisma.ticket.update({
      where: { id: body.id },
      data: {
        state: 'CERRADO',
        closedAt: new Date(),
        closeReason: body.motivo?.trim() || 'resuelto por operador',
      },
    });

    await this.prisma.ticketEvent.create({
      data: {
        ticketId: body.id,
        type: 'estado',
        actor: req.panelUser?.email ?? 'panel',
        data: { to: 'CERRADO', motivo: body.motivo ?? 'resuelto por operador' },
      },
    });

    return { ok: true };
  }

  /** Últimos mensajes, para ver de qué habla la gente con el bot. */
  @UseGuards(PanelGuard)
  @Get('mensajes')
  async messages() {
    return this.prisma.message.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        direction: true,
        kind: true,
        body: true,
        createdAt: true,
        conversation: {
          select: { chatId: true, contact: { select: { displayName: true } } },
        },
      },
    });
  }
}

/** Cuánto lleva esperando, en palabras. */
function quietFor(since: Date | null): string {
  if (!since) return 'sin actividad';

  const minutos = Math.floor((Date.now() - since.getTime()) / 60000);
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h`;

  return `${Math.floor(horas / 24)} d`;
}

function toState(raw: string | undefined): TicketState | null {
  if (raw === 'ABIERTO' || raw === 'EN_REVISION' || raw === 'CERRADO') return raw;
  return null;
}
