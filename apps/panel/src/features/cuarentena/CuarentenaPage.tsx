import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/app/layout/PageHeader';
import { CLAVE_RESUMEN } from '@/app/layout/resumen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/segmented';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { useUsuario } from '@/features/auth/sesion';
import { NOMBRE_CATEGORIA, type Categoria } from '@/features/documentos/categorias';
import { api } from '@/lib/api';
import { fecha, mesCorto } from '@/lib/format';

type Vista = 'revision' | 'descartados';
type Decision = 'aprobar' | 'rechazar';

interface Archivo {
  id: string;
  name: string;
  indexedAt: string;
  category: Categoria;
  period: string | null;
  summary: string | null;
  counterpart: string | null;
  docClass: string | null;
  classification: { motivo?: string } | null;
  reviewedBy: string | null;
  organization: { name: string };
}

const EXPLICACION: Record<Vista, string> = {
  revision:
    'Archivos que el clasificador no pudo decidir solo. Mientras estén aquí, no se entregan. Aprueba los que sí son documentos del cliente; rechaza lo interno o ajeno.',
  descartados:
    'Archivos que el clasificador dejó fuera por ser internos o ajenos a la empresa (código, logs, imágenes del sitio…). Si alguno sí es del cliente, apruébalo. Los que traen credenciales no se listan.',
};

export function CuarentenaPage() {
  const esAdmin = useUsuario().role === 'ADMIN';
  const queryClient = useQueryClient();
  const [vista, setVista] = useState<Vista>('revision');
  const [porAprobar, setPorAprobar] = useState<Archivo | null>(null);

  const archivos = useQuery({
    queryKey: ['cuarentena', vista],
    queryFn: () => api.get<Archivo[]>('cuarentena', { vista }),
    refetchInterval: 20_000,
  });

  const revisar = useMutation({
    mutationFn: (v: { id: string; decision: Decision }) => api.post('cuarentena/revisar', v),
    onSuccess: (_, { decision }) => {
      toast.success(decision === 'aprobar' ? 'Aprobado: ya se puede entregar' : 'Rechazado: no se entregará');
      setPorAprobar(null);
      void queryClient.invalidateQueries({ queryKey: ['cuarentena'] });
      void queryClient.invalidateQueries({ queryKey: CLAVE_RESUMEN });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader title="Cuarentena" description={EXPLICACION[vista]} onRefresh={() => archivos.refetch()} />

      <Segmented
        label="Qué archivos ver"
        value={vista}
        onChange={setVista}
        options={[
          { value: 'revision', label: 'Por revisar' },
          { value: 'descartados', label: 'Descartados' },
        ]}
        className="mb-4"
      />

      {archivos.isPending ? (
        <TableSkeleton />
      ) : archivos.isError ? (
        <ErrorState error={archivos.error} onRetry={() => archivos.refetch()} />
      ) : archivos.data.length === 0 ? (
        <EmptyState
          icon={FolderCheck}
          title={vista === 'revision' ? 'Nada por revisar' : 'No hay archivos descartados'}
          description={vista === 'revision' ? 'El clasificador pudo decidir todo lo que llegó.' : undefined}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Archivo</Th>
              <Th>Empresa</Th>
              <Th>Qué parece</Th>
              <Th>Motivo</Th>
              <Th>Llegó</Th>
              {esAdmin && (
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              )}
            </tr>
          </THead>
          <TBody>
            {archivos.data.map((d) => {
              const enCurso = revisar.isPending && revisar.variables.id === d.id;
              return (
                <Tr key={d.id}>
                  <Td className="max-w-xs">
                    <p className="font-medium break-words">{d.name}</p>
                    {d.summary && <p className="mt-0.5 text-[13px] text-muted-foreground">{d.summary}</p>}
                  </Td>
                  <Td>{d.organization.name}</Td>
                  <Td>
                    <Badge>{NOMBRE_CATEGORIA[d.category] ?? d.category}</Badge>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[mesCorto(d.period), d.counterpart].filter(Boolean).join(' · ')}
                    </p>
                  </Td>
                  <Td className="max-w-xs text-[13px] text-muted-foreground">
                    {d.classification?.motivo ?? (d.docClass ? '' : 'El clasificador no respondió; se reintenta solo.')}
                    {d.reviewedBy && <p>Revisó {d.reviewedBy}</p>}
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{fecha(d.indexedAt)}</Td>
                  {esAdmin && (
                    <Td className="py-2">
                      <div className="flex justify-end gap-2">
                        {vista === 'revision' && (
                          <Button
                            variant="danger-soft"
                            size="sm"
                            disabled={enCurso}
                            onClick={() => revisar.mutate({ id: d.id, decision: 'rechazar' })}
                          >
                            Rechazar
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" disabled={enCurso} onClick={() => setPorAprobar(d)}>
                          Aprobar
                        </Button>
                      </div>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={porAprobar !== null}
        onOpenChange={(abierto) => !abierto && setPorAprobar(null)}
        title="¿Aprobar este archivo?"
        description={
          <>
            El bot podrá mandar <strong className="font-medium text-foreground">{porAprobar?.name}</strong> por WhatsApp a
            quien tenga permiso.
          </>
        }
        confirmLabel="Aprobar"
        loading={revisar.isPending}
        onConfirm={() => porAprobar && revisar.mutate({ id: porAprobar.id, decision: 'aprobar' })}
      />
    </>
  );
}
