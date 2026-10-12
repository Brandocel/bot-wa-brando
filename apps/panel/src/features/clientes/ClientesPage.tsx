import { Users } from 'lucide-react';
import { PageHeader } from '@/app/layout/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { useEmpresas } from '@/features/ventas/api';
import { Clientes } from './Clientes';

/**
 * Los clientes de la empresa de quien entró. Es la sección de la gente de
 * una empresa: el servidor solo le devuelve la suya. El equipo de Jarvis ve
 * lo mismo dentro de cada empresa, en Empresas → Personas.
 */
export function ClientesPage() {
  const empresas = useEmpresas();
  const propia = empresas.data?.[0];

  return (
    <>
      <PageHeader title="Clientes" description="Quién puede pedirle documentos al bot por WhatsApp, y qué le falta para recibirlos." />
      {empresas.isPending ? (
        <TableSkeleton />
      ) : empresas.isError ? (
        <ErrorState error={empresas.error} onRetry={() => empresas.refetch()} />
      ) : !propia ? (
        <EmptyState icon={Users} title="No hay empresas registradas" />
      ) : (
        <Clientes empresaId={propia.id} />
      )}
    </>
  );
}
