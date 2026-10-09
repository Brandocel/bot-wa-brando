import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileText } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/app/layout/PageHeader';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import { mesLargo, plural, tamano } from '@/lib/format';
import { CATEGORIAS, NOMBRE_CATEGORIA, type Categoria } from './categorias';

type Estado = 'entregables' | 'revision' | 'descartados' | 'todos';

interface Empresa {
  id: string;
  name: string;
}

interface Documento {
  id: string;
  name: string;
  sizeBytes: number;
  category: Categoria;
  period: string | null;
  folio: string | null;
  summary: string | null;
  counterpart: string | null;
  holderByOperator: boolean;
  status: 'INDEXED' | 'QUARANTINE' | 'EXCLUDED';
  docClass: string | null;
}

const ESTADO_DOC: Record<Documento['status'], { texto: string; tono: Tone }> = {
  INDEXED: { texto: 'Entregable', tono: 'success' },
  QUARANTINE: { texto: 'Por revisar', tono: 'warning' },
  EXCLUDED: { texto: 'Descartado', tono: 'neutral' },
};

const SIN_MES = 'sin-mes';

/** Tipo → mes → documentos. Los meses del más reciente al más viejo; "sin mes" al final. */
function agrupar(docs: Documento[]): Array<{ categoria: Categoria; total: number; meses: Array<[string, Documento[]]> }> {
  const porTipo = new Map<Categoria, Map<string, Documento[]>>();
  for (const d of docs) {
    const mes = d.period ? d.period.slice(0, 7) : SIN_MES;
    const meses = porTipo.get(d.category) ?? new Map<string, Documento[]>();
    porTipo.set(d.category, meses);
    meses.set(mes, [...(meses.get(mes) ?? []), d]);
  }

  return CATEGORIAS.filter((c) => porTipo.has(c)).map((categoria) => {
    const meses = [...porTipo.get(categoria)!.entries()].sort(([a], [b]) =>
      a === SIN_MES ? 1 : b === SIN_MES ? -1 : b.localeCompare(a),
    );
    return { categoria, meses, total: meses.reduce((n, [, lista]) => n + lista.length, 0) };
  });
}

