/**
 * Una ubicación compartida por WhatsApp (el pin 📍), como texto.
 *
 * Llega como un tipo de mensaje aparte que antes se descartaba ("no
 * soportado"): el cliente mandaba su ubicación cuando el bot se la pedía y el
 * bot se quedaba callado. Se convierte en un texto con forma fija para que
 * viaje por el mismo camino que cualquier mensaje y quede legible en el panel.
 */

const PREFIJO = '📍 Ubicación compartida:';

export interface Ubicacion {
  lat: number;
  lng: number;
  /** Liga de Google Maps al punto exacto. */
  url: string;
  /** Lo que WhatsApp diga del lugar (nombre, dirección), si dice algo. */
  descripcion: string | null;
}

export function textoDeUbicacion(lat: number, lng: number, descripcion: string | null): string {
  const url = `https://maps.google.com/?q=${lat},${lng}`;
  return `${PREFIJO} ${url}${descripcion ? ` — ${descripcion}` : ''}`;
}

export function leerUbicacion(texto: string): Ubicacion | null {
  if (!texto.startsWith(PREFIJO)) return null;
  const m = /\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(texto);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const descripcion = texto.split(' — ').slice(1).join(' — ').trim() || null;
  return { lat, lng, url: `https://maps.google.com/?q=${lat},${lng}`, descripcion };
}
