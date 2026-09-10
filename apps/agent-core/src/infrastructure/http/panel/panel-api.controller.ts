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
import type { Prisma, TicketState } from '@prisma/client';
import { PrismaService } from '../../persistence/prisma.service';
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
@Controller('panel/api')
export class PanelApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: PanelAuthService,
  ) {}

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
        this.prisma.ticket.count({ where: { state: 'ABIERTO' } }),
        this.prisma.ticket.count({ where: { state: 'EN_REVISION' } }),
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
    const filtro: Prisma.ConversationWhereInput =
      esperando === 'BOT' || esperando === 'CLIENTE' || esperando === 'AGENTE'
        ? { awaiting: esperando }
        : // Por defecto, solo lo que nos espera a nosotros: lo que espera al
          // cliente no es tarea de nadie hasta que conteste.
          { awaiting: { in: ['BOT', 'AGENTE'] } };

    const rows = await this.prisma.conversation.findMany({
      where: filtro,
      orderBy: { lastInboundAt: 'asc' },
      take: 100,
      select: {
        id: true,
        chatId: true,
        topic: true,
        awaiting: true,
        seenAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        contact: { select: { displayName: true, waId: true } },
        tickets: {
          where: { state: { not: 'CERRADO' } },
          select: { number: true, state: true, priority: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return rows.map((row) => ({
      ...row,
      // El tiempo de espera se calcula aquí y no en el navegador: es el
      // dato por el que se ordena, y dos relojes distintos darían dos
      // ordenaciones distintas.
      esperando: quietFor(row.lastInboundAt),
    }));
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
