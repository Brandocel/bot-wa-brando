import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/app/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fecha, numeroBonito } from '@/lib/format';

interface Acceso {
  id: string;
  createdAt: string;
  waId: string;
  query: string;
  /** ALLOW o el motivo de la negación (DENY_NO_GRANT, NOT_FOUND…). */
  decision: string;
  decidedBy: string;
}

export function AuditoriaPage() {
  const accesos = useQuery({
    queryKey: ['auditoria'],
    queryFn: () => api.get<Acceso[]>('auditoria'),
    refetchInterval: 20_000,
  });

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Toda decisión de acceso, permitida o no. Al cliente siempre se le responde «no encontré»; el motivo real está aquí."
        onRefresh={() => accesos.refetch()}
      />

      {accesos.isPending ? (
        <TableSkeleton />
      ) : accesos.isError ? (
        <ErrorState error={accesos.error} onRetry={() => accesos.refetch()} />
      ) : accesos.data.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Sin registros" description="Aún nadie ha pedido un documento." />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Cuándo</Th>
              <Th>Número</Th>
              <Th>Consulta</Th>
              <Th>Decisión</Th>
              <Th>Regla</Th>
            </tr>
          </THead>
          <TBody>
            {accesos.data.map((a) => (
              <Tr key={a.id}>
                <Td className="whitespace-nowrap text-muted-foreground">{fecha(a.createdAt)}</Td>
                <Td className="font-mono text-[13px]">{numeroBonito(a.waId)}</Td>
                <Td className="max-w-md">{a.query}</Td>
                <Td>
                  <Badge tone={a.decision === 'ALLOW' ? 'success' : 'warning'} dot>
                    {a.decision === 'ALLOW' ? 'Permitido' : a.decision}
                  </Badge>
                </Td>
                <Td className="text-muted-foreground">{a.decidedBy}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
