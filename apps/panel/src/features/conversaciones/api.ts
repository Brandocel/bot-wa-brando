import { useQuery } from '@tanstack/react-query';
import type { Tone } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { numeroBonito } from '@/lib/format';

export type Turno = 'BOT' | 'AGENTE' | 'CLIENTE' | 'NADIE';
export type EstadoTicket = 'ABIERTO' | 'EN_REVISION' | 'CERRADO';
export type FiltroChats = 'todas' | 'persona' | 'BOT' | 'CLIENTE';

interface Contacto {
  displayName: string | null;
  waId: string;
}

/** Una fila de la bandeja: una persona, no un chatId. */
export interface Chat {
  id: string;
  chatId: string;
  topic: string | null;
  awaiting: Turno;
  lastInboundAt: string | null;
  contact: Contacto | null;
  tickets: Array<{ number: number; state: EstadoTicket }>;
  enManosDePersona: boolean;
  ultimo: { body: string; direction: 'IN' | 'OUT'; createdAt: string } | null;
  quejas: number;
}

export interface TicketHilo {
  id: string;
  number: number;
  subject: string;
  state: EstadoTicket;
  createdAt: string;
  closeReason: string | null;
}

export interface Mensaje {
  id: string;
  direction: 'IN' | 'OUT';
  body: string;
  createdAt: string;
  intent: string | null;
  motivo: string | null;
  molesto: boolean | null;
  /** "persona:<correo>" si lo escribió el equipo; otra cosa, el bot; null, no se sabe. */
  sentBy: string | null;
}

/** Un saliente que todavía no confirma WhatsApp, o que falló hace poco. */
export interface Pendiente {
  id: string;
  body: string;
  status: 'PENDING' | 'FAILED';
  error?: string | null;
  sentBy?: string | null;
}

export interface Hilo {
  chatId: string;
  topic: string | null;
  awaiting: Turno;
  handoffUntil: string | null;
  enManosDePersona: boolean;
  contact:
    | (Contacto & {
        memberships: Array<{ role: string; verifiedAt: string | null; organization: { name: string } }>;
      })
    | null;
  tickets: TicketHilo[];
  messages: Mensaje[];
  pendientes: Pendiente[];
}

export const claveChats = (filtro: FiltroChats) => ['chats', filtro] as const;
export const claveHilo = (chatId: string) => ['hilo', chatId] as const;

export function useChats(filtro: FiltroChats) {
  return useQuery({
    queryKey: claveChats(filtro),
    queryFn: () => api.get<Chat[]>('bandeja', { esperando: filtro === 'todas' ? undefined : filtro }),
    refetchInterval: 20_000,
  });
}

/** Con un hilo abierto se refresca cada 5 s: lo que conteste el cliente aparece solo. */
export function useHilo(chatId: string) {
  return useQuery({
    queryKey: claveHilo(chatId),
    queryFn: () => api.get<Hilo | null>('conversacion', { chatId }),
    refetchInterval: 5_000,
  });
}

/** Qué empresa atiende cada línea de WhatsApp, para etiquetar por dónde llegó un chat. */
export function useNombresDeLinea(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => api.get<Array<{ name: string; waLineId: string | null }>>('empresas'),
    staleTime: 60_000,
  });
  return Object.fromEntries((data ?? []).filter((o) => o.waLineId).map((o) => [o.waLineId!, o.name]));
}

export const nombreDe = (contacto: Contacto | null, chatId: string): string =>
  contacto?.displayName || numeroBonito(contacto?.waId) || numeroBonito(chatId);

/** En qué está una conversación, en palabras y con su color. */
export function estadoDe(c: {
  enManosDePersona: boolean;
  awaiting: Turno;
  tickets: Array<{ state: EstadoTicket }>;
}): { texto: string; tono: Tone } {
  if (c.enManosDePersona) return { texto: 'Lo atiendes tú', tono: 'primary' };
  if (c.awaiting === 'AGENTE' || c.tickets.some((t) => t.state === 'EN_REVISION')) {
    return { texto: 'Espera a una persona', tono: 'warning' };
  }
  if (c.awaiting === 'BOT') return { texto: 'Sin responder', tono: 'danger' };
  if (c.awaiting === 'CLIENTE') return { texto: 'Espera al cliente', tono: 'info' };
  return { texto: 'Al día', tono: 'neutral' };
}
