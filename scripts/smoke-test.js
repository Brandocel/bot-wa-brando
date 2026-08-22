// Prueba de la Fase 2 sin WhatsApp: inyecta mensajes por el webhook
// y verifica qué respuesta quedó en el outbox.
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const KEY = process.env.GATEWAY_API_KEY;
const OWNER = process.env.OWNER_WA_ID;
const SELF_CHAT = process.env.OWNER_SELF_CHAT_ID;
const LEAD = '5210000000001@c.us';
const LEAD_CHAT = '999000111222@lid';

const prisma = new PrismaClient();
let n = 0;

function payload({ owner, body }) {
  n++;
  return {
    event: 'message',
    payload: {
      id: `test_${Date.now()}_${n}`,
      chatId: owner ? SELF_CHAT : LEAD_CHAT,
      from: owner ? OWNER : LEAD,
      to: owner ? SELF_CHAT : LEAD_CHAT,
      body,
      type: 'chat',
      t: Math.floor(Date.now() / 1000),
      isGroupMsg: false,
      fromMe: !!owner,
      sender: { id: owner ? OWNER : LEAD, pushname: owner ? 'Yo' : 'Lead Falso' },
      chat: { contact: { id: owner ? OWNER : LEAD, isMe: !!owner } },
    },
  };
}

async function send(opts) {
  const chatId = opts.owner ? SELF_CHAT : LEAD_CHAT;
  const before = await prisma.outboxMessage.count({ where: { chatId } });

  const res = await fetch('http://localhost:3000/webhooks/wa', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gateway-key': KEY },
    body: JSON.stringify(payload(opts)),
  });
  if (!res.ok) throw new Error();

  // Espera activa: pg-boss sondea cada ~2s y el outbox agrega retraso humano.
  // Un sleep fijo daba falsos negativos por un paso de desfase.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const now = await prisma.outboxMessage.count({ where: { chatId } });
    if (now > before) return true;
  }
  return false; // nada salio: puede ser lo esperado (pausa)
}

async function lastReply(owner) {
  const chatId = owner ? SELF_CHAT : LEAD_CHAT;
  const row = await prisma.outboxMessage.findFirst({
    where: { chatId },
    orderBy: { createdAt: 'desc' },
  });
  return row ? row.payload.text : null;
}

function check(label, actual, predicate) {
  const ok = predicate(actual);
  console.log(`${ok ? 'PASA' : 'FALLA'}  ${label}`);
  if (!ok) console.log(`        obtenido: ${JSON.stringify(actual)}`);
  return ok;
}

(async () => {
  await prisma.outboxMessage.deleteMany({});
  await prisma.contact.deleteMany({ where: { waId: LEAD } });
  await prisma.systemFlag.deleteMany({});

  const results = [];

  await send({ owner: false, body: 'hola' });
  results.push(
    check('lead recibe eco', await lastReply(false), (r) =>
      String(r).includes('eco (prospect): hola'),
    ),
  );

  await send({ owner: true, body: '/estado' });
  results.push(
    check('/estado responde', await lastReply(true), (r) =>
      String(r).includes('activo') && String(r).includes('Prospectos'),
    ),
  );

  await send({ owner: true, body: '/pausa' });
  results.push(
    check('/pausa confirma', await lastReply(true), (r) =>
      String(r).includes('pausa'),
    ),
  );

  const beforePause = await lastReply(false);
  await send({ owner: false, body: 'sigo aqui' });
  results.push(
    check(
      'lead NO recibe nada en pausa',
      await lastReply(false),
      (r) => r === beforePause,
    ),
  );

  await send({ owner: true, body: '/ayuda' });
  results.push(
    check('dueño SI responde en pausa', await lastReply(true), (r) =>
      String(r).includes('Comandos disponibles'),
    ),
  );

  await send({ owner: true, body: '/reanuda' });
  results.push(
    check('/reanuda confirma', await lastReply(true), (r) =>
      String(r).includes('activo'),
    ),
  );

  await send({ owner: false, body: 'ya volviste?' });
  results.push(
    check('lead recibe eco otra vez', await lastReply(false), (r) =>
      String(r).includes('eco (prospect): ya volviste?'),
    ),
  );

  await send({ owner: true, body: '/noexiste' });
  results.push(
    check('comando desconocido avisa', await lastReply(true), (r) =>
      String(r).includes('/ayuda'),
    ),
  );

  console.log('');
  console.log(`${results.filter(Boolean).length}/${results.length} pruebas pasaron`);

  await prisma.outboxMessage.deleteMany({});
  await prisma.contact.deleteMany({ where: { waId: LEAD } });
  await prisma.systemFlag.deleteMany({});
  await prisma.$disconnect();
  process.exit(results.every(Boolean) ? 0 : 1);
})();
