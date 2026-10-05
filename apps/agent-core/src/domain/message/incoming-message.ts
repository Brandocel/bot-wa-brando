/**
 * Capa de DOMINIO: TypeScript puro.
 *
 * Regla dura: este archivo (y todo `domain/`) no importa NestJS, ni Prisma,
 * ni open-wa. Si algún día aparece un import de esos aquí, la arquitectura
 * ya se rompió.
 */

export type MessageKind =
  | 'TEXT'
  | 'AUDIO'
  | 'IMAGE'
  | 'DOCUMENT'
  | 'UNSUPPORTED';

export interface Attachment {
  mimetype: string;
  filename: string;
  /** Los bytes en base64, sin prefijo data:. */
  base64: string;
}

/** Rol del interlocutor. Decide qué Strategy atiende la conversación. */
export type Role = 'OWNER' | 'PROSPECT' | 'CUSTOMER' | 'BLOCKED';

/**
 * Un mensaje entrante, ya traducido a nuestro lenguaje.
 * Nada aquí tiene la forma de open-wa: de eso se encarga el mapper.
 */
export interface IncomingMessage {
  /** messageId de WhatsApp. Es nuestra llave de idempotencia. */
  readonly id: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly senderName: string | null;
  readonly kind: MessageKind;
  readonly body: string;
  readonly isGroup: boolean;
  readonly isFromMe: boolean;
  /**
   * El chat "Mensajes contigo mismo": donde vive el asistente personal.
   *
   * No basta con `isFromMe`: mis mensajes escritos a mano en el chat de un
   * cliente también son míos, y ahí el bot NO debe intervenir.
   */
  readonly isSelfChat: boolean;
  readonly isBroadcast: boolean;
  readonly mentionsMe: boolean;
  readonly timestamp: Date;
  /**
   * El archivo que mandó la persona, cuando el gateway lo pudo bajar. Hoy
   * solo PDFs chicos (la Constancia de Situación Fiscal para facturar).
   */
  readonly attachment?: Attachment | null;
  /** Payload original, solo para depurar el mapper. Nunca para lógica. */
  readonly raw: unknown;
}
