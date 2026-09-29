import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ConnectorError,
  ConnectorService,
  type ManifestEntry,
} from '../../application/support/connector.service';

/**
 * API del conector de PC. Sin sesión del panel: autoriza el token que se
 * obtuvo al emparejar con el código de 6 dígitos.
 *
 * Los archivos suben como application/octet-stream y el tipo real va en
 * X-Mime-Type. Así el parser de JSON del resto del core nunca ve bytes.
 */

/** Intentos fallidos de emparejar por IP antes de frenar. */
const MAX_PAIR_FAILS = 10;
const PAIR_WINDOW_MS = 15 * 60 * 1000;

@Controller('connector')
export class ConnectorController {
  /**
   * Freno contra quien pruebe códigos al azar. En memoria: si el proceso se
   * reinicia se olvida, pero un código de 6 dígitos que vive 15 minutos no
   * se adivina con 10 intentos por ventana.
   */
  private readonly fallos = new Map<string, { count: number; since: number }>();

  constructor(private readonly connector: ConnectorService) {}

  @Post('pair')
  async pair(
    @Req() req: Request,
    @Body() body: { code?: string; deviceName?: string },
  ) {
    const ip = req.ip ?? 'desconocida';
    const registro = this.fallos.get(ip);
    if (registro && Date.now() - registro.since < PAIR_WINDOW_MS && registro.count >= MAX_PAIR_FAILS) {
      throw new HttpException('demasiados intentos, espera unos minutos', 429);
    }

    try {
      const result = await this.connector.emparejar(body.code ?? '', body.deviceName ?? '');
      this.fallos.delete(ip);
      return result;
    } catch (err) {
      if (err instanceof ConnectorError && err.status === 404) {
        const actual =
          registro && Date.now() - registro.since < PAIR_WINDOW_MS
            ? registro
            : { count: 0, since: Date.now() };
        actual.count += 1;
        this.fallos.set(ip, actual);
      }
      throw traducir(err);
    }
  }

  /** Para que el conector sepa a qué empresa quedó ligado y si sigue autorizado. */
  @Get('me')
  async me(@Req() req: Request) {
    const device = await this.autenticar(req);
    return { organization: device.organization.name, device: device.name };
  }

  @Post('manifest')
  async manifest(@Req() req: Request, @Body() body: { files?: ManifestEntry[] }) {
    const device = await this.autenticar(req);
    if (!Array.isArray(body.files)) throw new HttpException('falta la lista de archivos', 400);
    return this.connector.manifiesto(device, body.files);
  }

  @Put('files')
  async upload(@Req() req: Request, @Query('path') path: string) {
    const device = await this.autenticar(req);

    if (!Buffer.isBuffer(req.body)) {
      throw new HttpException('el archivo debe ir como application/octet-stream', 400);
    }

    try {
      return await this.connector.subir(device, {
        path,
        mimeType: String(req.headers['x-mime-type'] ?? 'application/octet-stream'),
        sha256: req.headers['x-sha256'] ? String(req.headers['x-sha256']) : undefined,
        bytes: req.body,
      });
    } catch (err) {
      throw traducir(err);
    }
  }

  @Delete('files')
  async remove(@Req() req: Request, @Query('path') path: string) {
    const device = await this.autenticar(req);
    try {
      await this.connector.borrar(device, path);
      return { ok: true };
    } catch (err) {
      throw traducir(err);
    }
  }

  private async autenticar(req: Request) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    try {
      return await this.connector.autenticar(token);
    } catch (err) {
      throw traducir(err);
    }
  }
}

function traducir(err: unknown): unknown {
  return err instanceof ConnectorError ? new HttpException(err.message, err.status) : err;
}
