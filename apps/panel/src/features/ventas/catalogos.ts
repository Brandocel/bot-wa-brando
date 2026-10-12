import type { Tone } from '@/components/ui/badge';

export type Dia = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom';
export type ModoEntrega = 'RECOGER' | 'DOMICILIO' | 'PAQUETERIA' | 'DIGITAL';
export type EstadoPedido = 'ARMANDO' | 'POR_ACEPTAR' | 'ACEPTADO' | 'RECHAZADO' | 'ENTREGADO' | 'CANCELADO';

export const DIAS: ReadonlyArray<{ clave: Dia; nombre: string; corto: string }> = [
  { clave: 'lun', nombre: 'Lunes', corto: 'Lun' },
  { clave: 'mar', nombre: 'Martes', corto: 'Mar' },
  { clave: 'mie', nombre: 'Miércoles', corto: 'Mié' },
  { clave: 'jue', nombre: 'Jueves', corto: 'Jue' },
  { clave: 'vie', nombre: 'Viernes', corto: 'Vie' },
  { clave: 'sab', nombre: 'Sábado', corto: 'Sáb' },
  { clave: 'dom', nombre: 'Domingo', corto: 'Dom' },
];

export const ENTREGAS: Record<ModoEntrega, { nombre: string; ayuda: string }> = {
  RECOGER: { nombre: 'Pasar a recoger', ayuda: 'El cliente pasa por su pedido.' },
  DOMICILIO: { nombre: 'A domicilio', ayuda: 'Lo llevan ustedes, con costo por zona.' },
  PAQUETERIA: { nombre: 'Paquetería', ayuda: 'Envío a cualquier parte (equipo, productos físicos).' },
  DIGITAL: { nombre: 'Digital', ayuda: 'No hay nada que mover: servicios, páginas web, licencias.' },
};

export const ESTADO_PEDIDO: Record<EstadoPedido, { texto: string; tono: Tone }> = {
  ARMANDO: { texto: 'Armándose', tono: 'neutral' },
  POR_ACEPTAR: { texto: 'Por aceptar', tono: 'warning' },
  ACEPTADO: { texto: 'Aceptado', tono: 'success' },
  RECHAZADO: { texto: 'Rechazado', tono: 'neutral' },
  ENTREGADO: { texto: 'Entregado', tono: 'success' },
  CANCELADO: { texto: 'Cancelado', tono: 'neutral' },
};

export const ZONAS_HORARIAS: ReadonlyArray<[string, string]> = [
  ['America/Mexico_City', 'Centro (CDMX, Guadalajara, Monterrey)'],
  ['America/Cancun', 'Quintana Roo (Cancún)'],
  ['America/Chihuahua', 'Chihuahua'],
  ['America/Hermosillo', 'Sonora'],
  ['America/Mazatlan', 'Pacífico (Sinaloa, Nayarit, BCS)'],
  ['America/Tijuana', 'Baja California'],
];

export const nombreEntrega = (modo: string | null | undefined): string =>
  modo ? (ENTREGAS[modo as ModoEntrega]?.nombre ?? modo) : 'Entrega sin elegir';
