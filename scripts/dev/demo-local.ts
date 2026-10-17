/**
 * Levanta SOLO la demo pública (POST /demo/chat) para probarla con la web
 * en local, sin el resto del core: no abre la base, ni la cola, ni Drive,
 * ni WhatsApp. Pega a Anthropic con ANTHROPIC_API_KEY del .env (cuesta
 * centavos por mensaje).
 *
 * Correr con: npx tsx --tsconfig apps/agent-core/tsconfig.json scripts/dev/demo-local.ts
 * Escucha en DEMO_LOCAL_PORT (3200 por omisión). La web apunta aquí con
 * NEXT_PUBLIC_DEMO_API=http://localhost:3200.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DemoAgenteService } from '../../apps/agent-core/src/application/demo/demo-agente.service';
import { LLM_PORT } from '../../apps/agent-core/src/application/ports/llm.port';
import { DemoController } from '../../apps/agent-core/src/infrastructure/http/demo.controller';
import { AnthropicAdapter } from '../../apps/agent-core/src/infrastructure/llm/anthropic.adapter';

// El adaptador pide el modelo de cada tarea a la base; la demo siempre manda
// el suyo, así que aquí basta un sustituto que nunca se llama.
const sinBase = { para: async () => 'claude-haiku-4-5-20251001' };

@Module({
  controllers: [DemoController],
  providers: [DemoAgenteService, { provide: LLM_PORT, useFactory: () => new AnthropicAdapter(sinBase as never) }],
})
class DemoLocal {}

async function main(): Promise<void> {
  const app = await NestFactory.create(DemoLocal, { logger: ['error', 'warn', 'log'] });
  const puerto = Number(process.env.DEMO_LOCAL_PORT ?? 3200);
  await app.listen(puerto, '127.0.0.1');
  console.log(`demo en http://localhost:${puerto}/demo/chat`);
}

void main();
