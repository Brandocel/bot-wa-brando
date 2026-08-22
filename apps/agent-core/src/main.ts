import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableShutdownHooks(); // para que pg-boss y Prisma cierren limpio
  await app.listen(config.port, '0.0.0.0');

  new Logger('bootstrap').log(`agent-core escuchando en :${config.port}`);
}

void bootstrap();
