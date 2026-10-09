import { X } from 'lucide-react';
import { Dialog as Radix } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button, type ButtonProps } from './button';

interface DialogProps {
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Los botones del pie. El primero en leerse es el de cancelar. */
  footer?: ReactNode;
  className?: string;
}

/** Ventana modal: atrapa el foco, cierra con Esc y devuelve el foco al botón que la abrió. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-50 animate-overlay bg-black/45" />
        <Radix.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 animate-in flex-col rounded-xl border bg-surface-raised shadow-lg',
            className,
          )}
        >
          <header className="flex items-start gap-4 px-6 pt-6">
            <div className="min-w-0 flex-1">
              <Radix.Title className="text-base font-semibold tracking-tight">{title}</Radix.Title>
              {description && (
                <Radix.Description className="mt-1.5 text-[13px] text-muted-foreground">{description}</Radix.Description>
              )}
            </div>
            <Radix.Close asChild>
              <Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 size-8" aria-label="Cerrar">
                <X />
              </Button>
            </Radix.Close>
          </header>
          {children && <div className="overflow-y-auto px-6 pt-4">{children}</div>}
          <footer className="flex flex-wrap justify-end gap-2 p-6">{footer}</footer>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  variant?: ButtonProps['variant'];
  loading?: boolean;
  onConfirm: () => void;
}

/** Sustituye a `confirm()`: mismo aviso, pero con el diseño del panel. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = 'primary',
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
