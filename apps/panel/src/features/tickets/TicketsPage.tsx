import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Ticket as IconoTicket } from 'lucide-react';
import { PageHeader } from '@/app/layout/PageHeader';
import { abrirClasico } from '@/app/navegacion';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fecha, numeroBonito } from '@/lib/format';

type Estado = 'ABIERTO' | 'EN_REVISION' | 'CERRADO';
type Prioridad = 'BAJA' | 'MEDIA' | 'ALTA';

interface Ticket {
  id: string;
  number: number;
  subject: string;
  state: Estado;
  priority: Prioridad;
  level: number;
  createdAt: string;
  organization: { name: string } | null;
  contact: { waId: string; displayName: string | null } | null;
}

const ESTADO: Record<Estado, { texto: string; tono: Tone }> = {
  ABIERTO: { texto: 'Abierto', tono: 'info' },
  EN_REVISION: { texto: 'En revisión', tono: 'warning' },
  CERRADO: { texto: 'Cerrado', tono: 'neutral' },
};

const PRIORIDAD: Record<Prioridad, { texto: string; tono: Tone }> = {
  ALTA: { texto: 'Alta', tono: 'danger' },
  MEDIA: { texto: 'Media', tono: 'warning' },
  BAJA: { texto: 'Baja', tono: 'neutral' },
};

export function TicketsPage() {
  const tickets = useQuery({
    queryKey: ['tickets'],
    queryFn: () => api.get<Ticket[]>('tickets'),
    refetchInterval: 20_000,
  });

  return (
    <>
      <PageHeader
        title="Tickets"
        description="Lo que el bot escaló a una persona, del más urgente al más reciente."
        onRefresh={() => tickets.refetch()}
      />

      {tickets.isPending ? (
        <TableSkeleton />
      ) : tickets.isError ? (
        <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />
      ) : tickets.data.length === 0 ? (
        <EmptyState icon={IconoTicket} title="No hay tickets" description="Cuando el bot escale una conversación, aparece aquí." />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Folio</Th>
              <Th>Asunto</Th>
              <Th>Estado</Th>
              <Th>Prioridad</Th>
              <Th>Empresa</Th>
              <Th>Contacto</Th>
              <Th>Creado</Th>
              <Th>
                <span className="sr-only">Acciones</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {tickets.data.map((t) => (
              <Tr key={t.id}>
                <Td className="font-mono text-[13px] text-muted-foreground">#{t.number}</Td>
                <Td className="max-w-xs min-w-48 font-medium">
                  {t.subject}
                </Td>
                <Td className="whitespace-nowrap">
                  <Badge tone={ESTADO[t.state].tono} dot>
                    {ESTADO[t.state].texto}
                  </Badge>
                  {t.level > 0 && <span className="ml-2 text-xs text-muted-foreground">nivel {t.level}</span>}
                </Td>
                <Td>
                  <Badge tone={PRIORIDAD[t.priority].tono}>{PRIORIDAD[t.priority].texto}</Badge>
                </Td>
                <Td>{t.organization?.name ?? '—'}</Td>
                <Td>{t.contact?.displayName ?? numeroBonito(t.contact?.waId)}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">{fecha(t.createdAt)}</Td>
                <Td className="py-2 text-right">
                  {t.contact?.waId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Abrir la conversación del ticket ${t.number}`}
                      title="Abrir la conversación (panel clásico)"
                      onClick={() => abrirClasico('tickets', t.contact!.waId)}
                    >
                      <MessageSquare />
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
