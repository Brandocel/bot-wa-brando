import { CircleAlert, Inbox, type LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/** Hueco gris que late mientras llegan los datos. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden {...props} />;
}

/** La forma de una tabla mientras carga, para que la página no salte al llegar. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y rounded-lg border bg-surface shadow-xs" role="status" aria-label="Cargando">
      <div className="bg-muted/60 px-4 py-3">
        <Skeleton className="h-3 w-40" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-4 py-3.5">
          <Skeleton className="h-3.5" style={{ width: `${28 + ((i * 13) % 22)}%` }} />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icono = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed border-border-strong px-6 py-14 text-center',
        className,
      )}
    >
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icono className="size-5" aria-hidden />
      </span>
      <p className="mt-4 font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Cuando una lista no cargó: dice por qué y deja reintentar. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title="No se pudo cargar"
      description={error instanceof Error ? error.message : 'Algo falló al pedir los datos.'}
      action={
        onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Reintentar
          </Button>
        )
      }
      className="border-danger/30"
    />
  );
}

const TONOS = {
  warning: 'border-warning/30 bg-warning-soft text-foreground [&_strong:first-child]:text-warning',
  danger: 'border-danger/30 bg-danger-soft text-foreground [&_strong:first-child]:text-danger',
  info: 'border-info/30 bg-info-soft text-foreground [&_strong:first-child]:text-info',
};

interface CalloutProps {
  tone?: keyof typeof TONOS;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Aviso dentro de la página: una advertencia que hay que leer antes de actuar. */
export function Callout({ tone = 'info', title, children, className }: CalloutProps) {
  return (
    <div role="note" className={cn('rounded-lg border px-4 py-3 text-[13px] [&_p+p]:mt-2', TONOS[tone], className)}>
      {title && <strong className="mb-1 block font-semibold">{title}</strong>}
      {children}
    </div>
  );
}

/** Barra de avance contra un tope: cambia de color al acercarse y al llegar. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
