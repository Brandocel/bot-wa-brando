import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';

/** Donde vive el panel. Su API va en /panel/api y no pasa por aquí. */
const PREFIJO = '/panel';
const API = `${PREFIJO}/api`;

/**
 * Sirve el panel (apps/panel, ya compilado) desde este mismo servicio:
 * mismo origen que /panel/api, así la cookie de sesión vale sin CORS ni un
 * despliegue aparte que se desincronice de la API.
 *
 * Los archivos son públicos a propósito: es solo el cascarón. Todo dato sale
 * de /panel/api, que sí pasa por el guard.
 *
 * La ruta sale igual desde src/ (tsx) que desde dist/: esta carpeta queda a
 * la misma profundidad de apps/ en los dos.
 */
export function montarPanel(app: NestExpressApplication): void {
  // Enlaces viejos a /panel/v2/... siguen funcionando.
  app.use('/panel/v2', (req: Request, res: Response) => {
    res.redirect(301, `${PREFIJO}${req.url === '/' ? '' : req.url}`);
  });

  const carpeta = join(__dirname, '..', '..', '..', '..', '..', 'panel', 'dist');
  const indice = join(carpeta, 'index.html');

  if (!existsSync(indice)) {
    new Logger('panel').warn(`${PREFIJO} no disponible: falta compilar apps/panel (npm run build --workspace=panel)`);
    return;
  }

  // Los assets llevan hash en el nombre: se pueden guardar para siempre.
  app.use(
    `${PREFIJO}/assets`,
    express.static(join(carpeta, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
  );

  app.use(PREFIJO, (req: Request, res: Response, next: NextFunction) => {
    // La API la atiende Nest, nunca el cascarón.
    if (req.originalUrl.startsWith(API)) return next();
    return express.static(carpeta, { index: false })(req, res, () => {
      // Cualquier otra ruta es del router del navegador. El índice nunca se
      // guarda: es lo que apunta a los assets del último despliegue.
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indice);
    });
  });
}
