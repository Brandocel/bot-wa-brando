import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineContext } from '../pipeline';

// config.ts exige estas variables al cargarse; en el test no se usan.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
process.env.GATEWAY_URL ??= 'http://localhost:1';
process.env.GATEWAY_API_KEY ??= 'x';
process.env.OWNER_WA_ID ??= 'dueno@c.us';

const LIMITES = { porChatHora: 60, globalHora: 100, porChatMinuto: 8, contarDocumentos: false };

/** Prisma de mentira: cuenta lo que se le diga y guarda lo que se encola. */
function prismaFalso(opts: { global: number; porChat: number }) {
  const outbox: { chatId: string; text: string }[] = [];
  const conteos: unknown[] = [];
  return {
    outbox,
    conteos,
    message: {
      count: async (args: { where: Record<string, unknown> }) => {
        conteos.push(args.where);
        return 'conversationId' in args.where ? opts.porChat : opts.global;
      },
    },
    conversation: {
      findUnique: async () => ({ id: 'conv-1', contact: { displayName: 'Cliente' } }),
      update: async () => ({}),
    },
    outboxMessage: {
      create: async (args: { data: { chatId: string; payload: { text: string } } }) => {
        outbox.push({ chatId: args.data.chatId, text: args.data.payload.text });
        return {};
      },
    },
  };
}

function banderasFalsas() {
  const datos = new Map<string, unknown>();
  return {
    get: async <T>(k: string, d: T) => (datos.has(k) ? (datos.get(k) as T) : d),
    set: async (k: string, v: unknown) => { datos.set(k, v); },
  };
}

async function correr(opts: { global: number; porChat: number }, banderas = banderasFalsas()) {
  const { RateLimitFilter } = await import('./rate-limit.filter');
  const prisma = prismaFalso(opts);
  const limites = {
    actuales: async () => LIMITES,
    salientesQueCuentan: () => ({ direction: 'OUT', NOT: { body: { startsWith: '[documento]' } } }),
  };
  const filtro = new RateLimitFilter(prisma as never, limites as never, banderas as never);
  const ctx: PipelineContext = {
    message: { chatId: 'cliente@c.us' } as never,
    role: 'CUSTOMER' as never,
    stoppedBy: null,
    stopReason: null,
  };
  let paso = false;
  await filtro.handle(ctx, async () => { paso = true; });
  return { ctx, paso, prisma, banderas };
}

test('debajo de los topes, el mensaje sigue', async () => {
  const r = await correr({ global: 10, porChat: 5 });
  assert.equal(r.paso, true);
  assert.equal(r.prisma.outbox.length, 0);
});

test('los documentos no cuentan para el tope por chat', async () => {
  const r = await correr({ global: 10, porChat: 5 });
  const porChat = r.prisma.conteos.find((w) => 'conversationId' in (w as object)) as Record<string, unknown>;
  assert.deepEqual(porChat.NOT, { body: { startsWith: '[documento]' } });
});

test('al llegar al tope por chat: se detiene, avisa al cliente una vez y al dueño', async () => {
  const r = await correr({ global: 10, porChat: 60 });
  assert.equal(r.paso, false);
  assert.equal(r.ctx.stoppedBy, 'RateLimitFilter');
  assert.equal(r.prisma.outbox.filter((m) => m.chatId === 'cliente@c.us').length, 1);
  assert.match(r.prisma.outbox.find((m) => m.chatId === 'dueno@c.us')!.text, /llegó a 60 mensajes/);
});

test('al 80 % del tope general avisa al dueño, pero sigue contestando', async () => {
  const r = await correr({ global: 80, porChat: 1 });
  assert.equal(r.paso, true);
  const aviso = r.prisma.outbox.find((m) => m.chatId === 'dueno@c.us');
  assert.match(aviso!.text, /lleva 80 de 100 mensajes/);
});

test('el aviso del 80 % no se repite en la misma hora; el del 100 % sí llega', async () => {
  const banderas = banderasFalsas();
  await correr({ global: 80, porChat: 1 }, banderas);
  const segundo = await correr({ global: 85, porChat: 1 }, banderas);
  assert.equal(segundo.prisma.outbox.length, 0, 'mismo nivel: no se repite');

  const tope = await correr({ global: 100, porChat: 1 }, banderas);
  assert.equal(tope.paso, false, 'al 100 % deja de contestar');
  assert.match(tope.prisma.outbox[0]!.text, /llegó al tope general/);
});
