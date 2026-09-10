/**
 * PORT. La aplicación declara lo que necesita; no le importa quién lo cumple.
 * Hoy lo implementa el gateway de open-wa; mañana puede ser Baileys o la
 * Cloud API sin que esta interfaz cambie.
 */

/**
 * Archivo a entregar. `url` o `base64`, nunca una ruta local: el disco del
 * gateway no es el del core.
 */
export interface OutgoingFile {
  url?: string;
  base64?: string;
  filename: string;
  caption?: string;
}

export interface MessagingPort {
  sendText(to: string, text: string): Promise<string>;
  sendFile(to: string, file: OutgoingFile): Promise<string>;
  setTyping(to: string, on: boolean): Promise<void>;
  markSeen(to: string): Promise<void>;
}

/** Token de inyección: las clases del dominio no se referencian directo. */
export const MESSAGING_PORT = Symbol('MessagingPort');
