import { ArrowLeft, Check, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { SearchInput } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { usePuedeGestionar } from '@/features/ventas/api';
import { cn } from '@/lib/cn';
import { normalizar, numeroBonito } from '@/lib/format';
import { AltaCliente } from './AltaCliente';
import { estadoDe, nombreVisible, ROL, useClientes } from './api';
import { FichaCliente } from './FichaCliente';

type Filtro = 'todos' | 'pendientes' | 'listos';

interface Props {
  empresaId: string;
  /** Las empresas entre las que se puede dar de alta; sin esto, solo en `empresaId`. */
  empresas?: Array<{ id: string; name: string }>;
}

/** Los clientes de una empresa: la lista y la ficha del elegido. Lo usan Clientes y Empresas. */
export function Clientes({ empresaId, empresas }: Props) {
  const puedeGestionar = usePuedeGestionar();
  const clientes = useClientes();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [elegido, setElegido] = useState<string | null>(null);
  const [alta, setAlta] = useState(false);

  if (clientes.isPending) return <Skeleton className="h-72 rounded-lg" role="status" aria-label="Cargando" />;
  if (clientes.isError) return <ErrorState error={clientes.error} onRetry={() => clientes.refetch()} />;

  const propios = clientes.data.filter((c) => c.organization.id === empresaId);
  const pendientes = propios.filter((c) => !estadoDe(c).listo).length;
  const q = normalizar(busqueda).trim();
  const visibles = propios
    .filter((c) => filtro === 'todos' || (filtro === 'pendientes') === !estadoDe(c).listo)
    .filter((c) => !q || normalizar(`${nombreVisible(c)} ${c.contact.displayName ?? ''} ${c.contact.waId}`).includes(q))
    // Primero a quien le falta algo: es con quien hay trabajo.
    .sort(
      (a, b) =>
        Number(estadoDe(a).listo) - Number(estadoDe(b).listo) || nombreVisible(a).localeCompare(nombreVisible(b), 'es'),
    );
  const actual = propios.find((c) => c.id === elegido);

  return (
    <>
      <div className={cn('mb-4 flex flex-wrap items-center gap-3', actual && 'max-lg:hidden')}>
        <SearchInput
          className="w-full sm:w-64"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o número"
          aria-label="Buscar cliente"
        />
        <Segmented
          label="Qué clientes ver"
          value={filtro}
          onChange={setFiltro}
          options={(
            [
              ['todos', 'Todos', propios.length],
              ['pendientes', 'Pendientes', pendientes],
              ['listos', 'Listos', propios.length - pendientes],
            ] as const
          ).map(([value, texto, n]) => ({
            value,
            label: (
              <>
                {texto} <span className="tabular-nums opacity-60">{n}</span>
              </>
            ),
          }))}
        />
        {puedeGestionar && (
          <Button className="ml-auto" onClick={() => setAlta(true)}>
            <Plus />
            Nuevo cliente
          </Button>
        )}
      </div>

      <div className={cn('grid items-start gap-4', actual && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]')}>
        <div className={cn(actual && 'max-lg:hidden')}>
          {visibles.length === 0 ? (
            <EmptyState
              icon={Users}
              title={propios.length ? 'Nadie con este filtro' : 'Todavía no hay clientes'}
              description={propios.length ? undefined : 'Da de alta el primero.'}
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border bg-surface shadow-xs">
              {visibles.map((c) => {
                const estado = estadoDe(c);
                const nombre = nombreVisible(c);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={c.id === elegido || undefined}
                      onClick={() => setElegido(c.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
                        c.id === elegido && 'bg-primary-soft hover:bg-primary-soft',
                      )}
                    >
                      <Avatar name={nombre} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{nombre}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{numeroBonito(c.contact.waId)}</span>
                      </span>
                      <span className="hidden text-[13px] text-muted-foreground sm:block">{ROL[c.role]}</span>
                      <span
                        className={cn(
                          'flex shrink-0 items-center gap-1 text-right text-xs font-medium',
                          estado.listo ? 'text-success' : 'text-warning',
                        )}
                      >
                        {estado.listo && <Check className="size-3.5" aria-hidden />}
                        {estado.texto}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {actual && (
          <div>
            <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={() => setElegido(null)}>
              <ArrowLeft />
              Volver a la lista
            </Button>
            <Card className="p-5 lg:sticky lg:top-8">
              {/* La clave cierra formularios a medias al cambiar de cliente. */}
              <FichaCliente key={actual.id} cliente={actual} onRevocado={() => setElegido(null)} />
            </Card>
          </div>
        )}
      </div>

      {alta && <AltaCliente empresaId={empresaId} empresas={empresas} onCerrar={() => setAlta(false)} />}
    </>
  );
}
