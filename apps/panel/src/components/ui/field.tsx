import { ChevronDown } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control =
  'h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 hover:border-muted-foreground/50 focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(control, 'appearance-none pr-9')} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

interface FieldProps {
  label: ReactNode;
  /** Ayuda debajo del campo. Con `error`, se sustituye por el error. */
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** Recibe el id para enlazar la etiqueta con el control. */
  children: (ids: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': boolean | undefined }) => ReactNode;
}

/** Etiqueta siempre visible + control + ayuda o error pegados al campo. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const nota = error ?? hint;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      {children({ id, 'aria-describedby': nota ? `${id}-nota` : undefined, 'aria-invalid': error ? true : undefined })}
      {nota && (
        <p id={`${id}-nota`} className={cn('text-xs', error ? 'text-danger' : 'text-muted-foreground')}>
          {nota}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ className, children, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn('flex items-start gap-2.5 text-sm has-disabled:opacity-70', className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded-sm accent-primary" {...props} />
      <span>{children}</span>
    </label>
  );
}
