import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PanelAuthService, SESSION_COOKIE } from './panel-auth.service';
import { readCookie } from './panel.guard';
import { loginPage, panelPage } from './panel.page';

/**
 * Las dos páginas del panel. La API vive en PanelApiController.
 *
 * Aquí no se usa el guard: un guard devolvería 401 y lo que quiere un
 * navegador es que lo manden a la pantalla de entrar.
 */
@Controller('panel')
export class PanelController {
  constructor(private readonly auth: PanelAuthService) {}

  @Get()
  async index(@Req() req: Request, @Res() res: Response): Promise<void> {
    const identity = await this.auth.resolve(readCookie(req, SESSION_COOKIE));

    if (!identity) {
      res.redirect('/panel/login');
      return;
    }

    res.type('html').send(panelPage());
  }

  @Get('login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Ya con sesión, la pantalla de entrar no tiene nada que hacer.
    const identity = await this.auth.resolve(readCookie(req, SESSION_COOKIE));

    if (identity) {
      res.redirect('/panel');
      return;
    }

    res.type('html').send(loginPage());
  }
}
