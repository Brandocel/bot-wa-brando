/**
 * Ejercita la conversación completa contra los datos del seed, con un LLM
 * falso. Sin gastar un centavo y sin depender de la red.
 *
 * Lo que se prueba aquí es lo que evita que el bot se pierda: el presupuesto
 * de preguntas, la desambiguación entre empresas, y que 0 resultados escale
 * en vez de inventar. Nada de eso depende del modelo — depende del código
 * que rodea al modelo, que es justo el punto.
 *
 * Correr con: npx tsx scripts/dev/verify-strategy.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { AccessScopeService } from '../../apps/agent-core/src/application/support/access-scope.service';
import { DocumentDeliveryService } from '../../apps/agent-core/src/application/support/document-delivery.service';
import { DocumentSearchService } from '../../apps/agent-core/src/application/support/document-search.service';
import { SlotExtractorService } from '../../apps/agent-core/src/application/support/slot-extractor.service';
import { SupportStrategy } from '../../apps/agent-core/src/application/support/support.strategy';
import { TicketService } from '../../apps/agent-core/src/application/support/ticket.service';
import type { LlmPort } from '../../apps/agent-core/src/application/ports/llm.port';
import type { IncomingMessage } from '../../apps/agent-core/src/domain/message/incoming-message';

const prisma = new PrismaClient();

/**
 * LLM falso: nunca extrae nada y nunca redacta.
 *
 * Es el peor caso a propósito. Si con el modelo completamente inútil el bot
 * sigue negando lo que debe negar y escalando en vez de adivinar, entonces
 * la seguridad no depende del modelo. Ese es el invariante que importa.
 */
const deadLlm: LlmPort = {
  extract: async () => null,
  draft: async () => null,
};

const scope = new AccessScopeService(prisma as never);
const search = new DocumentSearchService(prisma as never);
const tickets = new TicketService(prisma as never);
const slots = new SlotExtractorService(deadLlm);
const delivery = new DocumentDeliveryService(prisma as never, {
  startCursor: async () => '',
  listFolder: async () => [],
  changesSince: async () => ({ files: [], nextCursor: '', done: true }),
  // Los documentos del seed son ficticios: no hay bytes que bajar. Se
  // simula la descarga para poder ejercitar el resto del camino.
  download: async () => Buffer.from('PDF de prueba'),
});

const strategy = new SupportStrategy(scope, slots, search, delivery, tickets, deadLlm);

interface Turn {
  waId: string;
  text: string;
  expect: string;
}

const TURNS: Turn[] = [
  {
    waId: '5215500000001@c.us',
    text: 'Hola, necesito la factura de febrero 2026',
    expect: 'la entrega',
  },
  {
    waId: '5215500000004@c.us',
    text: 'me mandas la factura de febrero 2026',
    expect: 'no encontré (sin grant) + escala',
  },
  {
    waId: '5215500000099@c.us',
    text: 'necesito la factura de febrero 2026',
    expect: 'pregunta de qué empresa',
  },
  {
    waId: '5215599999999@c.us',
    text: 'quiero una factura',
    expect: 'null (sin membresía, no es para esta Strategy)',
  },
  {
    waId: '5215500000001@c.us',
    text: 'necesito un documento',
    expect: 'pregunta de qué mes (sin LLM no saca el periodo)',
  },
];

function fakeMessage(waId: string, text: string): IncomingMessage {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    chatId: waId,
    senderId: waId,
    senderName: 'Prueba',
    body: text,
    kind: 'TEXT',
    isFromMe: false,
    isSelfChat: false,
    raw: {},
  } as IncomingMessage;
}

async function main(): Promise<void> {
  for (const turn of TURNS) {
    const contact = await prisma.contact.findUnique({
      where: { waId: turn.waId },
      select: { id: true },
    });

    // Conversación aislada por caso: si compartieran una, el ticket abierto
    // de un caso reengancharía en el siguiente y las pruebas se ensuciarían.
    const conversation = contact
      ? await prisma.conversation.upsert({
          where: { chatId: `test-${turn.waId}-${TURNS.indexOf(turn)}` },
          create: {
            chatId: `test-${turn.waId}-${TURNS.indexOf(turn)}`,
            contactId: contact.id,
          },
          update: {},
        })
      : null;

    const reply =
      contact && conversation
        ? await strategy.handle(fakeMessage(turn.waId, turn.text), {
            contactId: contact.id,
            conversationId: conversation.id,
          })
        : await strategy.handle(fakeMessage(turn.waId, turn.text), {
            contactId: 'inexistente',
            conversationId: 'inexistente',
          });

    console.log(`${turn.waId}  "${turn.text}"`);
    console.log(`   esperado: ${turn.expect}`);
    console.log(`   obtenido: ${reply === null ? 'null' : reply.replace(/\n/g, ' | ')}\n`);
  }

  // Limpieza: los tickets de prueba no deben quedar en la cola del operador.
  const testConversations = await prisma.conversation.findMany({
    where: { chatId: { startsWith: 'test-' } },
    select: { id: true },
  });
  await prisma.ticket.deleteMany({
    where: { conversationId: { in: testConversations.map((c) => c.id) } },
  });
  await prisma.conversation.deleteMany({
    where: { chatId: { startsWith: 'test-' } },
  });
  await prisma.outboxMessage.deleteMany({
    where: { chatId: { startsWith: '52155000000' } },
  });

  await prisma.$disconnect();
}

void main();
