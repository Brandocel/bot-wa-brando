/**
 * PORT. La aplicación declara lo que necesita; no le importa quién lo cumple.
 * Hoy lo implementa el gateway de open-wa; mañana puede ser Baileys o la
 * Cloud API sin que esta interfaz cambie.
 */
export interface MessagingPort {
  sendText(to: string, text: string): Promise<string>;
  setTyping(to: string, on: boolean): Promise<void>;
  markSeen(to: string): Promise<void>;
}

/** Token de inyección: las clases del dominio no se referencian directo. */
export const MESSAGING_PORT = Symbol('MessagingPort');
