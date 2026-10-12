import { ShoppingCart } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/app/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Callout, EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { useUsuario } from '@/features/auth/sesion';
import { plural } from '@/lib/format';
import { useEmpresas, type Empresa } from './api';
import { Catalogo } from './Catalogo';
import { ConfigFacturacion } from './ConfigFacturacion';
import { ConfigVentas } from './ConfigVentas';
import { Facturas } from './Facturas';
import { Pedidos } from './Pedidos';

type Pestana = 'pedidos' | 'catalogo' | 'config' | 'facturas' | 'facturacion';

const PESTANAS: ReadonlyArray<{ value: Pestana; label: string }> = [
  { value: 'pedidos', label: 'Pedidos' },
  { value: 'catalogo', label: 'Catálogo' },
  { value: 'config', label: 'Configuración' },
  { value: 'facturas', label: 'Facturas' },
  { value: 'facturacion', label: 'Facturación' },
];

const RECORDADA = 'vt-empresa';

/**
 * La empresa que se ve en Ventas: la de la URL, la última que elegiste o,
 * si no hay, una que de verdad vende. Abrir en la primera por orden
 * alfabético hizo que un catálogo acabara capturado en la empresa equivocada.
 */
function elegirEmpresa(empresas: Empresa[], pedida: string | null): Empresa | undefined {
  let guardada: string | null = null;
  try {
    guardada = localStorage.getItem(RECORDADA);
  } catch {
    // Sin almacenamiento, se elige por lo que vende.
  }
  return (
    empresas.find((o) => o.id === pedida) ??
    empresas.find((o) => o.id === guardada) ??
    empresas.find((o) => o.waLineId && o.sales?.enabled) ??
    empresas.find((o) => o.waLineId) ??
    empresas[0]
  );
}

/** Pedidos, catálogo, configuración y facturas de una empresa. Empresa y pestaña van en la URL. */
export function VentasPage() {
  const usuario = useUsuario();
  const empresas = useEmpresas();
  const [params, setParams] = useSearchParams();
  const pestana = (PESTANAS.find((p) => p.value === params.get('tab'))?.value ?? 'pedidos') as Pestana;

  const poner = (cambios: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...cambios }, { replace: true });

  const actual = empresas.data && elegirEmpresa(empresas.data, params.get('empresa'));
  // Las que venden primero: son las que el equipo viene a revisar.
  const ordenadas = [...(empresas.data ?? [])].sort(
    (a, b) =>
      Number(!!b.sales?.enabled) - Number(!!a.sales?.enabled) ||
      Number(!!b.waLineId) - Number(!!a.waLineId) ||
      a.name.localeCompare(b.name, 'es'),
  );

  return (
    <>
      <PageHeader title="Ventas" description="Lo que el bot vende por WhatsApp y lo que hay que aceptar o timbrar.">
        {usuario.role !== 'EMPRESA' && actual && ordenadas.length > 1 && (
          <Select
            aria-label="Empresa"
            className="w-64"
            value={actual.id}
            onChange={(e) => {
              try {
                localStorage.setItem(RECORDADA, e.target.value);
              } catch {
                // Solo deja de recordarse entre visitas.
              }
              poner({ empresa: e.target.value });
            }}
          >
            {ordenadas.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.sales?.enabled ? ' · vende' : o.waLineId ? ' · WhatsApp propio' : ''}
              </option>
            ))}
          </Select>
        )}
      </PageHeader>

      {empresas.isPending ? (
        <TableSkeleton />
      ) : empresas.isError ? (
        <ErrorState error={empresas.error} onRetry={() => empresas.refetch()} />
      ) : !actual ? (
        <EmptyState icon={ShoppingCart} title="No hay empresas registradas" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {actual.waLineId ? (
              <Badge tone="success">WhatsApp {actual.waNumber ? `+${actual.waNumber}` : 'conectado'}</Badge>
            ) : (
              <Badge tone="warning">Sin WhatsApp propio</Badge>
            )}
            {actual.sales?.enabled ? <Badge tone="success">Ventas activas</Badge> : <Badge>Ventas apagadas</Badge>}
            <Badge>{plural(actual._count.products, 'producto', 'productos')}</Badge>
          </div>

          {!actual.waLineId && (
            <Callout tone="warning" className="mb-4">
              {actual.name} no tiene WhatsApp propio. Las ventas solo entran por el número de la empresa: conéctalo en
              Empresas. Mientras tanto, el bot no ofrece nada de lo que captures aquí.
            </Callout>
          )}

          <Segmented
            label="Sección de ventas"
            value={pestana}
            onChange={(tab) => poner({ tab })}
            options={PESTANAS}
            className="mb-5"
          />

          {/* La clave por empresa reinicia filtros y formularios al cambiar de empresa. */}
          {pestana === 'pedidos' && <Pedidos key={actual.id} empresaId={actual.id} />}
          {pestana === 'catalogo' && <Catalogo key={actual.id} empresaId={actual.id} />}
          {pestana === 'config' && <ConfigVentas key={actual.id} empresaId={actual.id} />}
          {pestana === 'facturas' && <Facturas key={actual.id} empresaId={actual.id} />}
          {pestana === 'facturacion' && (
            <div className="max-w-3xl">
              <ConfigFacturacion key={actual.id} empresaId={actual.id} />
            </div>
          )}
        </>
      )}
    </>
  );
}
