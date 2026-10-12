import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Categoria } from '@/features/documentos/categorias';
import { api } from '@/lib/api';
import { fecha, numeroBonito } from '@/lib/format';

export type RolCliente = 'VIEWER' | 'MANAGER' | 'ADMIN';

/** Alguien autorizado a pedirle documentos al bot, de parte de una empresa. */
export interface Cliente {
  id: string;
  role: RolCliente;
  verifiedAt: string | null;
  canInvoice: boolean;
  fullName: string | null;
  nameConfirmedAt: string | null;
  createdAt: string;
  contact: { waId: string; displayName: string | null };
  organization: { id: string; name: string };
  grants: Array<{ category: Categoria }>;
}

/** El doble paso de lo sensible: confirmar que se habló con la persona y anotar cómo. */
export interface Firma {
  confirmo: boolean;
  nota: string;
}

export const ROL: Record<RolCliente, string> = { VIEWER: 'Cliente', MANAGER: 'Gerente', ADMIN: 'Administrador' };

/** Documentos que solo se dan a quien ya se comprobó quién es. */
export const SENSIBLES: readonly Categoria[] = ['FACTURA', 'CONTRATO', 'POLIZA', 'ESTADO_CUENTA', 'CONTABLE'];

export const nombreVisible = (c: Cliente): string => c.fullName || c.contact.displayName || numeroBonito(c.contact.waId);

/** Lo que le falta para poder recibir documentos, en una frase. */
export function estadoDe(c: Cliente): { listo: boolean; texto: string } {
  if (!c.fullName) return { listo: false, texto: 'Falta su nombre completo' };
  if (!c.nameConfirmedAt) return { listo: false, texto: 'Falta que confirme su nombre' };
  const pideSensible = c.role !== 'VIEWER' || c.grants.some((g) => SENSIBLES.includes(g.category));
  if (!c.verifiedAt && pideSensible) return { listo: false, texto: 'Falta verificar el número' };
  return { listo: true, texto: 'Listo' };
}

export type ClavePaso = 'nombre' | 'confirmar' | 'verificar';

export function pasosDe(c: Cliente): Array<{ clave: ClavePaso; listo: boolean; titulo: string; detalle: string }> {
  return [
    {
      clave: 'nombre',
      listo: !!c.fullName,
      titulo: 'Nombre completo registrado',
      detalle: c.fullName ?? 'Sin esto no recibe ningún documento.',
    },
    {
      clave: 'confirmar',
      listo: !!c.nameConfirmedAt,
      titulo: 'Confirmó su nombre',
      detalle: c.nameConfirmedAt
        ? `El ${fecha(c.nameConfirmedAt)}`
        : 'El bot se lo pide por WhatsApp la próxima vez que pida un documento.',
    },
    {
      clave: 'verificar',
      listo: !!c.verifiedAt,
      titulo: 'Número verificado',
      detalle: c.verifiedAt
        ? `El ${fecha(c.verifiedAt)}`
        : 'Hace falta para facturas, contratos, pólizas, estados de cuenta y contabilidad.',
    },
  ];
}

const CLAVE = ['clientes'] as const;

/** Sin refresco automático: la ficha tiene formularios a medio llenar. */
export function useClientes() {
  return useQuery({ queryKey: CLAVE, queryFn: () => api.get<Cliente[]>('numeros') });
}

export function useRefrescarClientes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CLAVE });
    void queryClient.invalidateQueries({ queryKey: ['empresas'] });
  };
}
