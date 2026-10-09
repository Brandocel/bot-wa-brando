import { useSyncExternalStore } from 'react';

export type Tema = 'claro' | 'oscuro';

const CLAVE = 'panel.tema';
const oyentes = new Set<() => void>();

const leer = (): Tema => (document.documentElement.classList.contains('dark') ? 'oscuro' : 'claro');

function poner(tema: Tema): void {
  document.documentElement.classList.toggle('dark', tema === 'oscuro');
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    // Sin almacenamiento (modo privado): el tema dura lo que la pestaña.
  }
  oyentes.forEach((avisar) => avisar());
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => oyentes.delete(avisar);
}

/** El tema inicial lo decide index.html antes de pintar; aquí solo se cambia. */
export function useTema() {
  const tema = useSyncExternalStore(suscribir, leer);
  return { tema, alternar: () => poner(tema === 'oscuro' ? 'claro' : 'oscuro') };
}
