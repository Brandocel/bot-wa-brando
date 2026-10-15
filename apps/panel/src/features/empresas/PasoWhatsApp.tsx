import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import { claveWa, useEstadoWa, useRefrescarEmpresas, type Empresa, type EstadoLinea } from './api';

const ESTADO: Partial<Record<EstadoLinea, { texto: string; tono: Tone }>> = {
  CONNECTED: { texto: 'Conectado', tono: 'success' },
  WAITING_QR: { texto: 'Falta escanear', tono: 'warning' },
  DISCONNECTED: { texto: 'Desvinculado', tono: 'warning' },
  CRASHED: { texto: 'Con error', tono: 'danger' },
};

/**
 * El WhatsApp de una empresa. Sin número propio se atiende por el principal;
 * con él, se enseña si está conectado, esperando el QR o si lo desvincularon
 * desde el teléfono.
 */
export function PasoWhatsApp({ empresa: o }: { empresa: Empresa }) {
  const usuario = useUsuario();
  const esAdmin = usuario.role === 'ADMIN';
  // La empresa misma también vincula su número, desde donde esté.
  const puedeVincular = esAdmin || (usuario.role === 'EMPRESA' && usuario.organizationId === o.id);
  const refrescar = useRefrescarEmpresas();
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState<'conectar' | 'desconectar' | null>(null);
  const [qrAbierto, setQrAbierto] = useState(false);
  const wa = useEstadoWa(o.id, !!o.waLineId || qrAbierto, qrAbierto);

  const accion = useMutation({
    mutationFn: (ruta: 'conectar' | 'desconectar') => api.post(`empresas/whatsapp/${ruta}`, { id: o.id }),
    onSuccess: (_, ruta) => {
      setConfirmando(null);
      if (ruta === 'conectar') setQrAbierto(true);
      else toast.success('Número desconectado');
      refrescar();
      void queryClient.invalidateQueries({ queryKey: claveWa(o.id) });
    },
    onError: (err) => {
      setConfirmando(null);
      toast.error(err.message);
    },
  });

  const conectada = !!o.waLineId || !!wa.data?.conectada;
  const estado = wa.data?.estado;
  const numero = wa.data?.numero ?? o.waNumber;
  const visto = estado ? ESTADO[estado] : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!conectada ? (
        <>
          <span className="text-[13px] text-muted-foreground">Se atiende por el número principal</span>
          {puedeVincular && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmando('conectar')}>
              Conectar WhatsApp
            </Button>
          )}
        </>
      ) : (
        <>
          <Badge tone={visto?.tono ?? 'neutral'} dot>
            {visto?.texto ?? 'Conectando…'}
          </Badge>
          {numero && <span className="font-mono text-[13px]">+{numero}</span>}
          {puedeVincular && estado === 'WAITING_QR' && (
            <Button variant="secondary" size="sm" onClick={() => setQrAbierto(true)}>
              Ver QR
            </Button>
          )}
          {puedeVincular && (estado === 'DISCONNECTED' || estado === 'CRASHED' || estado === 'DESCONOCIDO') && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmando('conectar')}>
              Volver a conectar
            </Button>
          )}
          {esAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmando('desconectar')}>
              Desconectar
            </Button>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmando === 'conectar'}
        onOpenChange={(a) => !a && setConfirmando(null)}
        title={`¿Conectar el WhatsApp de ${o.name}?`}
        description={`Vas a necesitar el teléfono de la empresa para escanear un código QR. Desde ese número, el bot solo entregará documentos de ${o.name}.`}
        confirmLabel="Conectar"
        loading={accion.isPending}
        onConfirm={() => accion.mutate('conectar')}
      />
      <ConfirmDialog
        open={confirmando === 'desconectar'}
        onOpenChange={(a) => !a && setConfirmando(null)}
        title="¿Desconectar este número?"
        description="Sale de «Dispositivos vinculados» del teléfono de la empresa y, desde ese momento, a la empresa se la atiende por el número principal."
        confirmLabel="Desconectar"
        variant="danger"
        loading={accion.isPending}
        onConfirm={() => accion.mutate('desconectar')}
      />
      {qrAbierto && (
        <DialogoQr
          empresa={o}
          estado={estado ?? null}
          numero={numero}
          onCerrar={() => {
            setQrAbierto(false);
            refrescar();
          }}
        />
      )}
    </div>
  );
}

interface QrProps {
  empresa: Empresa;
  estado: EstadoLinea | null;
  numero: string | null;
  onCerrar: () => void;
}

/** El QR para vincular el teléfono. La imagen se vuelve a pedir sola: el código caduca cada 20 s. */
function DialogoQr({ empresa: o, estado, numero, onCerrar }: QrProps) {
  const [sello, setSello] = useState(() => Date.now());
  const [cargado, setCargado] = useState(false);
  const conectado = estado === 'CONNECTED';

  useEffect(() => {
    if (conectado) return;
    const t = setInterval(() => setSello(Date.now()), 4_000);
    return () => clearInterval(t);
  }, [conectado]);

  useEffect(() => {
    if (conectado) toast.success(`WhatsApp de ${o.name} conectado`);
  }, [conectado, o.name]);

  return (
    <Dialog
      open
      onOpenChange={(a) => !a && onCerrar()}
      title={`WhatsApp de ${o.name}`}
      className="max-w-lg"
      footer={<Button onClick={onCerrar}>{conectado ? 'Listo' : 'Cerrar'}</Button>}
    >
      {conectado ? (
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success-soft text-success">
            <Check className="size-6" aria-hidden />
          </span>
          <p>
            Conectado{numero && <> como <strong className="font-semibold">+{numero}</strong></>}. Desde ahora, lo que le
            escriban a ese número lo atiende el bot, solo con documentos de esta empresa.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          {/* Fondo blanco fijo: un QR sobre oscuro no lo lee la cámara. */}
          <div className="grid size-56 shrink-0 place-items-center rounded-xl bg-white p-2.5">
            <img
              src={`/panel/api/empresas/whatsapp/qr?id=${encodeURIComponent(o.id)}&t=${sello}`}
              alt="Código QR para vincular WhatsApp"
              className={cargado ? 'size-full' : 'invisible size-full'}
              onLoad={() => setCargado(true)}
              onError={() => setCargado(false)}
            />
          </div>
          <div className="text-[13px]">
            <ol className="list-decimal space-y-1.5 pl-4 text-muted-foreground">
              <li>
                En el teléfono de la empresa, abre <strong className="font-medium text-foreground">WhatsApp</strong>.
              </li>
              <li>
                Ve a <em>Ajustes → Dispositivos vinculados → Vincular un dispositivo</em>.
              </li>
              <li>Escanea este código. Se renueva solo.</li>
            </ol>
            <p role="status" className="mt-3 font-medium">
              {estado === 'WAITING_QR'
                ? 'Esperando el escaneo…'
                : estado === 'DISCONNECTED'
                  ? 'El teléfono rechazó o cerró la vinculación. Vuelve a intentarlo.'
                  : 'Preparando el código…'}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              El teléfono sigue funcionando normal. Si la empresa desvincula el dispositivo, el bot deja de contestar por
              ese número hasta volver a conectarlo.
            </p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
