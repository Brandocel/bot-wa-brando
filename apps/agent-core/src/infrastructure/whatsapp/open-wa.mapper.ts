import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import type {
  Attachment,
  IncomingMessage,
  MessageKind,
} from '../../domain/message/incoming-message';
import { LINEA_PRINCIPAL, chatDeLinea } from '../../domain/message/linea';
import { textoDeUbicacion } from '../../domain/message/ubicacion';

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
    // La ubicación (pin) se vuelve texto: ver domain/message/ubicacion.ts.
    case 'location':
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

/** El archivo que el gateway bajó y adjuntó en `media`, si viene completo. */
function adjuntoDe(raw: RawMessage): Attachment | null {
  const m = raw['media'];
  if (!m || typeof m !== 'object') return null;
  const media = m as Record<string, unknown>;
  const mimetype = str(media['mimetype']);
  const base64 = str(media['base64']);
  if (!mimetype || !base64) return null;
  return { mimetype, filename: str(media['filename']) ?? 'archivo', base64 };
}

function deUbicacion(raw: RawMessage): string {
  const lat = Number(raw['lat']);
  const lng = Number(raw['lng']);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return textoDeUbicacion(lat, lng, str(raw['loc']));
}

@Injectable()
export class OpenWaMessageMapper {
  toDomain(raw: RawMessage): IncomingMessage | null {
    const id = str(raw['id']);
    const chatDeWhatsApp = str(raw['chatId']) ?? str(raw['from']);

    // Sin id no hay idempotencia y sin chatId no hay a quién responder.
    // Un mensaje así se descarta: es preferible perderlo que duplicarlo.
    if (!id || !chatDeWhatsApp) return null;

    // Por qué número llegó. Por la línea de una empresa, la conversación es
    // otra aunque la persona sea la misma: ver domain/message/linea.ts.
    const linea = str(raw['linea']);
    const deLineaDeEmpresa = linea !== null && linea !== LINEA_PRINCIPAL;
    const chatId = chatDeLinea(linea, chatDeWhatsApp);

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

    // El chat propio del dueño solo existe en el número principal: en el
    // de una empresa, "yo" es la empresa, no el dueño del bot.
    const isSelfChat =
      !deLineaDeEmpresa &&
      // Señal semántica y la buena: el contacto de este chat soy yo.
      ((!isGroup && chatContact['isMe'] === true) ||
      // Respaldo explícito por si el payload llega sin `chat`.
      (config.ownerSelfChatId !== null && chatId === config.ownerSelfChatId) ||
      // Formas clásicas, previas al direccionamiento por LID.
      (to !== null && from !== null && to === from) ||
      chatId === config.ownerWaId);

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
    // En una ubicación, `body` es la miniatura del mapa en base64: lo que
    // importa son las coordenadas.
    const ubicacion = str(raw['type']) === 'location' ? deUbicacion(raw) : null;
    const body =
      ubicacion ??
      (kind === 'TEXT'
        ? (str(raw['body']) ?? '')
        : (str(raw['caption']) ?? ''));

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
      mentionsMe: !deLineaDeEmpresa && mentions.includes(config.ownerWaId),
      timestamp: seconds ? new Date(seconds * 1000) : new Date(),
      attachment: adjuntoDe(raw),
      // El raw se guarda en la tabla de mensajes: sin los bytes del archivo,
      // que ya viajan en `attachment` y no hacen falta para depurar.
      raw: raw['media'] ? { ...raw, media: { ...(raw['media'] as object), base64: '[omitido]' } } : raw,
    };
  }
}
