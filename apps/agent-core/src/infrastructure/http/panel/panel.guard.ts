import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PanelAuthService, SESSION_COOKIE, type PanelIdentity } from './panel-auth.service';

/**
 * Guard del panel. Todo lo que cuelga de /panel/api pasa por aquí.
 *
 * La cookie se lee a mano en vez de instalar cookie-parser: es una cookie,
 * no hay nada que valga una dependencia más en el árbol.
 */
const PARA_EMPRESA = 'panel:paraEmpresa';

/**
 * Marca una ruta como apta para un usuario de empresa (role EMPRESA). Sin
 * esta marca, el guard le niega la ruta: lo nuevo nace cerrado para ellos y
 * hay que abrirlo a propósito, comprobando dentro que solo toque lo suyo.
 */
export const ParaEmpresa = () => SetMetadata(PARA_EMPRESA, true);

@Injectable()
export class PanelGuard implements CanActivate {
  constructor(
    private readonly auth: PanelAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PanelRequest>();
    const identity = await this.auth.resolve(readCookie(request, SESSION_COOKIE));

    if (!identity) throw new UnauthorizedException('sesión no válida');

    if (identity.role === 'EMPRESA') {
      const permitida = this.reflector.getAllAndOverride<boolean>(PARA_EMPRESA, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!permitida) throw new ForbiddenException('esta sección no está disponible para tu empresa');
    }

    request.panelUser = identity;
    return true;
  }
}

export interface PanelRequest extends Request {
  panelUser?: PanelIdentity;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }

  return null;
}
