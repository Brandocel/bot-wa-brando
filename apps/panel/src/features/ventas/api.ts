import { useQuery } from '@tanstack/react-query';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import type { Dia, EstadoPedido, ModoEntrega } from './catalogos';

export interface Empresa {
  id: string;
  name: string;
  /** PERSONA: usa el bot para sí misma; su número recibe todo lo suyo. */
  kind: 'EMPRESA' | 'PERSONA';
  taxId: string | null;
  active: boolean;
  /** De dónde salen sus documentos: una carpeta de Drive o su computadora. */
  sourceType: 'DRIVE' | 'PC';
  driveFolderId: string | null;
  waLineId: string | null;
  waNumber: string | null;
  sales: { enabled: boolean } | null;
  invoicing: { enabled: boolean; sandbox: boolean } | null;
  /** Quién puede emitir facturas por WhatsApp. */
  memberships: Array<{ id: string; fullName: string | null; contact: { displayName: string | null } | null }>;
  _count: { products: number; memberships: number; documents: number; tickets: number };
}

interface Contacto {
  displayName: string | null;
  waId: string;
}

export interface Pedido {
  id: string;
  number: number;
  status: EstadoPedido;
  buyingScore: number | null;
  submittedAt: string | null;
  updatedAt: string;
  customerName: string | null;
  contact: Contacto | null;
  items: Array<{ nombre: string; cantidad: number; precioCents: number; nota?: string | null }> | null;
  deliveryMode: ModoEntrega | null;
  address: string | null;
  zone: string | null;
  etaAt: string | null;
  scheduledFor: string | null;
  deliveryCents: number;
  totalCents: number;
  notes: string | null;
  rejectReason: string | null;
}

export type Horario = Partial<Record<Dia, Array<[string, string]>>>;

export interface ConfigVentas {
  enabled: boolean;
  businessType: string;
  pitch: string;
  timezone: string;
  hours: Horario | null;
  deliveryModes: ModoEntrega[] | null;
  zones: Array<{ nombre: string; costo: number }> | null;
  prepMinutes: number;
  minOrder: number;
}

export interface Producto {
  id: string;
  name: string;
  section: string;
  description: string;
  priceCents: number;
  active: boolean;
  availableDays: Dia[] | null;
}

export type EstadoFactura = 'POR_APROBAR' | 'TIMBRANDO' | 'TIMBRADA' | 'ERROR' | 'RECHAZADA' | 'CANCELADA';

export interface Factura {
  id: string;
  status: EstadoFactura;
  serie: string | null;
  folio: string | null;
  sandbox: boolean;
  order: { number: number } | null;
  stampedAt: string | null;
  createdAt: string;
  receptor: { nombre?: string; rfc?: string; codigoPostal?: string; regimen?: string; usoCfdi?: string; email?: string } | null;
  formaPago: string;
  contact: Contacto | null;
  concepts: Array<{ Cantidad: number; Descripcion: string; ClaveProdServ: string; ValorUnitario: number }> | null;
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
  uuid: string | null;
  error: string | null;
  rejectReason: string | null;
}

export interface ConfigFacturacion {
  cifradoDisponible: boolean;
  enabled: boolean;
  sandbox: boolean;
  llavesCapturadas: boolean;
  serieId: number | null;
  fallbackEmail: string;
  lugarExpedicion: string;
  pricesIncludeTax: boolean;
  ivaBasisPoints: number;
  defaultProdCode: string;
  defaultUnitCode: string;
  deliveryProdCode: string;
  maxDaysAfterSale: number;
}

export interface Serie {
  id: number;
  nombre: string;
  activa: boolean;
}

export function useEmpresas() {
  return useQuery({ queryKey: ['empresas'], queryFn: () => api.get<Empresa[]>('empresas') });
}

/**
 * Sobre qué empresa se actúa. Una empresa actúa siempre sobre la suya (el
 * servidor lo sabe por la sesión); el equipo lo dice en cada petición.
 */
export function useAlcance(empresaId: string) {
  const deEmpresa = useUsuario().role === 'EMPRESA';
  return {
    params: deEmpresa ? {} : { empresa: empresaId },
    cuerpo: deEmpresa ? {} : { organizationId: empresaId },
  };
}

/** Quién puede cambiar catálogo, configuración y facturas. */
export function usePuedeGestionar(): boolean {
  const { role } = useUsuario();
  return role === 'ADMIN' || role === 'EMPRESA';
}

export function useConfigVentas(empresaId: string) {
  const { params } = useAlcance(empresaId);
  return useQuery({
    queryKey: ['ventas', empresaId, 'config'],
    queryFn: () => api.get<ConfigVentas>('ventas/config', params),
  });
}

export function useConfigFacturacion(empresaId: string) {
  const { params } = useAlcance(empresaId);
  return useQuery({
    queryKey: ['facturas', empresaId, 'config'],
    queryFn: () => api.get<ConfigFacturacion>('facturas/config', params),
  });
}
