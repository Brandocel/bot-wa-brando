import type { Prisma } from '@prisma/client';
import { MARCA_PRUEBA } from '../../../domain/message/prueba';

/** Los chats de prueba del equipo no cuentan ni se listan como trabajo real. */
export const SIN_PRUEBA = {
  NOT: { chatId: { contains: MARCA_PRUEBA } },
} satisfies Prisma.ConversationWhereInput;

/** Ni sus tickets. */
export const TICKET_SIN_PRUEBA = {
  conversation: { NOT: { chatId: { contains: MARCA_PRUEBA } } },
} satisfies Prisma.TicketWhereInput;
