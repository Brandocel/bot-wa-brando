import { chatDeLinea, separarChat } from './linea';

/**
 * Chats de prueba del equipo (panel → Chat de prueba).
 *
 * Corren el flujo real —filtros, permisos, búsqueda, entrega— con un
 * remitente real, pero en un chat aparte: el chat de WhatsApp lleva esta
 * marca, el adaptador de salida no le manda nada al gateway, y el panel
 * los esconde de Conversaciones, Pendientes y Tickets.
 */
export const MARCA_PRUEBA = 'prueba-';

/** El chatId de prueba de ese remitente, en esa línea (null = principal). */
export function chatDePrueba(linea: string | null, waId: string): string {
  return chatDeLinea(linea, MARCA_PRUEBA + waId);
}

export function esChatDePrueba(chatId: string): boolean {
  return separarChat(chatId).chat.startsWith(MARCA_PRUEBA);
}
