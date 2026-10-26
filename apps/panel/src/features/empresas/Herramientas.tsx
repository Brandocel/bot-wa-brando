import { useMutation, useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/feedback';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useRefrescarEmpresas, type Empresa } from './api';

export type ClaveHerramienta = 'DOCUMENTOS' | 'VENTAS' | 'FACTURACION' | 'VOZ';

export interface Herramienta {
  clave: ClaveHerramienta;
  nombre: string;
  descripcion: string;
  /** Mes 1 a 5 en adelante, sin IVA. */
  escalones: number[];
  extra: boolean;
}

export function useHerramientas() {
  return useQuery({ queryKey: ['herramientas'], queryFn: () => api.get<Herramienta[]>('herramientas'), staleTime: 3_600_000 });
}

const pesos = (n: number) => `$${n.toLocaleString('es-MX')}`;

/**
 * Lo que tiene contratado la empresa: cada herramienta se vende sola, con
 * su escalera de precio. Facturación y Voz son extras de Documentos o Ventas.
 */
export function HerramientasEmpresa({ empresa: o }: { empresa: Empresa }) {
  const esAdmin = useUsuario().role === 'ADMIN';
  const catalogo = useHerramientas();
  const refrescar = useRefrescarEmpresas();
  const tiene = new Set(o.herramientas);

  const guardar = useMutation({
    mutationFn: (herramientas: ClaveHerramienta[]) => api.post('empresas/herramientas', { id: o.id, herramientas }),
    onSuccess: () => refrescar(),
    onError: (err) => toast.error(err.message),
  });

  if (catalogo.isPending) return <Skeleton className="h-28 rounded-lg" />;
  if (!catalogo.data) return null;

  const activas = catalogo.data.filter((h) => tiene.has(h.clave));
  const mes1 = activas.reduce((n, h) => n + h.escalones[0]!, 0);
  const piso = activas.reduce((n, h) => n + h.escalones[4]!, 0);

  function alternar(h: Herramienta) {
    const nuevas = catalogo.data!
      .map((x) => x.clave)
      .filter((c) => (c === h.clave ? !tiene.has(c) : tiene.has(c)));
    guardar.mutate(nuevas);
  }

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Herramientas</h3>
        {activas.length > 0 && (
          <span className="text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{pesos(mes1)}</span> el primer mes ·{' '}
            <span className="font-semibold text-foreground tabular-nums">{pesos(piso)}</span> desde el quinto · + IVA
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalogo.data.map((h) => {
          const on = tiene.has(h.clave);
          return (
            <button
              key={h.clave}
              type="button"
              disabled={!esAdmin || guardar.isPending}
              onClick={() => alternar(h)}
              aria-pressed={on}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                on ? 'border-primary/50 bg-primary-soft' : 'bg-surface hover:bg-muted/60',
                !esAdmin && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border',
                  on && 'border-primary bg-primary text-primary-foreground',
                )}
                aria-hidden
              >
                {on && <Check className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{h.nombre}</span>
                  {h.extra && <Badge>extra</Badge>}
                </span>
                <span className="block text-xs text-muted-foreground">{h.descripcion}</span>
                <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                  {pesos(h.escalones[0]!)} → {pesos(h.escalones[4]!)} al mes
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
