import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dinero } from '@/lib/format';
import { useAlcance, usePuedeGestionar, type Producto } from './api';
import { DIAS, type Dia } from './catalogos';

const NUEVO = { name: '', section: '', description: '', priceCents: 0, active: true, availableDays: [] as Dia[] };

export function Catalogo({ empresaId }: { empresaId: string }) {
  const { params } = useAlcance(empresaId);
  const puedeGestionar = usePuedeGestionar();
  /** El producto en edición; `NUEVO` para dar de alta; null con el panel cerrado. */
  const [editando, setEditando] = useState<Partial<Producto> | null>(null);

  const productos = useQuery({
    queryKey: ['ventas', empresaId, 'productos'],
    queryFn: () => api.get<Producto[]>('ventas/productos', params),
  });

  return (
    <>
      {puedeGestionar && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setEditando(NUEVO)}>
            <Plus />
            Producto
          </Button>
        </div>
      )}

      {productos.isPending ? (
        <TableSkeleton />
      ) : productos.isError ? (
        <ErrorState error={productos.error} onRetry={() => productos.refetch()} />
      ) : productos.data.length === 0 ? (
        <EmptyState icon={Package} title="Todavía no hay productos" description="El bot solo vende lo que esté aquí." />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Producto</Th>
              <Th>Sección</Th>
              <Th>Precio</Th>
              <Th>Estado</Th>
              {puedeGestionar && (
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              )}
            </tr>
          </THead>
          <TBody>
            {productos.data.map((p) => (
              <Tr key={p.id} className={cn(!p.active && 'text-muted-foreground')}>
                <Td className="max-w-md">
                  <span className="font-medium">{p.name}</span>{' '}
                  {!!p.availableDays?.length && (
                    <Badge tone="warning">
                      solo {p.availableDays.map((d) => DIAS.find((x) => x.clave === d)?.nombre.toLowerCase() ?? d).join(', ')}
                    </Badge>
                  )}
                  {p.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{p.description}</p>}
                </Td>
                <Td>{p.section || '—'}</Td>
                <Td className="tabular-nums">{dinero(p.priceCents)}</Td>
                <Td>{p.active ? <Badge tone="success">Disponible</Badge> : <Badge>No disponible</Badge>}</Td>
                {puedeGestionar && (
                  <Td className="py-2 text-right">
                    <Button variant="secondary" size="sm" onClick={() => setEditando(p)}>
                      Editar
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {editando && <FormProducto empresaId={empresaId} producto={editando} onCerrar={() => setEditando(null)} />}
    </>
  );
}

interface FormProps {
  empresaId: string;
  producto: Partial<Producto>;
  onCerrar: () => void;
}

function FormProducto({ empresaId, producto, onCerrar }: FormProps) {
  const { cuerpo } = useAlcance(empresaId);
  const queryClient = useQueryClient();
  const [p, setP] = useState({
    name: producto.name ?? '',
    section: producto.section ?? '',
    description: producto.description ?? '',
    price: (producto.priceCents ?? 0) / 100,
    active: producto.active ?? true,
    availableDays: producto.availableDays ?? [],
  });

  const guardar = useMutation({
    mutationFn: () => api.post('ventas/productos', { ...cuerpo, id: producto.id, ...p }),
    onSuccess: () => {
      toast.success('Producto guardado');
      void queryClient.invalidateQueries({ queryKey: ['ventas', empresaId, 'productos'] });
      void queryClient.invalidateQueries({ queryKey: ['empresas'] });
      onCerrar();
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    guardar.mutate();
  };

  const alternarDia = (dia: Dia) =>
    setP({
      ...p,
      availableDays: p.availableDays.includes(dia) ? p.availableDays.filter((d) => d !== dia) : [...p.availableDays, dia],
    });

  return (
    <Sheet
      open
      onOpenChange={(abierto) => !abierto && onCerrar()}
      title={producto.id ? 'Editar producto' : 'Nuevo producto'}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="form-producto" loading={guardar.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="form-producto" onSubmit={enviar} className="flex flex-col gap-4">
        <Field label="Nombre">
          {(ids) => (
            <Input
              {...ids}
              required
              value={p.name}
              onChange={(e) => setP({ ...p, name: e.target.value })}
              placeholder="Ej. Plan Pro mensual, Pollo entero"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sección">
            {(ids) => (
              <Input {...ids} value={p.section} onChange={(e) => setP({ ...p, section: e.target.value })} placeholder="Ej. Planes, Extras" />
            )}
          </Field>
          <Field label="Precio (pesos)">
            {(ids) => (
              <Input
                {...ids}
                type="number"
                min={0}
                step={0.5}
                required
                value={p.price}
                onChange={(e) => setP({ ...p, price: e.target.valueAsNumber || 0 })}
              />
            )}
          </Field>
        </div>
        <Field label="Descripción" hint="El bot la usa para recomendar: qué incluye y para quién es.">
          {(ids) => (
            <Textarea {...ids} rows={3} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
          )}
        </Field>
        <fieldset>
          <legend className="text-[13px] font-medium">
            Qué días se vende <span className="font-normal text-muted-foreground">(sin marcar = todos)</span>
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DIAS.map((d) => (
              <Checkbox key={d.clave} checked={p.availableDays.includes(d.clave)} onChange={() => alternarDia(d.clave)}>
                {d.nombre}
              </Checkbox>
            ))}
          </div>
        </fieldset>
        <Checkbox checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })}>
          Disponible para vender
        </Checkbox>
      </form>
    </Sheet>
  );
}
