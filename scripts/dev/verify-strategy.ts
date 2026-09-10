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
import {
  SupportStrategy,
  type StrategyReply,
} from '../../apps/agent-core/src/application/support/support.strategy';
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

/**
 * La respuesta trae texto Y bandera. La bandera es la mitad que importa
 * revisar: un texto correcto con el turno mal asignado deja la conversación
 * fuera de la bandeja del operador, y nadie la vuelve a mirar.
 */
function describir(reply: StrategyReply | null): string {
  if (reply === null) return 'null';
  const tema = reply.topic ? `, tema ${reply.topic}` : '';
  const texto = reply.text.split('\n').join(' | ');
  return `[espera ${reply.awaiting}${tema}] ${texto}`;
}

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

/**
 * Una conversación de varios turnos sobre la MISMA conversación.
 *
 * Reproduce el bucle que se vio en producción: el bot preguntaba el mes,
 * le contestaban el mes, y al turno siguiente volvía a preguntar el tipo de
 * documento porque no recordaba nada. Cada turno se extrae por separado, así
 * que sin fusionar slots contra el ticket la conversación no avanza nunca.
 */
async function conversacion(
  titulo: string,
  turnos: string[],
  waId = '5215500000001@c.us',
): Promise<void> {
  const chatId = 'test-conversacion';

  const contact = await prisma.contact.findUniqueOrThrow({
    where: { waId },
    select: { id: true },
  });

  const conversation = await prisma.conversation.upsert({
    where: { chatId },
    create: { chatId, contactId: contact.id },
    update: {},
  });

  console.log(`=== ${titulo} ===\n`);

  for (const texto of turnos) {
    const reply = await strategy.handle(fakeMessage(waId, texto), {
      contactId: contact.id,
      conversationId: conversation.id,
    });
    console.log(`  tú:  ${texto}`);
    console.log(`  bot: ${describir(reply)}\n`);
  }

  // Cada conversación arranca limpia: un ticket abierto de la anterior
  // reengancharía y contaminaría el resultado.
  await prisma.ticket.deleteMany({ where: { conversationId: conversation.id } });
}

/**
 * Borra lo que dejaron corridas anteriores.
 *
 * Se llama al PRINCIPIO, no solo al final: si una corrida se cae a media
 * ejecución, sus tickets quedan vivos y la siguiente los reengancha — con
 * sus preguntas ya hechas. El resultado es una tanda de fallos que no
 * tienen nada que ver con el código y cuesta un rato entender.
 */
async function limpiar(): Promise<void> {
  const conversaciones = await prisma.conversation.findMany({
    where: { chatId: { startsWith: 'test-' } },
    select: { id: true },
  });

  await prisma.ticket.deleteMany({
    where: { conversationId: { in: conversaciones.map((c) => c.id) } },
  });
  await prisma.conversation.deleteMany({
    where: { chatId: { startsWith: 'test-' } },
  });
  await prisma.outboxMessage.deleteMany({
    where: { chatId: { startsWith: '52155000000' } },
  });
}

async function main(): Promise<void> {
  await limpiar();

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
    console.log(`   obtenido: ${describir(reply)}\n`);
  }

  // La conversación de varios turnos va ANTES de limpiar: si no, borraría
  // el ticket a medio camino y el segundo turno arrancaría de cero, que es
  // justo el bug que este caso existe para detectar.
  await conversacion('Conversación por partes: no debe repetir preguntas', [
    'Alguna factura',
    'de febrero 2026',
  ]);

  await conversacion('Respuesta que no aporta: no insiste, escala', [
    'necesito un documento',
    'ya te dije cuál',
  ]);

  // El caso que se vio en producción: pide con folio, hay dos empresas, y
  // al elegir una NO debe olvidarse del folio que ya había dicho.
  await conversacion(
    'Elegir empresa por número sin perder lo ya dicho',
    ['Tienes la factura A1002', '1'],
    '5215500000099@c.us',
  );

  // Y también al terminar: los tickets de prueba no deben quedar en la cola
  // del operador.
  await limpiar();

  await prisma.$disconnect();
}

void main();
