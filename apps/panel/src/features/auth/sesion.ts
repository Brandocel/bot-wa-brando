import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Rol = 'ADMIN' | 'AGENTE' | 'EMPRESA';

export interface Usuario {
  id: string;
  email: string;
  name: string;
  role: Rol;
  /** Solo EMPRESA: la empresa a la que pertenece. */
  organizationId: string | null;
  organizationName: string | null;
}

const CLAVE = ['me'] as const;

export function useSesion() {
  return useQuery({ queryKey: CLAVE, queryFn: () => api.get<Usuario>('me'), staleTime: Infinity, retry: false });
}

/** Dentro del panel la sesión ya está resuelta: AppShell no pinta nada antes. */
export function useUsuario(): Usuario {
  const { data } = useSesion();
  if (!data) throw new Error('useUsuario se usó fuera del panel con sesión');
  return data;
}

export const NOMBRE_ROL: Record<Rol, string> = { ADMIN: 'Administrador', AGENTE: 'Agente', EMPRESA: 'Empresa' };

export function useSalir() {
  const queryClient = useQueryClient();
  return async () => {
    await api.post('logout').catch(() => undefined);
    queryClient.clear();
    location.assign(import.meta.env.BASE_URL + 'login');
  };
}
