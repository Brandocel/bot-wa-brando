import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConnectorService } from '../../../application/support/connector.service';
import { PrismaService } from '../../persistence/prisma.service';
import { PanelGuard, type PanelRequest } from './panel.guard';

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
  ) {}

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

  @Get('conectores')
  async devices(@Query('id') organizationId: string) {
    if (!organizationId) throw new BadRequestException('falta el id');

    const [devices, archivos] = await Promise.all([
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
    ]);

    return {
      devices,
      files: archivos._count,
      lastUploadAt: archivos._max.updatedAt,
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
