import {
  Building2,
  FileText,
  FlaskConical,
  FolderSearch,
  Inbox,
  MessageCircle,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Rol } from '@/features/auth/sesion';
import type { ClaveHerramienta } from '@/features/empresas/Herramientas';

export interface Seccion {
  /** Ruta dentro del panel; puede llevar ?tab=. */
  ruta: string;
  nombre: string;
  icono: LucideIcon;
  /** Qué cifra del resumen se enseña junto al nombre. */
  contador?: 'pendientes' | 'revision' | 'cuarentena';
}

export interface Grupo {
  /** null = el bloque de arriba, sin título. */
  titulo: string | null;
  /** La herramienta que hace falta para verlo (para el usuario de empresa). */
  herramienta?: ClaveHerramienta;
  /** Solo para el equipo. */
  soloEquipo?: boolean;
  secciones: Seccion[];
}

/** El menú, ordenado por herramienta: cada una se vende por separado. */
const GRUPOS: Grupo[] = [
  {
    titulo: null,
    secciones: [
      { ruta: 'pendientes', nombre: 'Pendientes', icono: Inbox, contador: 'pendientes' },
      { ruta: 'conversaciones', nombre: 'Conversaciones', icono: MessageSquare, contador: 'revision' },
      { ruta: 'tickets', nombre: 'Tickets', icono: Ticket },
      { ruta: 'directorio', nombre: 'Clientes', icono: Users },
      { ruta: 'whatsapp', nombre: 'WhatsApp', icono: MessageCircle },
    ],
  },
  {
    titulo: 'Documentos',
    herramienta: 'DOCUMENTOS',
    secciones: [
      { ruta: 'documentos', nombre: 'Documentos', icono: FileText },
      { ruta: 'cuarentena', nombre: 'Cuarentena', icono: FolderSearch, contador: 'cuarentena' },
    ],
  },
  {
    titulo: 'Ventas',
    herramienta: 'VENTAS',
    secciones: [{ ruta: 'ventas', nombre: 'Ventas', icono: ShoppingCart }],
  },
  {
    titulo: 'Facturación',
    herramienta: 'FACTURACION',
    secciones: [{ ruta: 'ventas?tab=facturas', nombre: 'Facturas', icono: Receipt }],
  },
  {
    titulo: 'Administración',
    soloEquipo: true,
    secciones: [
      { ruta: 'empresas', nombre: 'Empresas', icono: Building2 },
      { ruta: 'cobros', nombre: 'Cobros', icono: Wallet },
      { ruta: 'auditoria', nombre: 'Auditoría', icono: ShieldCheck },
      { ruta: 'prueba', nombre: 'Chat de prueba', icono: FlaskConical },
      { ruta: 'ajustes', nombre: 'Ajustes', icono: Settings },
    ],
  },
];

/** Lo único que ve la gente de una empresa. El servidor niega lo demás. */
const DE_EMPRESA = ['pendientes', 'directorio', 'whatsapp', 'ventas', 'ventas?tab=facturas', 'documentos'];
/** Lo que es solo de la empresa (el equipo lo ve desde Empresas). */
const SOLO_EMPRESA = ['directorio', 'whatsapp'];

/**
 * El menú de cada quien. Un usuario de empresa ve solo las herramientas que
 * tiene contratadas; el equipo las ve todas.
 */
export function gruposDe(rol: Rol, herramientas: readonly ClaveHerramienta[] | null): Grupo[] {
  const empresa = rol === 'EMPRESA';
  return GRUPOS.filter((g) => !(empresa && g.soloEquipo))
    .filter((g) => !(empresa && g.herramienta && herramientas && !herramientas.includes(g.herramienta)))
    .map((g) => ({
      ...g,
      secciones: g.secciones.filter((s) => (empresa ? DE_EMPRESA.includes(s.ruta) : !SOLO_EMPRESA.includes(s.ruta))),
    }))
    .filter((g) => g.secciones.length > 0);
}

/** A dónde se llega al entrar: lo que pide atención. */
export const INICIO = 'pendientes';
