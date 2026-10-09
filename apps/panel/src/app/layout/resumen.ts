import { useQuery } from '@tanstack/react-query';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';

export interface Resumen {
  abiertos: number;
  revision: number;
  alta: number;
  cuarentena: number;
  entregas24h: number;
  denegados24h: number;
  mensajesHora: number;
  topeHora: number;
}

export const CLAVE_RESUMEN = ['resumen'] as const;

/**
 * Las cifras de toda la operación, para los contadores del menú. A una
 * empresa no se le piden: el servidor tampoco se las daría.
 */
export function useResumen() {
  const usuario = useUsuario();
  return useQuery({
    queryKey: CLAVE_RESUMEN,
    queryFn: () => api.get<Resumen>('resumen'),
    enabled: usuario.role !== 'EMPRESA',
    refetchInterval: 20_000,
  });
}

/** Todo lo que pide acción de una persona, sumado. */
export const totalPendientes = (r: Resumen): number => r.revision + r.abiertos + r.alta + r.cuarentena;
