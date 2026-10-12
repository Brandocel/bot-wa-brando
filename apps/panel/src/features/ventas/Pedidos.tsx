import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CLAVE_RESUMEN } from '@/app/layout/resumen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { TextoWhatsApp } from '@/features/conversaciones/Mensajes';
import { api } from '@/lib/api';
import { dinero, fecha, numeroBonito } from '@/lib/format';
import { useAlcance, useConfigVentas, type Pedido } from './api';
import { ESTADO_PEDIDO, nombreEntrega } from './catalogos';

type Estado = 'activos' | 'armando' | 'cerrados';

const ESTADOS: ReadonlyArray<{ value: Estado; label: string }> = [
  { value: 'activos', label: 'Por atender' },
  { value: 'armando', label: 'En conversación' },
  { value: 'cerrados', label: 'Cerrados' },
];

export function Pedidos({ empresaId }: { empresaId: string }) {
  const { params } = useAlcance(empresaId);
  const [estado, setEstado] = useState<Estado>('activos');
  const config = useConfigVentas(empresaId);
  const pedidos = useQuery({
    queryKey: ['ventas', empresaId, 'pedidos', estado],
    queryFn: () => api.get<Pedido[]>('ventas/pedidos', { ...params, estado }),
    refetchInterval: 20_000,
  });

  return (
    <>
      {config.data && !config.data.enabled && (
        <Callout tone="warning" className="mb-4">
          Las ventas están apagadas: el bot no está tomando pedidos. Actívalas en Configuración.
        </Callout>
      )}
      <Segmented label="Qué pedidos ver" value={estado} onChange={setEstado} options={ESTADOS} className="mb-4" />

      {pedidos.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Cargando">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      ) : pedidos.isError ? (
        <ErrorState error={pedidos.error} onRetry={() => pedidos.refetch()} />
      ) : pedidos.data.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={estado === 'activos' ? 'No hay pedidos por atender' : 'Nada por aquí'} />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {pedidos.data.map((o) => (
            <TarjetaPedido key={o.id} pedido={o} empresaId={empresaId} minutosPorOmision={config.data?.prepMinutes ?? 30} />
          ))}
        </div>
      )}
    </>
  );
}

function Score({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;
  return (
    <Badge tone={score >= 70 ? 'success' : score >= 40 ? 'warning' : 'neutral'} title="Probabilidad de que termine en compra">
      {score}% compra
    </Badge>
  );
}

interface TarjetaProps {
  pedido: Pedido;
  empresaId: string;
  minutosPorOmision: number;
}

function TarjetaPedido({ pedido: o, empresaId, minutosPorOmision }: TarjetaProps) {
  const { cuerpo } = useAlcance(empresaId);
  const queryClient = useQueryClient();
  const [minutos, setMinutos] = useState(minutosPorOmision);
  const [motivo, setMotivo] = useState('');
  const [rechazando, setRechazando] = useState(false);

  const accion = useMutation({
    mutationFn: (a: { ruta: string; extra?: object; ok: string }) =>
      api.post(`ventas/pedidos/${a.ruta}`, { ...cuerpo, id: o.id, ...a.extra }),
    onSuccess: (_, a) => {
      toast.success(a.ok);
      setRechazando(false);
      void queryClient.invalidateQueries({ queryKey: ['ventas', empresaId, 'pedidos'] });
      void queryClient.invalidateQueries({ queryKey: ['pendientes'] });
      void queryClient.invalidateQueries({ queryKey: CLAVE_RESUMEN });
    },
    onError: (err) => {
      setRechazando(false);
      toast.error(err.message);
    },
  });

  const estado = ESTADO_PEDIDO[o.status] ?? { texto: o.status, tono: 'neutral' as const };
  const cliente = o.customerName || o.contact?.displayName || numeroBonito(o.contact?.waId);
  const cuando = o.etaAt
    ? `Listo para ${fecha(o.etaAt)}`
    : o.scheduledFor
      ? `Programado para ${fecha(o.scheduledFor)}`
      : 'Lo antes posible';

  return (
    <Card className="flex flex-col gap-3 p-5">
      <header className="flex flex-wrap items-center gap-2">
        <strong className="font-mono text-[15px]">P-{o.number}</strong>
        <Badge tone={estado.tono}>{estado.texto}</Badge>
        <Score score={o.buyingScore} />
        <span className="ml-auto text-xs text-muted-foreground">{fecha(o.submittedAt ?? o.updatedAt)}</span>
      </header>

      <p className="font-medium">
        {cliente} <span className="font-mono text-xs font-normal text-muted-foreground">{numeroBonito(o.contact?.waId)}</span>
      </p>

      {o.items?.length ? (
        <ul className="divide-y border-y text-[13px]">
          {o.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-3 py-1.5">
              <span>
                {i.cantidad} × {i.nombre} {i.nota && <span className="text-muted-foreground">({i.nota})</span>}
              </span>
              <span className="shrink-0 tabular-nums">{dinero(i.precioCents * i.cantidad)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">Aún sin productos.</p>
      )}

      <div>
        {o.deliveryCents > 0 && <p className="text-xs text-muted-foreground">Envío {dinero(o.deliveryCents)}</p>}
        <p className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Total</span>
          <strong className="text-lg font-semibold tabular-nums">{dinero(o.totalCents)}</strong>
        </p>
      </div>

      <p className="text-xs break-words text-muted-foreground">
        {nombreEntrega(o.deliveryMode)}
        {o.address && (
          <>
            : <TextoWhatsApp texto={o.address} />
          </>
        )}
        {o.zone && ` (${o.zone})`} · {cuando}
        {o.notes && ` · Nota: ${o.notes}`}
      </p>
      {o.rejectReason && <p className="text-xs text-muted-foreground">Rechazado: {o.rejectReason}</p>}

      {o.status === 'POR_ACEPTAR' && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {!o.scheduledFor && (
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
              loading={accion.isPending && accion.variables.ruta === 'aceptar'}
              disabled={accion.isPending}
              onClick={() =>
                accion.mutate({
                  ruta: 'aceptar',
                  extra: { minutos: o.scheduledFor ? 0 : minutos },
                  ok: 'Pedido aceptado: ya le avisé al cliente',
                })
              }
            >
              Aceptar
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo si lo rechazas"
              aria-label="Motivo del rechazo"
              className="min-w-40 flex-1"
            />
            <Button variant="danger-soft" disabled={accion.isPending} onClick={() => setRechazando(true)}>
              Rechazar
            </Button>
          </div>
        </div>
      )}

      {o.status === 'ACEPTADO' && (
        <Button
          variant="secondary"
          className="self-start"
          loading={accion.isPending}
          onClick={() => accion.mutate({ ruta: 'entregado', ok: 'Marcado como entregado' })}
        >
          Marcar entregado
        </Button>
      )}

      <ConfirmDialog
        open={rechazando}
        onOpenChange={setRechazando}
        title="¿Rechazar este pedido?"
        description="Se le avisa al cliente con el motivo que escribiste."
        confirmLabel="Rechazar"
        variant="danger"
        loading={accion.isPending}
        onConfirm={() => accion.mutate({ ruta: 'rechazar', extra: { motivo }, ok: 'Pedido rechazado; el cliente ya lo sabe' })}
      />
    </Card>
  );
}
