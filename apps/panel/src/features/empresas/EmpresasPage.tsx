import { ArrowLeft, Building2, Plus } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/app/layout/PageHeader';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/segmented';
import { useUsuario } from '@/features/auth/sesion';
import { Clientes } from '@/features/clientes/Clientes';
import { useEmpresas } from '@/features/ventas/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { AccesosPanel } from './AccesosPanel';
import { AltaEmpresa } from './AltaEmpresa';
import { pasosDe, useRefrescarEmpresas, type Empresa } from './api';
import { EliminarEmpresa } from './EliminarEmpresa';
import { DialogoConector } from './PasoDocumentos';
import { PasosEmpresa } from './PasosEmpresa';

type Pestana = 'config' | 'personas';
type Abierto = 'alta' | 'accesos' | 'eliminar' | null;

/** Cada empresa y lo que le falta para trabajar. La elegida y su pestaña van en la URL. */
export function EmpresasPage() {
  const esAdmin = useUsuario().role === 'ADMIN';
  const empresas = useEmpresas();
  const [params, setParams] = useSearchParams();
  const [abierto, setAbierto] = useState<Abierto>(null);
  const [conectarPc, setConectarPc] = useState<{ id: string; name: string } | null>(null);

  const pedida = params.get('empresa');
  const pestana: Pestana = params.get('tab') === 'personas' ? 'personas' : 'config';
  const actual = empresas.data?.find((o) => o.id === pedida) ?? empresas.data?.[0];
  const refrescar = useRefrescarEmpresas();
  const cambiarTipo = useMutation({
    mutationFn: (kind: Empresa['kind']) => api.post('empresas/actualizar', { id: actual?.id, kind }),
    onSuccess: (_, kind) => {
      toast.success(kind === 'PERSONA' ? 'Ahora es persona: su número recibe todos sus documentos' : 'Ahora es empresa');
      refrescar();
    },
    onError: (err) => toast.error(err.message),
  });
  const poner = (cambios: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...cambios }, { replace: true });

  return (
    <>
      <div className={cn(pedida && 'max-lg:hidden')}>
        <PageHeader title="Empresas" description="A quién atiende el bot y qué le falta a cada una para trabajar.">
          {esAdmin && (
            <Button onClick={() => setAbierto('alta')}>
              <Plus />
              Nueva empresa
            </Button>
          )}
        </PageHeader>
      </div>

      {empresas.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]" role="status" aria-label="Cargando">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="hidden h-72 rounded-lg lg:block" />
        </div>
      ) : empresas.isError ? (
        <ErrorState error={empresas.error} onRetry={() => empresas.refetch()} />
      ) : !actual ? (
        <EmptyState icon={Building2} title="No hay empresas registradas" description="Da de alta la primera." />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* En teléfono: la lista, o la empresa elegida a pantalla completa. */}
          <ul className={cn('divide-y overflow-hidden rounded-lg border bg-surface shadow-xs', pedida && 'max-lg:hidden')}>
            {empresas.data.map((o) => (
              <FilaEmpresa key={o.id} empresa={o} activa={o.id === actual.id} onElegir={() => poner({ empresa: o.id, tab: 'config' })} />
            ))}
          </ul>

          <div className={cn('min-w-0', !pedida && 'max-lg:hidden')}>
            <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={() => setParams({}, { replace: true })}>
              <ArrowLeft />
              Todas las empresas
            </Button>

            <header className="mb-4 flex flex-wrap items-center gap-3">
              <Avatar name={actual.name} size="lg" />
              <div className="min-w-0 flex-1 basis-48">
                <h2 className="truncate text-xl font-semibold tracking-tight">{actual.name}</h2>
                <p className="text-[13px] text-muted-foreground">
                  {actual.taxId && <span className="font-mono">{actual.taxId} · </span>}
                  {actual.waNumber ? `+${actual.waNumber}` : 'Sin número propio'}
                </p>
              </div>
              {esAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    label="Tipo de cliente"
                    value={actual.kind}
                    onChange={(kind) => kind !== actual.kind && cambiarTipo.mutate(kind)}
                    options={[
                      { value: 'EMPRESA', label: 'Empresa' },
                      { value: 'PERSONA', label: 'Persona' },
                    ]}
                  />
                  <Button variant="secondary" size="sm" onClick={() => setAbierto('accesos')}>
                    Accesos al panel
                  </Button>
                  <Button variant="danger-soft" size="sm" onClick={() => setAbierto('eliminar')}>
                    Eliminar
                  </Button>
                </div>
              )}
            </header>

            <Segmented
              label="Sección de la empresa"
              value={pestana}
              onChange={(tab) => poner({ empresa: actual.id, tab })}
              options={[
                { value: 'config', label: 'Configuración' },
                {
                  value: 'personas',
                  label: (
                    <>
                      Personas <span className="tabular-nums opacity-60">{actual._count.memberships}</span>
                    </>
                  ),
                },
              ]}
              className="mb-5"
            />

            {/* La clave por empresa cierra lo que estuviera abierto en la anterior. */}
            {pestana === 'personas' ? (
              <Clientes key={actual.id} empresaId={actual.id} />
            ) : (
              <PasosEmpresa key={actual.id} empresa={actual} onVerPersonas={() => poner({ empresa: actual.id, tab: 'personas' })} />
            )}
          </div>
        </div>
      )}

      {abierto === 'alta' && (
        <AltaEmpresa
          onCerrar={() => setAbierto(null)}
          onCreada={(empresa, conPc) => {
            setAbierto(null);
            poner({ empresa: empresa.id, tab: 'config' });
            if (conPc) setConectarPc(empresa);
          }}
        />
      )}
      {abierto === 'accesos' && actual && <AccesosPanel empresa={actual} onCerrar={() => setAbierto(null)} />}
      {abierto === 'eliminar' && actual && (
        <EliminarEmpresa
          empresa={actual}
          onCerrar={() => setAbierto(null)}
          onEliminada={() => {
            setAbierto(null);
            setParams({}, { replace: true });
          }}
        />
      )}
      {conectarPc && <DialogoConector empresa={conectarPc} onCerrar={() => setConectarPc(null)} />}
    </>
  );
}

function FilaEmpresa({ empresa: o, activa, onElegir }: { empresa: Empresa; activa: boolean; onElegir: () => void }) {
  const pasos = pasosDe(o);
  const hechos = pasos.filter((p) => p.listo).length;
  const completa = hechos === pasos.length;
  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        aria-current={activa || undefined}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
          activa && 'lg:bg-primary-soft lg:hover:bg-primary-soft',
        )}
      >
        <Avatar name={o.name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{o.name}</span>
            {o.kind === 'PERSONA' && <Badge>Persona</Badge>}
            {!o.active && <Badge tone="warning">Inactiva</Badge>}
          </span>
          <span className="block text-xs text-muted-foreground">
            {completa ? 'Lista para trabajar' : `Le faltan ${pasos.length - hechos} pasos`}
          </span>
          <span className="mt-1.5 flex gap-1" aria-hidden>
            {pasos.map((p) => (
              <span key={p.nombre} className={cn('h-1 flex-1 rounded-full', p.listo ? 'bg-primary' : 'bg-muted')} />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}
