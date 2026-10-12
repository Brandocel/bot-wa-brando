import { X } from 'lucide-react';
import { Dialog as Radix } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

interface SheetProps {
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Botones fijos al pie, siempre a la vista aunque el contenido sea largo. */
  footer?: ReactNode;
  className?: string;
}

/** Panel lateral: formularios y detalles sin sacarte de la lista donde estás. */
export function Sheet({ open, onOpenChange, title, description, children, footer, className }: SheetProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-50 animate-overlay bg-black/45" />
        <Radix.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full max-w-lg animate-sheet flex-col border-l bg-surface-raised shadow-lg',
            className,
          )}
        >
          <header className="flex shrink-0 items-start gap-4 border-b px-6 py-4">
            <div className="min-w-0 flex-1">
              <Radix.Title className="text-base font-semibold tracking-tight">{title}</Radix.Title>
              {description && (
                <Radix.Description className="mt-1 text-[13px] text-muted-foreground">{description}</Radix.Description>
              )}
            </div>
            <Radix.Close asChild>
              <Button variant="ghost" size="icon" className="-mr-2 size-8" aria-label="Cerrar">
                <X />
              </Button>
            </Radix.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-6 py-4">{footer}</footer>}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
