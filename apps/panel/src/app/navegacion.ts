import {
  Building2,
  FileText,
  FlaskConical,
  FolderSearch,
  Inbox,
  MessageCircle,
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
  /** Qué cifra del resumen se enseña junto al nombre. */
  contador?: 'pendientes' | 'revision' | 'cuarentena';
}

const SECCIONES: Seccion[] = [
  { ruta: 'pendientes', nombre: 'Pendientes', icono: Inbox, contador: 'pendientes' },
  { ruta: 'conversaciones', nombre: 'Conversaciones', icono: MessageSquare, contador: 'revision' },
  { ruta: 'tickets', nombre: 'Tickets', icono: Ticket },
  { ruta: 'directorio', nombre: 'Clientes', icono: Users },
  { ruta: 'empresas', nombre: 'Empresas', icono: Building2 },
  { ruta: 'whatsapp', nombre: 'WhatsApp', icono: MessageCircle },
  { ruta: 'ventas', nombre: 'Ventas', icono: ShoppingCart },
  { ruta: 'documentos', nombre: 'Documentos', icono: FileText },
  { ruta: 'cuarentena', nombre: 'Cuarentena', icono: FolderSearch, contador: 'cuarentena' },
  { ruta: 'auditoria', nombre: 'Auditoría', icono: ShieldCheck },
  { ruta: 'prueba', nombre: 'Chat de prueba', icono: FlaskConical },
  { ruta: 'ajustes', nombre: 'Ajustes', icono: Settings },
];

/** Lo único que ve la gente de una empresa. El servidor niega lo demás. */
const DE_EMPRESA = ['pendientes', 'directorio', 'whatsapp', 'ventas', 'documentos'];

export function seccionesDe(rol: Rol): Seccion[] {
  return rol === 'EMPRESA'
    ? SECCIONES.filter((s) => DE_EMPRESA.includes(s.ruta))
    : SECCIONES.filter((s) => s.ruta !== 'directorio' && s.ruta !== 'whatsapp');
}

/** A dónde se llega al entrar: lo que pide atención. */
export const INICIO = 'pendientes';
