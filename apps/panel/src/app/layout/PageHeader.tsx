import { useIsFetching } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Si la página puede refrescarse a mano, cómo. */
  onRefresh?: () => void;
  children?: ReactNode;
}

/** El encabezado de toda página: mismo sitio, mismo tamaño, mismas acciones. */
export function PageHeader({ title, description, onRefresh, children }: PageHeaderProps) {
  const cargando = useIsFetching() > 0;

  useEffect(() => {
    document.title = `${title} · Jarvis`;
  }, [title]);

  return (
    <header className="mb-6 flex flex-wrap items-start gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center gap-2">
        {children}
        {onRefresh && (
          <Button variant="secondary" size="icon" onClick={onRefresh} aria-label="Actualizar">
            <RefreshCw className={cn(cargando && 'animate-spin')} />
          </Button>
        )}
      </div>
    </header>
  );
}
