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

/** Lo que WhatsApp dice de un número. La verdad sobre su formato. */
export interface NumberCheck {
  exists: boolean;
  waId: string | null;
}

export interface MessagingPort {
  sendText(to: string, text: string): Promise<string>;
  /**
   * Comprueba un número contra WhatsApp. Devuelve su id canónico.
   * Lanza si no se pudo comprobar: "no contestó" no es lo mismo que "no
   * existe", y confundirlos daría de baja a gente válida.
   */
  checkNumber(candidate: string): Promise<NumberCheck>;
  sendFile(to: string, file: OutgoingFile): Promise<string>;
  setTyping(to: string, on: boolean): Promise<void>;
  markSeen(to: string): Promise<void>;
}

/** Token de inyección: las clases del dominio no se referencian directo. */
export const MESSAGING_PORT = Symbol('MessagingPort');
