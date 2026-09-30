import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { config } from '../../../config';
import { ConnectorService } from '../../../application/support/connector.service';
import { PrismaService } from '../../persistence/prisma.service';
import { LineasGatewayService } from '../../whatsapp/lineas-gateway.service';
import { lineaDeEmpresa } from '../../../domain/message/linea';
import { PanelGuard, type PanelRequest } from './panel.guard';

/** Dónde deja build-exe.cjs el conector armado. En Render el cwd es la raíz del repo. */
const CONNECTOR_EXE =
  process.env.CONNECTOR_EXE_PATH || join(process.cwd(), 'apps/pc-connector/dist/ConectorBot.exe');

/**
 * Cuánto vale el código que va dentro del instalador descargado. Más que
 * el código tecleado (15 min): el instalador se suele mandar al cliente por
 * correo o WhatsApp y lo abre cuando puede. Sigue siendo de un solo uso.
 */
const INSTALLER_CODE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Panel: de dónde saca el bot los documentos de cada empresa.
 *
 * Solo ADMIN: cambiar el origen cambia qué documentos puede entregar el
 * bot a nombre de esa empresa.
 */
@UseGuards(PanelGuard)
@Controller('panel/api/empresas')
export class PanelConnectorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: ConnectorService,
    private readonly lineas: LineasGatewayService,
  ) {}

  // ── WhatsApp propio de la empresa ───────────────────────────────────────

  /** Estado del número de la empresa: sin conectar, esperando QR o conectado. */
  @Get('whatsapp')
  async whatsappStatus(@Query('id') organizationId: string) {
    if (!organizationId) throw new BadRequestException('falta el id');
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { waLineId: true, waNumber: true },
    });
    if (!org) throw new BadRequestException('no existe esa empresa');
    if (!org.waLineId) return { conectada: false, estado: null, numero: null };

    const estado = await this.lineas.estado(org.waLineId).catch(() => null);

    // El número vinculado se guarda al conectarse, para enseñarlo aunque el
    // gateway esté reiniciando.
    if (estado?.state === 'CONNECTED' && estado.numero && estado.numero !== org.waNumber) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { waNumber: estado.numero },
      });
    }

    return {
      conectada: true,
      estado: estado?.state ?? 'DESCONOCIDO',
      hasQr: estado?.hasQr ?? false,
      error: estado?.lastError ?? null,
      numero: estado?.numero ?? org.waNumber,
    };
  }

  /**
   * Crea la línea de la empresa en el gateway (o la reactiva si la
   * desvincularon) y deja un QR listo para escanear.
   */
  @Post('whatsapp/conectar')
  async whatsappConnect(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');
    const linea = lineaDeEmpresa(body.id);

    try {
      await this.lineas.crear(linea);
    } catch (err) {
      throw new ServiceUnavailableException(
        `no se pudo preparar el WhatsApp de la empresa: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.prisma.organization.update({
      where: { id: body.id },
      data: { waLineId: linea },
    });
    return { ok: true };
  }

  /** El QR pendiente, como imagen. Solo ADMIN: vincula un número entero. */
  @Get('whatsapp/qr')
  async whatsappQr(
    @Req() req: PanelRequest,
    @Query('id') organizationId: string,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAdmin(req);
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId ?? '' },
      select: { waLineId: true },
    });
    const png = org?.waLineId ? await this.lineas.qr(org.waLineId) : null;
    if (!png) {
      res.status(404).json({ message: 'no hay QR pendiente' });
      return;
    }
    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'no-store');
    res.send(png);
  }

  /**
   * Desconecta el número de la empresa: sale de "Dispositivos vinculados"
   * de su teléfono y, desde ese momento, se la atiende por el principal.
   */
  @Post('whatsapp/desconectar')
  async whatsappDisconnect(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');
    const org = await this.prisma.organization.findUnique({
      where: { id: body.id },
      select: { waLineId: true },
    });
    if (org?.waLineId) {
      await this.lineas.borrar(org.waLineId).catch(() => undefined);
    }
    await this.prisma.organization.update({
      where: { id: body.id },
      data: { waLineId: null, waNumber: null },
    });
    return { ok: true };
  }

  private requireAdmin(req: PanelRequest): void {
    if (req.panelUser?.role !== 'ADMIN') {
      throw new ForbiddenException('hace falta ser ADMIN');
    }
  }

  /**
   * Cambia el origen. Pasar a PC no borra nada de lo indexado desde Drive:
   * el primer manifiesto del conector reconcilia. Volver a Drive fuerza un
   * barrido completo de la carpeta.
   */
  @Post('origen')
  async setSource(
    @Req() req: PanelRequest,
    @Body() body: { id?: string; sourceType?: string; driveFolderId?: string },
  ) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');

    if (body.sourceType === 'PC') {
      await this.prisma.organization.update({
        where: { id: body.id },
        data: { sourceType: 'PC' },
      });
      return { ok: true };
    }

    if (body.sourceType === 'DRIVE') {
      const actual = await this.prisma.organization.findUnique({
        where: { id: body.id },
        select: { driveFolderId: true },
      });
      const carpeta = body.driveFolderId?.trim() || actual?.driveFolderId;
      if (!carpeta) throw new BadRequestException('falta la carpeta de Drive');

      await this.prisma.organization.update({
        where: { id: body.id },
        data: { sourceType: 'DRIVE', driveFolderId: carpeta, lastScanAt: null },
      });
      return { ok: true };
    }

    throw new BadRequestException('origen desconocido');
  }

  @Post('conector/codigo')
  async pairCode(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');
    return this.connector.crearCodigo(body.id);
  }

  /**
   * El instalador listo para esa empresa: ConectorBot.exe con la dirección
   * del bot y un código de conexión pegados al final. El cliente le da
   * doble clic y elige su carpeta; no teclea nada.
   */
  @Get('conector/descarga')
  async download(
    @Req() req: PanelRequest,
    @Query('id') organizationId: string,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAdmin(req);
    if (!organizationId) throw new BadRequestException('falta el id');
    if (!existsSync(CONNECTOR_EXE)) {
      throw new ServiceUnavailableException(
        'el instalador no está disponible en este servidor (no se armó en el build)',
      );
    }

    const { code, organization } = await this.connector.crearCodigo(
      organizationId,
      INSTALLER_CODE_TTL_MS,
    );

    const datos = Buffer.from(
      JSON.stringify({ server: config.publicUrl, code, organization }),
    ).toString('base64');
    const trailer = Buffer.from(`\n#CONECTORBOT:${datos}#FIN\n`, 'latin1');

    const slug = organization
      .normalize('NFD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(statSync(CONNECTOR_EXE).size + trailer.length));
    res.setHeader('content-disposition', `attachment; filename="ConectorBot-${slug || 'empresa'}.exe"`);
    res.setHeader('cache-control', 'no-store');

    const exe = createReadStream(CONNECTOR_EXE);
    exe.on('error', () => res.destroy());
    exe.on('end', () => res.end(trailer));
    exe.pipe(res, { end: false });
  }

  @Get('conectores')
  async devices(@Query('id') organizationId: string) {
    if (!organizationId) throw new BadRequestException('falta el id');

    const [devices, archivos, estados] = await Promise.all([
      this.prisma.connectorDevice.findMany({
        where: { organizationId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, createdAt: true, lastSeenAt: true },
      }),
      this.prisma.storedFile.aggregate({
        where: { organizationId },
        _count: true,
        _max: { updatedAt: true },
      }),
      // Lo que el operador quiere saber de un vistazo: cuántos se pueden
      // entregar y cuántos esperan a que alguien los mire.
      this.prisma.document.groupBy({
        by: ['status'],
        where: { organizationId, status: { not: 'DELETED' } },
        _count: true,
      }),
    ]);

    const cuenta = (status: string) => estados.find((e) => e.status === status)?._count ?? 0;

    return {
      devices,
      files: archivos._count,
      lastUploadAt: archivos._max.updatedAt,
      documentos: {
        entregables: cuenta('INDEXED'),
        revision: cuenta('QUARANTINE'),
        descartados: cuenta('EXCLUDED'),
      },
    };
  }

  @Post('conector/revocar')
  async revoke(@Req() req: PanelRequest, @Body() body: { id?: string }) {
    this.requireAdmin(req);
    if (!body.id) throw new BadRequestException('falta el id');
    await this.connector.revocar(body.id);
    return { ok: true };
  }
}
