import {
  Body,
  Controller,
  Get,
  Logger,
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
import {
  DriveSyncService,
  RevisionError,
} from '../../../application/support/drive-sync.service';
import { PrismaService } from '../../persistence/prisma.service';
import {
  LIMITES_DEFECTO,
  LIMITES_RANGO,
  LimitesService,
  type Limites,
} from '../../persistence/limites.service';
import {
  MODELOS_DEFECTO,
  MODELOS_DISPONIBLES,
  ModelosService,
  esModeloValido,
  type Modelos,
} from '../../persistence/modelos.service';
import { OutboxDispatcher } from '../../persistence/outbox.dispatcher';
import { PanelAuthService, SESSION_COOKIE } from './panel-auth.service';
import { PanelGuard, ParaEmpresa, readCookie, type PanelRequest } from './panel.guard';
import { SENSITIVE } from '../../../application/support/access-scope.service';
import { randomBytes } from 'node:crypto';
import { prefijoDeLinea, separarChat } from '../../../domain/message/linea';
import { claveTitular } from '../../../domain/contact/nombre';

/** Las conversaciones de esa persona en el mismo número de WhatsApp. */
function mismaLinea(contactId: string, chatId: string): Prisma.ConversationWhereInput {
  const linea = separarChat(chatId).linea;
  return linea
    ? { contactId, chatId: { startsWith: prefijoDeLinea(linea) } }
    : { contactId, NOT: { chatId: { startsWith: 'linea:' } } };
}

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
  private readonly logger = new Logger(PanelApiController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: PanelAuthService,
    private readonly directory: DirectoryService,
    private readonly outbox: OutboxDispatcher,
    private readonly sync: DriveSyncService,
    private readonly limites: LimitesService,
    private readonly modelos: ModelosService,
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

  /**
   * Quién gestiona el directorio, y de qué empresa.
   *
   * ADMIN del equipo: de cualquiera (organizationId null). EMPRESA: solo de
   * la suya, y eso lo decide el servidor con su sesión, nunca lo que mande
   * el navegador.
   */
  private gestor(req: PanelRequest): { email: string; organizationId: string | null } {
    const u = req.panelUser;
    if (u?.role === 'ADMIN') return { email: u.email, organizationId: null };
    if (u?.role === 'EMPRESA' && u.organizationId) return { email: u.email, organizationId: u.organizationId };
    throw new ForbiddenException('no puedes cambiar el directorio');
  }

  /** La empresa que ve quien pregunta: la suya si es EMPRESA; null = todas. */
  private empresaVisible(req: PanelRequest): string | null {
    return req.panelUser?.role === 'EMPRESA' ? req.panelUser.organizationId : null;
  }

  /**
   * Una membresía que este gestor puede tocar. Si es de otra empresa se
   * contesta igual que si no existiera: no se confirma que exista.
   */
  private async membresiaDe(gestor: { organizationId: string | null }, id: string | undefined) {
    if (!id) throw new BadRequestException('falta el número');
    const m = await this.prisma.membership.findUnique({
      where: { id },
      select: { id: true, organizationId: true, contact: { select: { waId: true } } },
    });
    if (!m || (gestor.organizationId && m.organizationId !== gestor.organizationId)) {
      throw new BadRequestException('no existe ese número');
    }
    return m;
  }

  /**
   * El doble paso de lo sensible: quien lo hace confirma por escrito que
   * habló con la persona y anota cómo lo comprobó. Va a la auditoría.
   */
  private atestacion(body: { confirmo?: boolean; nota?: string }): string {
    const nota = body.nota?.trim() ?? '';
    if (body.confirmo !== true || nota.length < 8) {
      throw new BadRequestException('confirma que hablaste con la persona y escribe cómo lo comprobaste');
    }
    return nota.slice(0, 300);
  }

  private async auditarPanel(waId: string, decision: string, email: string, nota: string): Promise<void> {
    await this.prisma.accessAudit.create({
      data: { waId, query: nota, documentId: null, decision, decidedBy: `panel: ${email}` },
    });
  }

  /** El contacto detrás de un chatId, para tratar todos sus hilos como uno. */
  private async contactoDe(chatId: string): Promise<string> {
    const c = await this.prisma.conversation.findUnique({
      where: { chatId },
      select: { contactId: true },
    });
    if (!c) throw new BadRequestException('no existe esa conversación');
    return c.contactId;
  }

  /**
   * Los hilos que forman UNA charla: los de esa persona (por número y por
   * LID)… pero solo en el mismo número de WhatsApp. La misma persona
   * hablando con dos empresas son dos charlas, y mezclarlas haría que la
   * respuesta del panel saliera por el número de la otra empresa.
   */
  private async hiloDe(chatId: string): Promise<Prisma.ConversationWhereInput> {
    return mismaLinea(await this.contactoDe(chatId), chatId);
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
  @ParaEmpresa()
  @Get('me')
  me(@Req() req: PanelRequest) {
    return req.panelUser;
  }

  /** Números de la portada. Una consulta por dato, todas indexadas. */
  @UseGuards(PanelGuard)
  @Get('resumen')
  async summary() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const hora = new Date(Date.now() - 60 * 60 * 1000);

    const [abiertos, revision, alta, cuarentena, entregas24h, denegados24h, mensajesHora, limites] =
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
        // Cuántos mensajes lleva el bot en la hora, contra su tope general.
        this.prisma.message.count({ where: { direction: 'OUT', createdAt: { gte: hora } } }),
        this.limites.actuales(),
      ]);

    return {
      abiertos,
      revision,
      alta,
      cuarentena,
      entregas24h,
      denegados24h,
      mensajesHora,
      topeHora: limites.globalHora,
    };
  }

  /** Los topes de mensajes, cuántos lleva y de qué rango se pueden mover. */
  @UseGuards(PanelGuard)
  @Get('ajustes/limites')
  async limitsUsage() {
    return {
      ...(await this.limites.uso()),
      rango: LIMITES_RANGO,
      defecto: LIMITES_DEFECTO,
    };
  }

  /**
   * Cambia los topes. Solo ADMIN: subirlos de más arriesga el número del
   * bot, y con él la atención de todas las empresas. Queda en el log quién
   * y a qué.
   */
  @UseGuards(PanelGuard)
  @Post('ajustes/limites')
  async setLimits(@Req() req: PanelRequest, @Body() body: Partial<Limites>) {
    const quien = this.requireAdmin(req);
    const limpios: Partial<Limites> = {};
    for (const clave of ['porChatHora', 'globalHora', 'porChatMinuto'] as const) {
      if (body[clave] !== undefined) {
        const n = Number(body[clave]);
        if (!Number.isFinite(n)) throw new BadRequestException(`${clave} debe ser un número`);
        const [min, max] = LIMITES_RANGO[clave];
        if (n < min || n > max) {
          throw new BadRequestException(`${clave} tiene que estar entre ${min} y ${max}`);
        }
        limpios[clave] = n;
      }
    }
    if (body.contarDocumentos !== undefined) limpios.contarDocumentos = body.contarDocumentos === true;

    const nuevos = await this.limites.guardar(limpios);
    this.logger.warn(`topes de mensajes cambiados por ${quien}: ${JSON.stringify(nuevos)}`);
    return nuevos;
  }

  /** Qué modelo usa cada tarea y entre cuáles se puede elegir. */
  @UseGuards(PanelGuard)
  @Get('ajustes/modelos')
  async models() {
    return {
      modelos: await this.modelos.actuales(),
      disponibles: MODELOS_DISPONIBLES,
      defecto: MODELOS_DEFECTO,
    };
  }

  /** Cambia el modelo de una o varias tareas. Solo ADMIN: mueve el gasto. */
  @UseGuards(PanelGuard)
  @Post('ajustes/modelos')
  async setModels(@Req() req: PanelRequest, @Body() body: Partial<Modelos>) {
    const quien = this.requireAdmin(req);
    const limpios: Partial<Modelos> = {};
    for (const tarea of ['conversacion', 'redaccion', 'clasificacion'] as const) {
      if (body[tarea] === undefined) continue;
      if (!esModeloValido(body[tarea])) {
        throw new BadRequestException(`${tarea}: modelo no permitido`);
      }
      limpios[tarea] = body[tarea];
    }

    const nuevos = await this.modelos.guardar(limpios);
    this.logger.warn(`modelos de IA cambiados por ${quien}: ${JSON.stringify(nuevos)}`);
    return nuevos;
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

  /**
   * Documentos que el clasificador no se atrevió a decidir (revision) o
   * que descartó como internos o ajenos (descartados). Los sensibles no se
   * listan: no hay nada que aprobar ahí.
   */
  @UseGuards(PanelGuard)
  @Get('cuarentena')
  async quarantine(@Query('vista') vista?: string) {
    const where: Prisma.DocumentWhereInput =
      vista === 'descartados'
        ? { status: 'EXCLUDED', docClass: { not: 'SENSIBLE' } }
        : { status: 'QUARANTINE' };

    return this.prisma.document.findMany({
      where,
      orderBy: { indexedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        mimeType: true,
        indexedAt: true,
        category: true,
        period: true,
        summary: true,
        counterpart: true,
        docClass: true,
        classifiedBy: true,
        classification: true,
        reviewedBy: true,
        organization: { select: { name: true } },
      },
    });
  }

  /**
   * Los documentos de UNA empresa, para agruparlos por tipo y mes en el
   * panel. Sin el texto extraído: pesa y no hace falta para listar.
   */
  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Get('documentos')
  async documents(
    @Req() req: PanelRequest,
    @Query('empresa') pedida?: string,
    @Query('estado') estado?: string,
  ) {
    // Un usuario de empresa ve la suya, pida lo que pida.
    const empresa = this.empresaVisible(req) ?? pedida;
    if (!empresa) throw new BadRequestException('falta la empresa');

    const status: Prisma.DocumentWhereInput['status'] =
      estado === 'revision'
        ? 'QUARANTINE'
        : estado === 'descartados'
          ? 'EXCLUDED'
          : estado === 'todos'
            ? { not: 'DELETED' }
            : 'INDEXED';

    return this.prisma.document.findMany({
      where: { organizationId: empresa, status },
      orderBy: [{ period: 'desc' }, { name: 'asc' }],
      take: 5000,
      select: {
        id: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        category: true,
        period: true,
        folio: true,
        summary: true,
        counterpart: true,
        holderByOperator: true,
        status: true,
        docClass: true,
        indexedAt: true,
      },
    });
  }

  /**
   * Aprobar vuelve entregable un documento; rechazar lo deja fuera. Solo
   * ADMIN: aprobar es decidir qué recibe un cliente por WhatsApp.
   */
  @UseGuards(PanelGuard)
  @Post('cuarentena/revisar')
  async review(
    @Req() req: PanelRequest,
    @Body() body: { id?: string; decision?: string },
  ) {
    const por = this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');
    if (body.decision !== 'aprobar' && body.decision !== 'rechazar') {
      throw new BadRequestException('la decisión debe ser aprobar o rechazar');
    }

    try {
      return await this.sync.revisar(body.id, body.decision, por);
    } catch (err) {
      if (err instanceof RevisionError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /**
   * A nombre de quién va un documento. Es lo que decide qué cliente (VIEWER)
   * lo puede recibir, así que corregirlo es solo de ADMIN, y queda fijo: el
   * barrido ya no lo pisa con lo que lea el clasificador.
   */
  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Post('documentos/titular')
  async setHolder(@Req() req: PanelRequest, @Body() body: { id?: string; titular?: string }) {
    const gestor = this.gestor(req);
    if (!body.id) throw new BadRequestException('falta el id');
    const doc = await this.prisma.document.findUnique({ where: { id: body.id }, select: { organizationId: true } });
    if (!doc || (gestor.organizationId && doc.organizationId !== gestor.organizationId)) {
      throw new BadRequestException('no existe ese documento');
    }

    const titular = body.titular?.trim().replace(/\s+/g, ' ').slice(0, 200) || null;
    await this.prisma.document.update({
      where: { id: body.id },
      data: { counterpart: titular, holderKey: claveTitular(titular), holderByOperator: true },
    });
    return { ok: true };
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
  @ParaEmpresa()
  @Get('empresas')
  async organizations(@Req() req: PanelRequest) {
    const propia = this.empresaVisible(req);
    return this.prisma.organization.findMany({
      where: propia ? { id: propia } : {},
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        taxId: true,
        driveFolderId: true,
        sourceType: true,
        active: true,
        waLineId: true,
        waNumber: true,
        _count: {
          select: {
            memberships: true,
            // Los borrados se guardan para la auditoría, pero contarlos
            // aquí hacía creer que la empresa tenía documentos que ya no están.
            documents: { where: { status: { not: 'DELETED' } } },
            tickets: true,
          },
        },
      },
    });
  }

  /** Números autorizados y qué puede ver cada uno. */
  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Get('numeros')
  async members(@Req() req: PanelRequest) {
    const propia = this.empresaVisible(req);
    return this.prisma.membership.findMany({
      where: { revokedAt: null, ...(propia ? { organizationId: propia } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        role: true,
        verifiedAt: true,
        fullName: true,
        nameConfirmedAt: true,
        validUntil: true,
        createdAt: true,
        contact: { select: { waId: true, displayName: true } },
        organization: { select: { id: true, name: true } },
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
        // Quejas (o mensajes molestos) de la última semana: la bandeja las
        // marca aunque el último mensaje ya sea una respuesta del bot.
        _count: {
          select: {
            messages: {
              where: {
                direction: 'IN',
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                OR: [{ intent: 'QUEJA' }, { molesto: true }],
              },
            },
          },
        },
      },
    });

    /**
     * Una fila por PERSONA, no por chatId.
     *
     * WhatsApp direcciona el mismo contacto a veces por número y a veces
     * por LID, y de cada forma nace una conversación distinta. Para quien
     * atiende es la misma persona: se agrupan por contacto, manda la más
     * reciente, y las demás aportan sus tickets abiertos y su bandera de
     * "lo atiende una persona".
     */
    const porContacto = new Map<string, (typeof rows)[number]>();
    const ticketsExtra = new Map<string, (typeof rows)[number]['tickets']>();
    const enManos = new Set<string>();

    for (const row of rows) {
      // Por persona Y por número: con dos empresas son dos charlas.
      const clave = `${row.contact?.waId ?? row.chatId}|${separarChat(row.chatId).linea ?? ''}`;
      if (row.handoffUntil && row.handoffUntil.getTime() > Date.now()) enManos.add(clave);

      const actual = porContacto.get(clave);
      if (!actual) {
        porContacto.set(clave, row);
        continue;
      }
      // rows viene ordenado por lastInboundAt desc: la primera es la más
      // reciente. Las siguientes solo aportan tickets.
      ticketsExtra.set(clave, [...(ticketsExtra.get(clave) ?? []), ...row.tickets]);
    }

    return [...porContacto.entries()].map(([clave, row]) => ({
      ...row,
      tickets: [...row.tickets, ...(ticketsExtra.get(clave) ?? [])].slice(0, 1),
      // El tiempo de espera se calcula aquí y no en el navegador: es el
      // dato por el que se ordena, y dos relojes distintos darían dos
      // ordenaciones distintas.
      esperando: quietFor(row.lastInboundAt),
      enManosDePersona: enManos.has(clave),
      ultimo: row.messages[0] ?? null,
      quejas: row._count.messages,
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

    const base = await this.prisma.conversation.findUnique({
      where: { chatId },
      select: { id: true, contactId: true },
    });
    if (!base) return null;

    /**
     * Todas las conversaciones de esta persona, no solo la del chatId.
     *
     * El mismo contacto puede tener un hilo por número y otro por LID;
     * para quien atiende es una sola charla. Se leen todas, se mezclan los
     * mensajes por fecha, y se contesta por la que habló más reciente.
     */
    const hilos = await this.prisma.conversation.findMany({
      where: mismaLinea(base.contactId, chatId),
      orderBy: { lastInboundAt: 'desc' },
      select: {
        id: true,
        chatId: true,
        topic: true,
        awaiting: true,
        seenAt: true,
        lastInboundAt: true,
        handoffUntil: true,
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
          },
        },
      },
    });

    const contact = await this.prisma.contact.findUnique({
      where: { id: base.contactId },
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
    });

    const principal = hilos[0]!;
    const ids = hilos.map((h) => h.id);
    const chatIds = hilos.map((h) => h.chatId);

    // Los últimos 80 entre todos los hilos, en orden de lectura.
    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: {
        id: true,
        direction: true,
        kind: true,
        body: true,
        createdAt: true,
        intent: true,
        motivo: true,
        molesto: true,
        sentBy: true,
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
      // Lo pendiente siempre; lo fallido solo de la última hora. Un fallo
      // de hace días no es "por salir": es ruido rojo encima de la charla.
      where: {
        chatId: { in: chatIds },
        OR: [
          { status: 'PENDING' },
          { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, payload: true, status: true, lastError: true, createdAt: true },
    });

    const enManosDePersona = hilos.some(
      (h) => h.handoffUntil !== null && h.handoffUntil.getTime() > Date.now(),
    );
    const handoffUntil = hilos
      .map((h) => h.handoffUntil)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      id: principal.id,
      chatId: principal.chatId,
      chatIds,
      topic: hilos.find((h) => h.topic)?.topic ?? null,
      awaiting: principal.awaiting,
      seenAt: principal.seenAt,
      lastInboundAt: principal.lastInboundAt,
      handoffUntil,
      enManosDePersona,
      contact,
      tickets: hilos
        .flatMap((h) => h.tickets)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      messages: messages.reverse(),
      pendientes: pendientes.map((p) => {
        const payload = p.payload as { kind?: string; text?: string; filename?: string; caption?: string; autor?: string };
        return {
          id: p.id,
          body: payload.kind === 'file'
            ? `[documento] ${payload.filename ?? ''}${payload.caption ? `\n${payload.caption}` : ''}`
            : payload.text ?? '',
          status: p.status,
          error: p.lastError,
          createdAt: p.createdAt,
          sentBy: payload.autor ?? 'bot',
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

    // A todos los hilos de la persona: si la atiendes tú, la atiendes por
    // el número y por el LID por igual.
    await this.prisma.conversation.updateMany({
      where: await this.hiloDe(body.chatId),
      data: {
        handoffUntil,
        awaiting: body.activo === false ? 'NADIE' : 'AGENTE',
      },
    });

    return { ok: true, handoffUntil, por: req.panelUser?.email };
  }

  /**
   * Borra la conversación de una persona. No se puede deshacer.
   *
   * Dos modos, porque son dos necesidades distintas:
   *
   *  - `mensajes`: se va el historial y la solicitud en curso, pero el
   *    hilo y sus tickets se quedan. Es lo que hace falta después de una
   *    prueba, o cuando la charla se enredó y conviene empezar de cero
   *    sin perder el rastro de soporte.
   *  - `todo`: desaparece la conversación entera. Los mensajes y los
   *    tickets se van con ella (la base los borra en cascada), así que
   *    también se pierde el historial de soporte de esa persona.
   *
   * Se borran TODOS los hilos del contacto, no solo el del chatId: el
   * mismo cliente puede tener uno por número y otro por LID, y dejar la
   * mitad es peor que no borrar nada.
   *
   * Lo que NO se toca: el contacto, sus membresías ni sus permisos. Para
   * quitarle el acceso a alguien está el directorio; borrar el chat es
   * limpieza, no una baja. Y con tickets sin cerrar hay que insistir con
   * `forzar`, porque eso es trabajo de alguien que todavía está pendiente.
   */
  @UseGuards(PanelGuard)
  @Post('conversacion/borrar')
  async deleteThread(
    @Req() req: PanelRequest,
    @Body() body: { chatId?: string; modo?: 'mensajes' | 'todo'; forzar?: boolean },
  ) {
    const email = this.requireAdmin(req);
    if (!body.chatId) throw new BadRequestException('falta chatId');

    const modo = body.modo === 'todo' ? 'todo' : 'mensajes';
    const hilos = await this.prisma.conversation.findMany({
      where: await this.hiloDe(body.chatId),
      select: { id: true, chatId: true },
    });
    const ids = hilos.map((h) => h.id);
    const chatIds = hilos.map((h) => h.chatId);

    const abiertos = await this.prisma.ticket.count({
      where: { conversationId: { in: ids }, state: { not: 'CERRADO' } },
    });
    if (abiertos > 0 && body.forzar !== true) {
      throw new BadRequestException(
        `esta persona tiene ${abiertos} ticket(s) sin cerrar. Ciérralos primero, o vuelve a intentarlo confirmando que quieres borrar de todos modos.`,
      );
    }

    // Lo que estaba encolado para salir ya no tiene a dónde ir: mandarlo
    // después de borrar el hilo es contestar a una charla que ya no existe.
    const pendientes = await this.prisma.outboxMessage.deleteMany({
      where: { chatId: { in: chatIds }, status: { in: ['PENDING', 'FAILED'] } },
    });

    const mensajes = await this.prisma.message.deleteMany({
      where: { conversationId: { in: ids } },
    });

    let tickets = 0;
    let conversaciones = 0;

    if (modo === 'todo') {
      tickets = await this.prisma.ticket.count({ where: { conversationId: { in: ids } } });
      conversaciones = (
        await this.prisma.conversation.deleteMany({ where: { id: { in: ids } } })
      ).count;
    } else {
      /**
       * El hilo sigue, pero sin memoria: ni solicitud en curso, ni tema,
       * ni turno de nadie, ni handoff. La próxima vez que esa persona
       * escriba, el bot la atiende como si fuera la primera vez.
       */
      await this.prisma.conversation.updateMany({
        where: { id: { in: ids } },
        data: {
          context: {},
          topic: null,
          awaiting: 'NADIE',
          handoffUntil: null,
          seenAt: null,
          lastInboundAt: null,
          lastOutboundAt: null,
        },
      });
    }

    this.logger.warn(
      `${email} borró (${modo}) el chat ${body.chatId}: ${mensajes.count} mensaje(s)` +
        (modo === 'todo' ? `, ${conversaciones} hilo(s) y ${tickets} ticket(s)` : ''),
    );

    return {
      ok: true,
      modo,
      mensajes: mensajes.count,
      tickets,
      conversaciones,
      pendientes: pendientes.count,
      por: email,
    };
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
  @ParaEmpresa()
  @Post('numeros/preview')
  async previewNumber(@Req() req: PanelRequest, @Body() body: { phone?: string }) {
    this.gestor(req);
    if (!body.phone) throw new BadRequestException('falta el número');
    return this.directory.preview(body.phone);
  }

  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Post('numeros')
  async addNumber(
    @Req() req: PanelRequest,
    @Body()
    body: {
      organizationId?: string;
      phone?: string;
      displayName?: string;
      fullName?: string;
      role?: MemberRole;
      categories?: DocCategory[];
      confirmo?: boolean;
      nota?: string;
    },
  ) {
    const gestor = this.gestor(req);
    const organizationId = gestor.organizationId ?? body.organizationId;
    const role = body.role ?? 'VIEWER';

    if (!organizationId || !body.phone) {
      throw new BadRequestException('faltan la empresa o el número');
    }
    // ADMIN de WhatsApp autoriza a otros: eso lo decide el equipo, no la empresa.
    if (gestor.organizationId && role === 'ADMIN') {
      throw new ForbiddenException('solo el equipo de Jarvis da el rol ADMIN');
    }
    if (!body.fullName || body.fullName.trim().split(/\s+/).length < 2) {
      throw new BadRequestException('escribe el nombre completo, con apellidos');
    }
    const categories = role === 'VIEWER' ? body.categories ?? [] : [];
    const sensibles = categories.some((c) => SENSITIVE.includes(c));
    const nota = sensibles ? this.atestacion(body) : null;

    const r = await this.directory.addMember({
      organizationId,
      phone: body.phone,
      displayName: body.displayName,
      fullName: body.fullName,
      role,
      categories,
      grantedBy: gestor.email,
    });
    await this.auditarPanel(r.waId, 'PANEL_ALTA', gestor.email, nota ?? `alta como ${role}`);
    return r;
  }

  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Post('numeros/verificar')
  async verifyNumber(
    @Req() req: PanelRequest,
    @Body() body: { id?: string; confirmo?: boolean; nota?: string },
  ) {
    const gestor = this.gestor(req);
    const m = await this.membresiaDe(gestor, body.id);
    const nota = this.atestacion(body);

    await this.directory.verifyMember(m.id);
    await this.auditarPanel(m.contact.waId, 'PANEL_VERIFICAR', gestor.email, nota);
    return { ok: true };
  }

  /** Nombre completo registrado. Cambiarlo obliga al número a confirmarlo de nuevo. */
  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Post('numeros/nombre')
  async setFullName(@Req() req: PanelRequest, @Body() body: { id?: string; fullName?: string }) {
    const gestor = this.gestor(req);
    const m = await this.membresiaDe(gestor, body.id);

    try {
      await this.directory.setFullName(m.id, body.fullName ?? '');
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    await this.auditarPanel(m.contact.waId, 'PANEL_NOMBRE', gestor.email, 'nombre completo cambiado');
    return { ok: true };
  }

  /** Confirmar el nombre a mano, sin esperar a que lo escriba por WhatsApp. */
  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Post('numeros/confirmar-nombre')
  async confirmFullName(
    @Req() req: PanelRequest,
    @Body() body: { id?: string; confirmo?: boolean; nota?: string },
  ) {
    const gestor = this.gestor(req);
    const m = await this.membresiaDe(gestor, body.id);
    const nota = this.atestacion(body);

    try {
      await this.directory.confirmFullName(m.id);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    await this.auditarPanel(m.contact.waId, 'PANEL_CONFIRMAR_NOMBRE', gestor.email, nota);
    return { ok: true };
  }

  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Post('numeros/revocar')
  async revokeNumber(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    const gestor = this.gestor(req);
    const m = await this.membresiaDe(gestor, body.id);

    await this.directory.revokeMember(m.id);
    await this.auditarPanel(m.contact.waId, 'PANEL_REVOCAR', gestor.email, 'acceso retirado');
    return { ok: true };
  }

  @UseGuards(PanelGuard)
  @ParaEmpresa()
  @Post('numeros/permiso')
  async setGrant(
    @Req() req: PanelRequest,
    @Body()
    body: { membershipId?: string; category?: DocCategory; enabled?: boolean; confirmo?: boolean; nota?: string },
  ) {
    const gestor = this.gestor(req);
    const m = await this.membresiaDe(gestor, body.membershipId);
    if (!body.category) throw new BadRequestException('falta el tipo de documento');

    const enabled = body.enabled === true;
    // Dar lo sensible pide el doble paso; quitarlo, nunca.
    const nota = enabled && SENSITIVE.includes(body.category) ? this.atestacion(body) : null;

    await this.directory.setGrant({
      membershipId: m.id,
      category: body.category,
      enabled,
      grantedBy: gestor.email,
    });
    await this.auditarPanel(
      m.contact.waId,
      enabled ? 'PANEL_PERMISO_DAR' : 'PANEL_PERMISO_QUITAR',
      gestor.email,
      nota ? `${body.category}: ${nota}` : body.category,
    );
    return { ok: true };
  }

  /** Quién de una empresa entra a su propio panel. Solo el equipo. */
  @UseGuards(PanelGuard)
  @Get('empresas/usuarios')
  async companyUsers(@Req() req: PanelRequest, @Query('empresa') empresa?: string) {
    this.requireAdmin(req);
    if (!empresa) throw new BadRequestException('falta la empresa');
    return this.prisma.panelUser.findMany({
      where: { organizationId: empresa, role: 'EMPRESA', active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, lastLoginAt: true },
    });
  }

  /**
   * Alta de un usuario de empresa. La contraseña se genera aquí y se
   * devuelve UNA sola vez: el equipo se la pasa a la empresa por un canal
   * seguro. No se guarda en claro en ningún lado.
   */
  @UseGuards(PanelGuard)
  @Post('empresas/usuarios')
  async addCompanyUser(
    @Req() req: PanelRequest,
    @Body() body: { organizationId?: string; email?: string; name?: string },
  ) {
    this.requireAdmin(req);
    const email = body.email?.trim().toLowerCase() ?? '';
    const name = body.name?.trim() ?? '';
    if (!body.organizationId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) {
      throw new BadRequestException('faltan la empresa, un correo válido o el nombre');
    }
    if (await this.prisma.panelUser.findUnique({ where: { email } })) {
      throw new BadRequestException('ese correo ya tiene acceso al panel');
    }

    const password = randomBytes(9).toString('base64url');
    await this.auth.createUser({ email, name, password, role: 'EMPRESA', organizationId: body.organizationId });
    return { email, password };
  }

  /** Quitarle el panel a alguien de una empresa: se desactiva y se cierran sus sesiones. */
  @UseGuards(PanelGuard)
  @Post('empresas/usuarios/baja')
  async removeCompanyUser(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');
    await this.prisma.panelUser.updateMany({
      where: { id: body.id, role: 'EMPRESA' },
      data: { active: false },
    });
    await this.prisma.panelSession.deleteMany({ where: { userId: body.id } });
    return { ok: true };
  }

  @UseGuards(PanelGuard)
  @Post('empresas')
  async addOrganization(
    @Req() req: PanelRequest,
    @Body()
    body: { name?: string; driveFolderId?: string; taxId?: string; sourceType?: string },
  ) {
    this.requireAdmin(req);

    const sourceType = body.sourceType === 'PC' ? 'PC' : 'DRIVE';

    if (!body.name) throw new BadRequestException('falta el nombre');
    if (sourceType === 'DRIVE' && !body.driveFolderId) {
      throw new BadRequestException('falta la carpeta de Drive');
    }

    return this.directory.addOrganization({
      name: body.name,
      sourceType,
      driveFolderId: sourceType === 'DRIVE' ? body.driveFolderId : undefined,
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
        // Para que el hilo distinga a una persona del bot.
        payload: { kind: 'text', text: body.text.trim(), autor: `persona:${req.panelUser?.email ?? 'panel'}` },
      },
    });

    // Contestar deja la pelota del lado del cliente, y toma el hilo: si
    // una persona ya está escribiendo aquí, el bot se calla hasta que lo
    // suelte o venza el plazo. Antes el cliente contestaba al operador y
    // el bot se metía en medio con "¿qué documento necesitas?".
    await this.prisma.conversation.updateMany({
      where: await this.hiloDe(body.chatId),
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
