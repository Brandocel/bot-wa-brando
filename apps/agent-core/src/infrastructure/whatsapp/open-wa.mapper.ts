import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import type {
  IncomingMessage,
  MessageKind,
} from '../../domain/message/incoming-message';

/**
 * ANTI-CORRUPTION LAYER.
 *
 * Este es el único archivo del core que conoce la forma de open-wa. Todo lo
 * demás habla `IncomingMessage`. Cuando open-wa cambie el payload entre
 * versiones —y lo va a hacer— se rompe aquí y solo aquí.
 *
 * Nada se tipa con las interfaces de open-wa a propósito: el payload llega
 * por HTTP desde otro proceso, así que es dato no confiable hasta que este
 * mapper lo valida.
 */

type RawMessage = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mapKind(rawType: string | null): MessageKind {
  switch (rawType) {
    case 'chat':
    case 'text':
      return 'TEXT';
    case 'ptt':
    case 'audio':
      return 'AUDIO';
    case 'image':
      return 'IMAGE';
    case 'document':
      return 'DOCUMENT';
    default:
      return 'UNSUPPORTED';
  }
}

@Injectable()
export class OpenWaMessageMapper {
  toDomain(raw: RawMessage): IncomingMessage | null {
    const id = str(raw['id']);
    const chatId = str(raw['chatId']) ?? str(raw['from']);

    // Sin id no hay idempotencia y sin chatId no hay a quién responder.
    // Un mensaje así se descarta: es preferible perderlo que duplicarlo.
    if (!id || !chatId) return null;

    const isGroup = raw['isGroupMsg'] === true;
    const sender = (raw['sender'] ?? {}) as Record<string, unknown>;

    // En grupos, `from` es el grupo y `author` es la persona.
    const senderId =
      (isGroup ? str(raw['author']) : null) ??
      str(sender['id']) ??
      str(raw['from']) ??
      chatId;

    const mentions = Array.isArray(raw['mentionedJidList'])
      ? (raw['mentionedJidList'] as unknown[]).filter(
          (m): m is string => typeof m === 'string',
        )
      : [];

    const kind = mapKind(str(raw['type']));

    /**
     * Detección del chat conmigo mismo.
     *
     * WhatsApp ya direcciona chats con LID, así que el chatId del chat propio
     * NO es `<mi numero>@c.us` sino algo como `108817861898421@lid`. Comparar
     * contra el número no sirve.
     *
     * Lo que sí se cumple siempre: en el chat propio remitente y destinatario
     * son la misma cuenta. Se acepta también la forma clásica por si WhatsApp
     * devuelve el JID de siempre en algunos casos.
     */
    const to = str(raw['to']);
    const from = str(raw['from']);
    const chat = (raw['chat'] ?? {}) as Record<string, unknown>;
    const chatContact = (chat['contact'] ?? {}) as Record<string, unknown>;

    const isSelfChat =
      // Señal semántica y la buena: el contacto de este chat soy yo.
      (!isGroup && chatContact['isMe'] === true) ||
      // Respaldo explícito por si el payload llega sin `chat`.
      (config.ownerSelfChatId !== null && chatId === config.ownerSelfChatId) ||
      // Formas clásicas, previas al direccionamiento por LID.
      (to !== null && from !== null && to === from) ||
      chatId === config.ownerWaId;

    /**
     * En un mensaje de texto, `body` ES el texto. En uno con media, `body`
     * son los BYTES del archivo en base64 y el texto está en `caption`.
     *
     * Dejar pasar ese base64 como si fuera lo que escribió la persona es
     * exactamente lo que hacía que una foto se leyera como un comando: el
     * base64 de un JPEG empieza por `/9j/`, con barra, así que el bot
     * contestaba "No conozco /9j/4AAQSkZJRg..." con medio archivo dentro.
     *
     * Que esto se corrija aquí y no más abajo es el punto de la capa
     * anticorrupción: el dominio no tiene por qué saber que open-wa mete
     * archivos en un campo llamado `body`.
     */
    const body =
      kind === 'TEXT'
        ? (str(raw['body']) ?? '')
        : (str(raw['caption']) ?? '');

    // `t` viene en segundos, no en milisegundos. Confundirlos deja todos los
    // mensajes en 1970.
    const seconds = typeof raw['t'] === 'number' ? raw['t'] : null;

    return {
      id,
      chatId,
      senderId,
      senderName:
        str(sender['formattedName']) ??
        str(sender['pushname']) ??
        str(raw['notifyName']),
      kind,
      body,
      isGroup,
      isFromMe: raw['fromMe'] === true,
      isSelfChat,
      isBroadcast:
        raw['isBroadcast'] === true ||
        chatId === 'status@broadcast' ||
        chatId.endsWith('@broadcast') ||
        chatId.endsWith('@newsletter'),
      mentionsMe: mentions.includes(config.ownerWaId),
      timestamp: seconds ? new Date(seconds * 1000) : new Date(),
      raw,
    };
  }
}
