import {
  Building2,
  FileText,
  FolderSearch,
  Inbox,
  MessageSquare,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Rol } from '@/features/auth/sesion';

export interface Seccion {
  /** Ruta dentro del panel nuevo. */
  ruta: string;
  nombre: string;
  icono: LucideIcon;
  /**
   * Mientras dura la migración: el nombre de la vista en el panel clásico.
   * Con esto puesto, el menú manda allá en vez de a una ruta de aquí. Se
   * quita al migrar la sección; cuando no quede ninguna, se borra el campo.
   */
  clasica?: string;
  /** Qué cifra del resumen se enseña junto al nombre. */
  contador?: 'pendientes' | 'revision' | 'cuarentena';
}

const SECCIONES: Seccion[] = [
  { ruta: 'pendientes', nombre: 'Pendientes', icono: Inbox, clasica: 'pendientes', contador: 'pendientes' },
  { ruta: 'conversaciones', nombre: 'Conversaciones', icono: MessageSquare, clasica: 'bandeja', contador: 'revision' },
  { ruta: 'tickets', nombre: 'Tickets', icono: Ticket },
  { ruta: 'directorio', nombre: 'Clientes', icono: Users, clasica: 'directorio' },
  { ruta: 'empresas', nombre: 'Empresas', icono: Building2, clasica: 'empresas' },
  { ruta: 'ventas', nombre: 'Ventas', icono: ShoppingCart, clasica: 'ventas' },
  { ruta: 'documentos', nombre: 'Documentos', icono: FileText },
  { ruta: 'cuarentena', nombre: 'Cuarentena', icono: FolderSearch, contador: 'cuarentena' },
  { ruta: 'auditoria', nombre: 'Auditoría', icono: ShieldCheck },
  { ruta: 'ajustes', nombre: 'Ajustes', icono: Settings },
];

/** Lo único que ve la gente de una empresa. El servidor niega lo demás. */
const DE_EMPRESA = ['pendientes', 'directorio', 'ventas', 'documentos'];

export function seccionesDe(rol: Rol): Seccion[] {
  return rol === 'EMPRESA'
    ? SECCIONES.filter((s) => DE_EMPRESA.includes(s.ruta))
    : SECCIONES.filter((s) => s.ruta !== 'directorio');
}

/** A dónde se llega al entrar: la primera sección que ya vive en este panel. */
export function inicioDe(rol: Rol): string {
  return seccionesDe(rol).find((s) => !s.clasica)?.ruta ?? 'documentos';
}

/**
 * Abre el panel clásico en una vista concreta. El clásico recuerda dónde
 * estabas en sessionStorage; se le deja escrito a dónde ir (y qué conversación
 * abrir, si viene) antes de saltar.
 */
export function abrirClasico(vista: string, chat?: string): void {
  try {
    const estado = JSON.parse(sessionStorage.getItem('panel-estado') ?? 'null') ?? {};
    sessionStorage.setItem('panel-estado', JSON.stringify({ ...estado, vista, ...(chat ? { chat } : {}) }));
  } catch {
    // Sin sessionStorage el clásico abre en su vista por omisión.
  }
  location.assign('/panel');
}
