import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Tone } from '@/components/ui/badge';
import { CLAVE_RESUMEN } from '@/app/layout/resumen';
import { api } from '@/lib/api';

export type TipoPendiente = 'persona' | 'sin_responder' | 'pedido' | 'factura' | 'documentos';
export type Grupo = 'todo' | 'personas' | 'pedidos' | 'facturas' | 'documentos';

/** Algo que pide acción de una persona. `ref` trae lo propio de cada tipo. */
export interface Pendiente {
  id: string;
  tipo: TipoPendiente;
  quien: string;
  titulo: string;
  empresa: string;
  organizationId: string | null;
  detalle: string;
  desde: string;
  urgente: boolean;
  ref: Record<string, string | number | null>;
}

export const TIPO: Record<TipoPendiente, { texto: string; tono: Tone; grupo: Exclude<Grupo, 'todo'> }> = {
  persona: { texto: 'Quiere hablar con alguien', tono: 'warning', grupo: 'personas' },
  sin_responder: { texto: 'Espera respuesta', tono: 'info', grupo: 'personas' },
  pedido: { texto: 'Pedido por aceptar', tono: 'primary', grupo: 'pedidos' },
  factura: { texto: 'Factura', tono: 'neutral', grupo: 'facturas' },
  documentos: { texto: 'Por revisar', tono: 'neutral', grupo: 'documentos' },
};

export const GRUPOS: ReadonlyArray<{ value: Grupo; label: string }> = [
  { value: 'todo', label: 'Todo' },
  { value: 'personas', label: 'Personas' },
  { value: 'pedidos', label: 'Pedidos' },
  { value: 'facturas', label: 'Facturas' },
  { value: 'documentos', label: 'Documentos' },
];

const CLAVE = ['pendientes'] as const;

export function usePendientes() {
  return useQuery({
    queryKey: CLAVE,
    queryFn: () => api.get<{ items: Pendiente[] }>('pendientes'),
    select: (r) => r.items,
    refetchInterval: 20_000,
  });
}

/** Tras resolver algo: la lista y los contadores del menú se vuelven a pedir. */
export function useRefrescarPendientes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE });
    void queryClient.invalidateQueries({ queryKey: CLAVE_RESUMEN });
  };
}
