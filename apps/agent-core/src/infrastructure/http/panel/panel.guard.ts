import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PanelAuthService, SESSION_COOKIE, type PanelIdentity } from './panel-auth.service';

/**
 * Guard del panel. Todo lo que cuelga de /panel/api pasa por aquí.
 *
 * La cookie se lee a mano en vez de instalar cookie-parser: es una cookie,
 * no hay nada que valga una dependencia más en el árbol.
 */
@Injectable()
export class PanelGuard implements CanActivate {
  constructor(private readonly auth: PanelAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PanelRequest>();
    const identity = await this.auth.resolve(readCookie(request, SESSION_COOKIE));

    if (!identity) throw new UnauthorizedException('sesión no válida');

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
