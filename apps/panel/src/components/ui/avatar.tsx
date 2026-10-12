import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { iniciales, tono } from '@/lib/format';

interface AvatarProps {
  name: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TAMANOS = { sm: 'size-8 text-[11px]', md: 'size-10 text-[13px]', lg: 'size-12 text-sm' };

/** Iniciales sobre un color que sale del nombre: reconocer a alguien de reojo. */
export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span
      aria-hidden
      // El tono sale de los datos; es el único estilo en línea del panel.
      style={{ '--h': tono(name) } as CSSProperties}
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-[oklch(0.93_0.05_var(--h))] font-semibold text-[oklch(0.4_0.1_var(--h))] dark:bg-[oklch(0.34_0.06_var(--h))] dark:text-[oklch(0.88_0.08_var(--h))]',
        TAMANOS[size],
        className,
      )}
    >
      {iniciales(name)}
    </span>
  );
}
