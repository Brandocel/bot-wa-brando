import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta clases y deja ganar a la última cuando dos chocan (`px-2` vs `px-4`). */
export function cn(...clases: ClassValue[]): string {
  return twMerge(clsx(clases));
}
