import { ArrowLeft, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/app/layout/PageHeader';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/segmented';
import { useUsuario } from '@/features/auth/sesion';
import { cn } from '@/lib/cn';
import { hace, plural } from '@/lib/format';
import { GRUPOS, TIPO, usePendientes, type Grupo } from './api';
import { DetallePendiente } from './DetallePendiente';

function saludo(nombre: string): string {
  const h = new Date().getHours();
  const parte = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const primero = nombre.trim().split(/\s+/)[0];
  return primero ? `${parte}, ${primero}` : parte;
}

/** Todo lo que pide acción, en una lista: lo urgente primero, luego lo que más ha esperado. */
export function PendientesPage() {
  const usuario = useUsuario();
  const pendientes = usePendientes();
  const [grupo, setGrupo] = useState<Grupo>('todo');
  const [elegido, setElegido] = useState<string | null>(null);
  // En teléfono el detalle tapa la lista; solo se abre al tocar una fila.
  const [detalleMovil, setDetalleMovil] = useState(false);

  const todos = pendientes.data ?? [];
  const cuenta = (g: Grupo) => (g === 'todo' ? todos.length : todos.filter((i) => TIPO[i.tipo].grupo === g).length);
  const visibles = todos.filter((i) => grupo === 'todo' || TIPO[i.tipo].grupo === grupo);
  const actual = visibles.find((i) => i.id === elegido) ?? visibles[0];

  return (
    <>
      <PageHeader
        title={saludo(usuario.name)}
        description={
          pendientes.data &&
          (todos.length
            ? `Tienes ${plural(todos.length, 'cosa', 'cosas')} por atender. Empieza por la de arriba: es la que más ha esperado.`
            : undefined)
        }
        onRefresh={() => pendientes.refetch()}
      />

      {pendientes.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" role="status" aria-label="Cargando">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="hidden h-80 rounded-lg lg:block" />
        </div>
      ) : pendientes.isError ? (
        <ErrorState error={pendientes.error} onRetry={() => pendientes.refetch()} />
      ) : todos.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="No hay nada esperando por ti"
          description="Cuando alguien escriba, llegue un pedido o haya algo por aprobar, aparece aquí."
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className={cn(detalleMovil && 'hidden lg:block')}>
            <Segmented
              label="Qué pendientes ver"
              value={grupo}
              onChange={setGrupo}
              options={GRUPOS.filter((g) => g.value === 'todo' || g.value === grupo || cuenta(g.value) > 0).map((g) => ({
                value: g.value,
                label: (
                  <>
                    {g.label} <span className="tabular-nums opacity-60">{cuenta(g.value)}</span>
                  </>
                ),
              }))}
              className="mb-3"
            />
            {visibles.length === 0 ? (
              <EmptyState title="Nada de esto por ahora" />
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border bg-surface shadow-xs">
                {visibles.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      aria-current={i.id === actual?.id || undefined}
                      onClick={() => {
                        setElegido(i.id);
                        setDetalleMovil(true);
                      }}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
                        i.id === actual?.id && 'lg:bg-primary-soft lg:hover:bg-primary-soft',
                      )}
                    >
                      <Avatar name={i.quien} />
                      <span className="min-w-0 flex-1">
                        <Badge tone={i.urgente ? 'danger' : TIPO[i.tipo].tono}>
                          {TIPO[i.tipo].texto}
                          {i.urgente && ' · urgente'}
                        </Badge>
                        <span className="mt-1 block font-medium">{i.titulo}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {i.empresa} · {hace(i.desde)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {actual && (
            <div className={cn(!detalleMovil && 'hidden lg:block')}>
              <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={() => setDetalleMovil(false)}>
                <ArrowLeft />
                Volver a la lista
              </Button>
              <Card className="p-5 lg:sticky lg:top-8">
                <DetallePendiente item={actual} />
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
