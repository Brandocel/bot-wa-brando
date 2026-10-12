import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Empresa } from '@/features/ventas/api';

export type { Empresa };

export type EstadoLinea = 'CONNECTED' | 'WAITING_QR' | 'DISCONNECTED' | 'CRASHED' | 'DESCONOCIDO';

/** Cómo está el WhatsApp propio de una empresa, según el gateway. */
export interface EstadoWa {
  conectada: boolean;
  estado: EstadoLinea | null;
  numero: string | null;
}

/** Las computadoras de una empresa que suben documentos, y lo que llevan subido. */
export interface Conector {
  devices: Array<{ id: string; name: string; lastSeenAt: string | null }>;
  documentos: { entregables: number; revision: number; descartados: number };
  lastUploadAt: string | null;
}

export interface UsuarioPanel {
  id: string;
  name: string;
  email: string;
  lastLoginAt: string | null;
}

export const claveWa = (id: string) => ['empresas', id, 'whatsapp'] as const;

/** `rapido`: mientras se espera el escaneo del QR se pregunta cada 4 s. */
export function useEstadoWa(id: string, activo: boolean, rapido = false) {
  return useQuery({
    queryKey: claveWa(id),
    queryFn: () => api.get<EstadoWa>('empresas/whatsapp', { id }),
    enabled: activo,
    refetchInterval: rapido ? 4_000 : 20_000,
  });
}

export function useConector(id: string, activo: boolean) {
  return useQuery({
    queryKey: ['empresas', id, 'conector'],
    queryFn: () => api.get<Conector>('empresas/conectores', { id }),
    enabled: activo,
    refetchInterval: 20_000,
  });
}

/** Tras cambiar algo de una empresa: su ficha y todo lo que cuelga de ella. */
export function useRefrescarEmpresas() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ['empresas'] });
}

/** Los cinco pasos para que una empresa quede trabajando, en orden. */
export function pasosDe(o: Empresa): Array<{ nombre: string; listo: boolean }> {
  return [
    { nombre: 'su WhatsApp', listo: !!o.waLineId },
    { nombre: 'Ventas', listo: !!o.sales?.enabled },
    { nombre: 'Facturación', listo: !!o.invoicing?.enabled },
    { nombre: 'quién factura', listo: o.memberships.length > 0 },
    { nombre: 'sus documentos', listo: o.sourceType === 'PC' || !!o.driveFolderId },
  ];
}

/** "a, b y c". */
export const juntar = (xs: string[]): string =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