export function DocumentosPage() {
  const usuario = useUsuario();
  // Corregir el titular decide qué cliente recibe el documento.
  const puedeGestionar = usuario.role === 'ADMIN' || usuario.role === 'EMPRESA';

  const [elegida, setElegida] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>('entregables');
  const [editando, setEditando] = useState<Documento | null>(null);

  const empresas = useQuery({ queryKey: ['empresas'], queryFn: () => api.get<Empresa[]>('empresas') });
  const empresa = empresas.data?.some((o) => o.id === elegida) ? elegida : (empresas.data?.[0]?.id ?? null);

  const documentos = useQuery({
    queryKey: ['documentos', empresa, estado],
    queryFn: () => api.get<Documento[]>('documentos', { empresa: empresa!, estado }),
    enabled: empresa !== null,
    refetchInterval: 20_000,
  });

  const grupos = useMemo(() => agrupar(documentos.data ?? []), [documentos.data]);

  return (
    <>
      <PageHeader
        title="Documentos"
        description="Lo que el bot tiene de cada empresa, por tipo y por mes."
        onRefresh={() => documentos.refetch()}
      />

      {empresas.isPending ? (
        <TableSkeleton />
      ) : empresas.isError ? (
        <ErrorState error={empresas.error} onRetry={() => empresas.refetch()} />
      ) : empresas.data.length === 0 ? (
        <EmptyState icon={FileText} title="No hay empresas registradas" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {empresas.data.length > 1 && (
              <Select
                aria-label="Empresa"
                className="w-full sm:w-64"
                value={empresa ?? ''}
                onChange={(e) => setElegida(e.target.value)}
              >
                {empresas.data.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
            <Segmented
              label="Estado de los documentos"
              value={estado}
              onChange={setEstado}
              options={[
                { value: 'entregables', label: 'Entregables' },
                { value: 'revision', label: 'Por revisar' },
                { value: 'descartados', label: 'Descartados' },
                { value: 'todos', label: 'Todos' },
              ]}
            />
            {documentos.data && (
              <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">
                {plural(documentos.data.length, 'documento', 'documentos')}
              </span>
            )}
          </div>

          {documentos.isPending ? (
            <TableSkeleton />
          ) : documentos.isError ? (
            <ErrorState error={documentos.error} onRetry={() => documentos.refetch()} />
          ) : grupos.length === 0 ? (
            <EmptyState icon={FileText} title="No hay documentos con este filtro" />
          ) : (
            <div className="flex flex-col gap-4">
              {grupos.map(({ categoria, total, meses }) => (
                <Card key={categoria}>
                  <h2 className="flex items-baseline gap-2 px-5 py-4 text-base font-semibold tracking-tight">
                    {NOMBRE_CATEGORIA[categoria]}
                    <span className="text-[13px] font-normal text-muted-foreground tabular-nums">{total}</span>
                  </h2>
                  {meses.map(([mes, lista]) => (
                    // La clave lleva la empresa: al cambiarla, los meses abiertos no se heredan.
                    <details key={`${empresa}|${mes}`} className="group border-t">
                      <summary className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors select-none hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                          className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
                          aria-hidden
                        />
                        {mes === SIN_MES ? 'Sin mes' : mesLargo(`${mes}-01T00:00:00Z`)}
                        <span className="text-[13px] font-normal text-muted-foreground tabular-nums">{lista.length}</span>
                      </summary>
                      <ul className="divide-y border-t">
                        {lista.map((d) => (
                          <FilaDocumento key={d.id} doc={d} onEditar={puedeGestionar ? () => setEditando(d) : undefined} />
                        ))}
                      </ul>
                    </details>
                  ))}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {editando && <DialogoTitular doc={editando} onCerrar={() => setEditando(null)} />}
    </>
  );
}

function FilaDocumento({ doc, onEditar }: { doc: Documento; onEditar?: () => void }) {
  const titular = doc.counterpart
    ? `a nombre de ${doc.counterpart}${doc.holderByOperator ? ' (corregido)' : ''}`
    : 'sin titular';
  const detalle = [doc.folio && `folio ${doc.folio}`, titular, tamano(doc.sizeBytes)].filter(Boolean).join(' · ');

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 pr-5 pl-11">
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium break-words">{doc.name}</p>
        {doc.summary && <p className="mt-0.5 text-[13px] text-muted-foreground">{doc.summary}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{detalle}</p>
      </div>
      {doc.docClass === 'SENSIBLE' ? (
        <Badge tone="warning">Sensible</Badge>
      ) : (
        <Badge tone={ESTADO_DOC[doc.status].tono}>{ESTADO_DOC[doc.status].texto}</Badge>
      )}
      {onEditar && (
        <Button variant="secondary" size="sm" onClick={onEditar}>
          Titular
        </Button>
      )}
    </li>
  );
}

function DialogoTitular({ doc, onCerrar }: { doc: Documento; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [titular, setTitular] = useState(doc.counterpart ?? '');

  const guardar = useMutation({
    mutationFn: () => api.post('documentos/titular', { id: doc.id, titular }),
    onSuccess: () => {
      toast.success(titular.trim() ? 'Titular guardado' : 'Titular borrado: ningún cliente lo recibirá');
      void queryClient.invalidateQueries({ queryKey: ['documentos'] });
      onCerrar();
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    guardar.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(abierto) => !abierto && onCerrar()}
      title="¿A nombre de quién va?"
      description={doc.name}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="form-titular" loading={guardar.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="form-titular" onSubmit={enviar}>
        <Field
          label="Titular"
          hint="Un cliente solo recibe el documento si su nombre completo coincide. Vacío: no lo recibe ningún cliente."
        >
          {(ids) => (
            <Input {...ids} value={titular} onChange={(e) => setTitular(e.target.value)} maxLength={200} autoFocus />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
