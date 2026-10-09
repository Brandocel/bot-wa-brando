import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';

/** Dónde vive el panel nuevo mientras convive con el clásico (/panel). */
const PREFIJO = '/panel/v2';

/**
 * Sirve el panel nuevo (apps/panel, ya compilado) desde este mismo servicio:
 * mismo origen que /panel/api, así la cookie de sesión vale sin CORS ni un
 * despliegue aparte que se desincronice de la API.
 *
 * Los archivos son públicos a propósito: es solo el cascarón. Todo dato sale
 * de /panel/api, que sí pasa por el guard.
 *
 * La ruta sale igual desde src/ (tsx) que desde dist/: esta carpeta queda a
 * la misma profundidad de apps/ en los dos.
 */
export function montarPanelNuevo(app: NestExpressApplication): void {
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
  app.use(PREFIJO, express.static(carpeta, { index: false }));

  // Cualquier otra ruta es del router del navegador. El índice nunca se
  // guarda: es lo que apunta a los assets del último despliegue.
  app.use(PREFIJO, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indice);
  });
}
