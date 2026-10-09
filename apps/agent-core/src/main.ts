import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './config';
import { montarPanelNuevo } from './infrastructure/http/panel/panel-spa';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Render pone un proxy delante: sin esto req.ip es la del proxy y el
  // freno de intentos del conector trataría a todos como una sola IP.
  app.set('trust proxy', 1);

  // El manifiesto del conector lista toda una carpeta: pasa de los 100 KB
  // que Express acepta por defecto. Y los archivos suben en crudo.
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: '26mb' });

  montarPanelNuevo(app);

  app.enableShutdownHooks(); // para que pg-boss y Prisma cierren limpio
  await app.listen(config.port, '0.0.0.0');

  new Logger('bootstrap').log(`agent-core escuchando en :${config.port}`);
}

void bootstrap();
