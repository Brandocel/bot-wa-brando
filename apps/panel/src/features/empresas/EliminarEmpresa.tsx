import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useRefrescarEmpresas, type Empresa } from './api';

interface Props {
  empresa: Empresa;
  onCerrar: () => void;
  onEliminada: () => void;
}

/**
 * Borrar una empresa se lleva todo lo suyo: se pide el nombre escrito, no un
 * clic, para que no pase por accidente.
 */
export function EliminarEmpresa({ empresa, onCerrar, onEliminada }: Props) {
  const refrescar = useRefrescarEmpresas();
  const [escrito, setEscrito] = useState('');
  const coincide = escrito.trim() === empresa.name.trim();

  const eliminar = useMutation({
    mutationFn: () => api.post('empresas/borrar', { id: empresa.id, confirmar: escrito }),
    onSuccess: () => {
      toast.success('Empresa eliminada');
      refrescar();
      onEliminada();
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (coincide) eliminar.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(a) => !a && onCerrar()}
      title={`Eliminar ${empresa.name}`}
      description="Para siempre: sus números autorizados, documentos indexados, usuarios de panel, catálogo y pedidos. Su WhatsApp propio se desvincula. Los archivos en Drive o en la PC no se tocan."
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={eliminar.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="form-eliminar-empresa" variant="danger" disabled={!coincide} loading={eliminar.isPending}>
            Eliminar para siempre
          </Button>
        </>
      }
    >
      <form id="form-eliminar-empresa" onSubmit={enviar}>
        <Field label={<>Escribe <strong className="font-semibold">{empresa.name}</strong> para confirmar</>}>
          {(ids) => <Input {...ids} autoFocus autoComplete="off" value={escrito} onChange={(e) => setEscrito(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}
