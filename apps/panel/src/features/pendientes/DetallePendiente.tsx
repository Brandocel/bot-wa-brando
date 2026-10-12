import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { useUsuario } from '@/features/auth/sesion';
import { TextoWhatsApp } from '@/features/conversaciones/Mensajes';
import { nombreEntrega } from '@/features/ventas/catalogos';
import { api } from '@/lib/api';
import { dinero, fecha, hace } from '@/lib/format';
import { TIPO, useRefrescarPendientes, type Pendiente } from './api';

/** Qué hacer con un pendiente: su contexto y las acciones que lo resuelven. */
export function DetallePendiente({ item }: { item: Pendiente }) {
  const tipo = TIPO[item.tipo];
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <Avatar name={item.quien} size="lg" />
        <div className="min-w-0">
          <Badge tone={item.urgente ? 'danger' : tipo.tono}>
            {tipo.texto}
            {item.urgente && ' · urgente'}
          </Badge>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight">{item.titulo}</h2>
          <p className="text-[13px] text-muted-foreground">
            {item.empresa} · {hace(item.desde)}
          </p>
        </div>
      </header>

      {item.detalle && (
        <p className="rounded-lg border bg-background px-4 py-3 break-words whitespace-pre-wrap">
          <TextoWhatsApp texto={item.detalle} />
        </p>
      )}

      {/* La clave reinicia minutos y motivo al cambiar de pendiente. */}
      <Acciones key={item.id} item={item} />
    </div>
  );
}

function Total({ cents }: { cents: number }) {
  return (
    <p className="flex items-baseline justify-between border-y py-3">
      <span className="text-muted-foreground">Total</span>
      <strong className="text-xl font-semibold tabular-nums">{dinero(cents)}</strong>
    </p>
  );
}

