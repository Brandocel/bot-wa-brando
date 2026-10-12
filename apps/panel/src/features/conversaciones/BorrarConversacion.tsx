import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/feedback';
import { api } from '@/lib/api';

type Modo = 'mensajes' | 'todo';

interface Resultado {
  modo: Modo;
  mensajes: number;
  tickets: number;
}

interface Props {
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  chatId: string;
  quien: string;
  /** `todo` = la conversación ya no existe: hay que cerrar el hilo. */
  onBorrado: (todo: boolean) => void;
}

/**
 * Borrar mensajes o eliminar la conversación entera.
 *
 * El servidor es quien sabe si hay tickets sin cerrar: si los hay rechaza el
 * borrado, se enseña su aviso y hay que confirmar otra vez para forzarlo.
 */
export function BorrarConversacion({ open, onOpenChange, chatId, quien, onBorrado }: Props) {
  const [aviso, setAviso] = useState<{ modo: Modo; texto: string } | null>(null);

  const cerrar = (abierto: boolean) => {
    if (!abierto) setAviso(null);
    onOpenChange(abierto);
  };

  const borrar = useMutation({
    mutationFn: (v: { modo: Modo; forzar?: boolean }) => api.post<Resultado>('conversacion/borrar', { chatId, ...v }),
    onSuccess: (r) => {
      toast.success(
        r.modo === 'todo'
          ? `Conversación eliminada (${r.mensajes} mensajes, ${r.tickets} tickets).`
          : `Listo: ${r.mensajes} mensajes borrados. El hilo queda limpio.`,
      );
      cerrar(false);
      onBorrado(r.modo === 'todo');
    },
    onError: (err, v) => {
      if (err.message.includes('sin cerrar') && !v.forzar) setAviso({ modo: v.modo, texto: err.message });
      else toast.error(err.message);
    },
  });

  const enCurso = (modo: Modo) => borrar.isPending && borrar.variables.modo === modo;

  return (
    <Dialog
      open={open}
      onOpenChange={cerrar}
      title="Borrar conversación"
      description={
        <>
          Afecta a <strong className="font-medium text-foreground">{quien}</strong> y a todos sus hilos (número y LID). No
          se puede deshacer.
        </>
      }
      footer={
        <Button variant="secondary" onClick={() => cerrar(false)} disabled={borrar.isPending}>
          Cancelar
        </Button>
      }
    >
      {aviso ? (
        <Callout tone="danger" title="Hay tickets sin cerrar">
          <p className="first-letter:uppercase">{aviso.texto}</p>
          <Button
            variant="danger"
            size="sm"
            className="mt-3"
            loading={borrar.isPending}
            onClick={() => borrar.mutate({ modo: aviso.modo, forzar: true })}
          >
            Borrar de todos modos
          </Button>
        </Callout>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border p-4">
            <p className="font-medium">Borrar los mensajes</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Se va el historial del chat y lo que el bot recordaba de la petición en curso. Los tickets y los permisos se
              quedan. La próxima vez que escriba, empieza de cero.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              loading={enCurso('mensajes')}
              disabled={borrar.isPending}
              onClick={() => borrar.mutate({ modo: 'mensajes' })}
            >
              Borrar los mensajes
            </Button>
          </div>
          <div className="rounded-lg border border-danger/30 bg-danger-soft p-4">
            <p className="font-medium">Eliminar todo</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Desaparece la conversación completa: mensajes <em>y</em> tickets. La persona sigue dada de alta y con sus
              permisos; solo se borra el rastro de la charla.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-3"
              loading={enCurso('todo')}
              disabled={borrar.isPending}
              onClick={() => borrar.mutate({ modo: 'todo' })}
            >
              Eliminar todo
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
