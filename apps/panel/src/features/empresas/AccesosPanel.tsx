import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';
import type { Empresa, UsuarioPanel } from './api';

/**
 * Quién de una empresa entra a su propio panel: ve y gestiona sus clientes
 * y sus documentos, nada más. La contraseña la genera el servidor y se
 * enseña una sola vez.
 */
export function AccesosPanel({ empresa, onCerrar }: { empresa: Empresa; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const clave = ['empresas', empresa.id, 'usuarios'];
  const [nuevo, setNuevo] = useState({ name: '', email: '' });
  const [creado, setCreado] = useState<{ email: string; password: string } | null>(null);
  const [porQuitar, setPorQuitar] = useState<UsuarioPanel | null>(null);

  const usuarios = useQuery({
    queryKey: clave,
    queryFn: () => api.get<UsuarioPanel[]>('empresas/usuarios', { empresa: empresa.id }),
  });

  const crear = useMutation({
    mutationFn: () => api.post<{ email: string; password: string }>('empresas/usuarios', { organizationId: empresa.id, ...nuevo }),
    onSuccess: (r) => {
      setCreado(r);
      setNuevo({ name: '', email: '' });
      toast.success('Acceso creado');
      void queryClient.invalidateQueries({ queryKey: clave });
    },
    onError: (err) => toast.error(err.message),
  });

  const quitar = useMutation({
    mutationFn: (id: string) => api.post('empresas/usuarios/baja', { id }),
    onSuccess: () => {
      toast.success('Acceso al panel retirado');
      setPorQuitar(null);
      void queryClient.invalidateQueries({ queryKey: clave });
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    crear.mutate();
  };

  return (
    <Sheet
      open
      onOpenChange={(a) => !a && onCerrar()}
      title={`Accesos al panel · ${empresa.name}`}
      description="Ven y gestionan sus clientes y sus documentos. No ven conversaciones, tickets ni otras empresas."
    >
      <div className="flex flex-col gap-5">
        {creado && (
          <Callout tone="warning" title={`Contraseña de ${creado.email}`}>
            <p className="font-mono text-base break-all select-all">{creado.password}</p>
            <p>Cópiala ahora y compártela por un canal seguro: no se vuelve a mostrar.</p>
          </Callout>
        )}

        {usuarios.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : usuarios.isError ? (
          <ErrorState error={usuarios.error} onRetry={() => usuarios.refetch()} />
        ) : usuarios.data.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nadie de esta empresa tiene acceso todavía.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {usuarios.data.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email} · {u.lastLoginAt ? `entró ${fecha(u.lastLoginAt)}` : 'aún no entra'}
                  </p>
                </div>
                <Button variant="danger-soft" size="sm" onClick={() => setPorQuitar(u)}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={enviar} className="flex flex-col gap-4 border-t pt-5">
          <h3 className="font-semibold">Dar acceso a alguien</h3>
          <Field label="Nombre">
            {(ids) => (
              <Input {...ids} required placeholder="Paula Flores" value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} />
            )}
          </Field>
          <Field label="Correo">
            {(ids) => (
              <Input
                {...ids}
                type="email"
                required
                placeholder="paula@empresa.com"
                value={nuevo.email}
                onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
              />
            )}
          </Field>
          <Button type="submit" loading={crear.isPending} className="self-start">
            Dar acceso
          </Button>
        </form>
      </div>

      <ConfirmDialog
        open={porQuitar !== null}
        onOpenChange={(a) => !a && setPorQuitar(null)}
        title="¿Quitarle el acceso al panel?"
        description={`La sesión de ${porQuitar?.name ?? 'esta persona'} se cierra en ese momento.`}
        confirmLabel="Quitar acceso"
        variant="danger"
        loading={quitar.isPending}
        onConfirm={() => porQuitar && quitar.mutate(porQuitar.id)}
      />
    </Sheet>
  );
}