function Acciones({ item }: { item: Pendiente }) {
  const usuario = useUsuario();
  const navigate = useNavigate();
  const refrescar = useRefrescarPendientes();
  const campoMotivo = useRef<HTMLInputElement>(null);
  const [minutos, setMinutos] = useState(Number(item.ref.minutos ?? 30));
  const [motivo, setMotivo] = useState('');

  const ref = item.ref;
  // Una empresa actúa siempre sobre la suya; el equipo dice sobre cuál.
  const org = usuario.role === 'EMPRESA' ? {} : { organizationId: item.organizationId };
  const abrirChat = () => navigate(`/conversaciones?chat=${encodeURIComponent(String(ref.chatId))}`);

  const accion = useMutation({
    mutationFn: (a: { ruta: string; cuerpo: object; ok: string | ((r: Respuesta) => string); luego?: () => void }) =>
      api.post<Respuesta>(a.ruta, a.cuerpo),
    onSuccess: (r, a) => {
      toast.success(typeof a.ok === 'function' ? a.ok(r) : a.ok);
      refrescar();
      a.luego?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const boton = (ruta: string) => ({
    loading: accion.isPending && accion.variables.ruta === ruta,
    disabled: accion.isPending,
  });

  /** Rechazar siempre lleva motivo: es lo que se le dice al cliente. */
  function rechazar(ruta: string, id: unknown, ok: string) {
    if (motivo.trim().length < 3) {
      campoMotivo.current?.focus();
      return toast.error('Escribe el motivo: se le dice al cliente');
    }
    accion.mutate({ ruta, cuerpo: { ...org, id, motivo: motivo.trim() }, ok });
  }

  const campoRechazo = (ruta: string, id: unknown, ok: string, placeholder: string): ReactNode => (
    <div className="flex flex-wrap gap-2">
      <Input
        ref={campoMotivo}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder={placeholder}
        aria-label="Motivo del rechazo"
        className="min-w-48 flex-1"
      />
      <Button variant="danger-soft" {...boton(ruta)} onClick={() => rechazar(ruta, id, ok)}>
        Rechazar
      </Button>
    </div>
  );

  if (item.tipo === 'persona' || item.tipo === 'sin_responder') {
    // Las conversaciones son del equipo: una empresa no las abre desde aquí.
    if (usuario.role === 'EMPRESA') return null;
    return (
      <>
        {ref.ticket && <p className="text-[13px] text-muted-foreground">Ticket #{ref.ticket}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={abrirChat}>Abrir el chat</Button>
          {item.tipo === 'persona' && (
            <Button
              variant="secondary"
              {...boton('conversacion/atender')}
              onClick={() =>
                accion.mutate({
                  ruta: 'conversacion/atender',
                  cuerpo: { chatId: ref.chatId, activo: true },
                  ok: 'Lo atiendes tú: el bot se calla en ese chat',
                  luego: abrirChat,
                })
              }
            >
              Atender yo
            </Button>
          )}
          {ref.ticketId && (
            <Button
              variant="secondary"
              {...boton('ticket/cerrar')}
              onClick={() => accion.mutate({ ruta: 'ticket/cerrar', cuerpo: { id: ref.ticketId }, ok: 'Ticket resuelto' })}
            >
              Ya quedó resuelto
            </Button>
          )}
        </div>
      </>
    );
  }

  if (item.tipo === 'pedido') {
    return (
      <>
        <Total cents={Number(ref.totalCents)} />
        <p className="text-[13px] text-muted-foreground">
          {nombreEntrega(ref.entrega as string | null)}
          {ref.programado ? ` · para ${fecha(String(ref.programado))}` : ' · lo antes posible'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!ref.programado && (
            <label className="flex items-center gap-2 text-[13px]">
              Listo en
              <Input
                type="number"
                min={0}
                max={600}
                value={minutos}
                onChange={(e) => setMinutos(e.target.valueAsNumber || 0)}
                className="w-20"
              />
              min
            </label>
          )}
          <Button
            {...boton('ventas/pedidos/aceptar')}
            onClick={() =>
              accion.mutate({
                ruta: 'ventas/pedidos/aceptar',
                cuerpo: { ...org, id: ref.orderId, minutos: ref.programado ? 0 : minutos },
                ok: 'Pedido aceptado: ya le avisé al cliente',
              })
            }
          >
            Aceptar pedido
          </Button>
        </div>
        {campoRechazo(
          'ventas/pedidos/rechazar',
          ref.orderId,
          'Pedido rechazado; el cliente ya lo sabe',
          'Motivo si lo rechazas (se le dice al cliente)',
        )}
      </>
    );
  }

  if (item.tipo === 'factura') {
    const atorada = ref.status === 'TIMBRANDO';
    return (
      <>
        <Total cents={Number(ref.totalCents)} />
        {!!ref.sandbox && <p className="text-[13px] text-muted-foreground">Modo prueba: no tiene validez fiscal.</p>}
        {ref.error && <Callout tone="danger">{String(ref.error)}</Callout>}
        {atorada ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-muted-foreground">Factura.com no contestó. Búscala en su panel antes de reintentar.</p>
            <Button
              variant="secondary"
              {...boton('facturas/liberar')}
              onClick={() =>
                accion.mutate({ ruta: 'facturas/liberar', cuerpo: { ...org, id: ref.invoiceId }, ok: 'Lista para reintentar' })
              }
            >
              Ya revisé: no se timbró
            </Button>
          </div>
        ) : (
          <>
            <Button
              className="self-start"
              {...boton('facturas/aprobar')}
              onClick={() =>
                accion.mutate({
                  ruta: 'facturas/aprobar',
                  cuerpo: { ...org, id: ref.invoiceId },
                  ok: (f) =>
                    f.status === 'TIMBRADA'
                      ? 'Factura timbrada y enviada al cliente'
                      : `No se timbró: ${f.error ?? 'revisa el detalle'}`,
                })
              }
            >
              {ref.status === 'ERROR' ? 'Reintentar timbrado' : 'Aprobar y timbrar'}
            </Button>
            {campoRechazo(
              'facturas/rechazar',
              ref.invoiceId,
              'Factura rechazada; el cliente ya lo sabe',
              'Motivo si la rechazas (se le dice al cliente)',
            )}
          </>
        )}
      </>
    );
  }

  return (
    <Button className="self-start" onClick={() => navigate('/cuarentena')}>
      Revisar ahora
    </Button>
  );
}

interface Respuesta {
  status?: string;
  error?: string | null;
}
