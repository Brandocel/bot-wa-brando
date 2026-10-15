import { MessageCircle } from 'lucide-react';
import { PageHeader } from '@/app/layout/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { useEmpresas } from '@/features/ventas/api';
import { PasoWhatsApp } from './PasoWhatsApp';

/** Para el usuario de una empresa: vincular su propio WhatsApp desde donde esté. */
export function MiWhatsAppPage() {
  const empresas = useEmpresas();
  const propia = empresas.data?.[0];

  return (
    <>
      <PageHeader title="WhatsApp" description="Vincula tu número para que el bot conteste por él." />
      {empresas.isPending ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : empresas.isError ? (
        <ErrorState error={empresas.error} onRetry={() => empresas.refetch()} />
      ) : !propia ? (
        <EmptyState icon={MessageCircle} title="Sin empresa asignada" />
      ) : (
        <section className="rounded-lg border bg-surface p-5 shadow-xs">
          <h2 className="mb-3 font-semibold">{propia.name}</h2>
          <PasoWhatsApp empresa={propia} />
        </section>
      )}
    </>
  );
}
