import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SegmentedProps<T extends string> {
  /** Qué se está filtrando, para lectores de pantalla. */
  label: string;
  value: T;
  onChange: (valor: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  className?: string;
}

/** Filtro de una sola opción: los "chips" de cada lista. */
export function Segmented<T extends string>({ label, value, onChange, options, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
            o.value === value && 'bg-surface text-foreground shadow-xs',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
