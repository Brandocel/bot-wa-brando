import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CLAVE_RESUMEN } from '@/app/layout/resumen';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { api } from '@/lib/api';
import { dinero, fecha, numeroBonito } from '@/lib/format';
import { useAlcance, useConfigFacturacion, usePuedeGestionar, type EstadoFactura, type Factura } from './api';

type Estado = 'pendientes' | 'timbradas' | 'cerradas';

const ESTADOS: ReadonlyArray<{ value: Estado; label: string }> = [
  { value: 'pendientes', label: 'Por aprobar' },
  { value: 'timbradas', label: 'Timbradas' },
  { value: 'cerradas', label: 'Rechazadas y canceladas' },
];

const ESTADO_FACTURA: Record<EstadoFactura, { texto: string; tono: Tone }> = {
  POR_APROBAR: { texto: 'Por aprobar', tono: 'warning' },
  TIMBRANDO: { texto: 'Timbrando', tono: 'warning' },
  TIMBRADA: { texto: 'Timbrada', tono: 'success' },
  ERROR: { texto: 'Con error', tono: 'danger' },
  RECHAZADA: { texto: 'Rechazada', tono: 'neutral' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutral' },
};

const FORMAS_PAGO: Record<string, string> = {
  '01': 'Efectivo',
  '02': 'Cheque',
  '03': 'Transferencia',
  '04': 'Tarjeta de crédito',
  '05': 'Monedero electrónico',
  '06': 'Dinero electrónico',
  '08': 'Vales de despensa',
  '28': 'Tarjeta de débito',
  '29': 'Tarjeta de servicios',
  '99': 'Por definir',
};

const MOTIVOS_CANCELACION: ReadonlyArray<[string, string]> = [
  ['02', '02 · Con errores, sin relación'],
  ['01', '01 · Con errores, la sustituye otra'],
  ['03', '03 · No se llevó a cabo la operación'],
  ['04', '04 · Va en una factura global'],
];

export function Facturas({ empresaId }: { empresaId: string }) {
  const { params } = useAlcance(empresaId);
  const [estado, setEstado] = useState<Estado>('pendientes');
  const config = useConfigFacturacion(empresaId);
  const facturas = useQuery({
    queryKey: ['facturas', empresaId, 'lista', estado],
    queryFn: () => api.get<Factura[]>('facturas', { ...params, estado }),
    refetchInterval: 20_000,
  });

  return (
    <>
      {config.data && !config.data.enabled ? (
        <Callout tone="warning" className="mb-4">
          La facturación está apagada: el bot no arma facturas. Actívala en la pestaña Facturación.
        </Callout>
      ) : (
        config.data?.sandbox && (
          <Callout tone="info" className="mb-4">
            Modo prueba (sandbox): lo que se timbra aquí <strong>no</strong> tiene validez fiscal.
          </Callout>
        )
      )}
      <Segmented label="Qué facturas ver" value={estado} onChange={setEstado} options={ESTADOS} className="mb-4" />

      {facturas.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Cargando">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : facturas.isError ? (
        <ErrorState error={facturas.error} onRetry={() => facturas.refetch()} />
      ) : facturas.data.length === 0 ? (
        <EmptyState icon={ReceiptText} title={estado === 'pendientes' ? 'No hay facturas por aprobar' : 'Nada por aquí'} />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {facturas.data.map((f) => (
            <TarjetaFactura key={f.id} factura={f} empresaId={empresaId} />
          ))}
        </div>
      )}
    </>
  );
}

interface Accion {
  ruta: 'aprobar' | 'rechazar' | 'liberar' | 'reenviar' | 'cancelar';
  extra?: object;
  ok: string | ((r: Respuesta) => string);
}

interface Respuesta {
  status?: string;
  estado?: string;
  error?: string | null;
}

/** Lo que se pregunta antes de una acción que no tiene vuelta atrás. */
const CONFIRMACION: Partial<Record<Accion['ruta'], { titulo: string; texto: string; boton: string; peligro?: boolean }>> = {
  aprobar: { titulo: '¿Timbrar esta factura?', texto: 'Ya timbrada, solo se puede cancelar ante el SAT.', boton: 'Timbrar' },
  rechazar: {
    titulo: '¿Rechazar esta factura?',
    texto: 'Se le avisa al cliente con el motivo que escribiste.',
    boton: 'Rechazar',
    peligro: true,
  },
  liberar: {
    titulo: '¿Confirmas que NO aparece timbrada?',
    texto: 'Revísalo en Factura.com. Si sí aparece, reintentar la duplicaría.',
    boton: 'No se timbró',
  },
  cancelar: { titulo: '¿Cancelar esta factura ante el SAT?', texto: 'No se puede deshacer.', boton: 'Cancelar factura', peligro: true },
};

function TarjetaFactura({ factura: f, empresaId }: { factura: Factura; empresaId: string }) {
  const { cuerpo } = useAlcance(empresaId);
  const puedeGestionar = usePuedeGestionar();
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [motivoSat, setMotivoSat] = useState('02');
  const [sustituto, setSustituto] = useState('');
  const [porConfirmar, setPorConfirmar] = useState<Accion | null>(null);

  const accion = useMutation({
    mutationFn: (a: Accion) => api.post<Respuesta>(`facturas/${a.ruta}`, { ...cuerpo, id: f.id, ...a.extra }),
    onSuccess: (r, a) => {
      toast.success(typeof a.ok === 'function' ? a.ok(r) : a.ok);
      void queryClient.invalidateQueries({ queryKey: ['facturas', empresaId, 'lista'] });
      void queryClient.invalidateQueries({ queryKey: ['pendientes'] });
      void queryClient.invalidateQueries({ queryKey: CLAVE_RESUMEN });
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setPorConfirmar(null),
  });

  /** Lo irreversible pregunta primero; lo demás se manda directo. */
  const pedir = (a: Accion) => (CONFIRMACION[a.ruta] ? setPorConfirmar(a) : accion.mutate(a));

  const estado = ESTADO_FACTURA[f.status] ?? { texto: f.status, tono: 'neutral' as const };
  const r = f.receptor ?? {};
  const confirmacion = porConfirmar && CONFIRMACION[porConfirmar.ruta];

  return (
    <Card className="flex flex-col gap-3 p-5">
      <header className="flex flex-wrap items-center gap-2">
        <strong className="font-mono text-[15px]">{f.serie || f.folio ? `${f.serie ?? ''}${f.folio ?? ''}` : 'Factura'}</strong>
        <Badge tone={estado.tono}>{estado.texto}</Badge>
        {f.sandbox && <Badge>Prueba</Badge>}
        {f.order && <Badge>P-{f.order.number}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{fecha(f.stampedAt ?? f.createdAt)}</span>
      </header>

      <div>
        <p className="font-medium">
          {r.nombre} <span className="font-mono text-xs font-normal text-muted-foreground">{r.rfc}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          CP {r.codigoPostal} · Régimen {r.regimen} · Uso {r.usoCfdi} · {FORMAS_PAGO[f.formaPago] ?? f.formaPago}
          {r.email && ` · ${r.email}`}
        </p>
        <p className="text-xs text-muted-foreground">Pidió: {f.contact?.displayName || numeroBonito(f.contact?.waId)}</p>
      </div>

      {!!f.concepts?.length && (
        <ul className="divide-y border-y text-[13px]">
          {f.concepts.map((c, n) => (
            <li key={n} className="flex justify-between gap-3 py-1.5">
              <span>
                {c.Cantidad} × {c.Descripcion} <span className="font-mono text-xs text-muted-foreground">{c.ClaveProdServ}</span>
              </span>
              <span className="shrink-0 tabular-nums">{dinero(Math.round(c.ValorUnitario * c.Cantidad * 100))}</span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="text-xs text-muted-foreground">
          Subtotal {dinero(f.subtotalCents)} · IVA {dinero(f.ivaCents)}
        </p>
        <p className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Total</span>
          <strong className="text-lg font-semibold tabular-nums">{dinero(f.totalCents)}</strong>
        </p>
      </div>

      {f.uuid && <p className="font-mono text-xs break-all text-muted-foreground">UUID {f.uuid}</p>}
      {f.error && <Callout tone="danger">{f.error}</Callout>}
      {f.rejectReason && <p className="text-xs text-muted-foreground">Rechazada: {f.rejectReason}</p>}

      {puedeGestionar && (f.status === 'POR_APROBAR' || f.status === 'ERROR') && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <Button
            className="self-start"
            disabled={accion.isPending}
            onClick={() =>
              pedir({
                ruta: 'aprobar',
                ok: (x) =>
                  x.status === 'TIMBRADA' ? 'Factura timbrada y enviada al cliente' : `No se timbró: ${x.error ?? 'revisa el detalle'}`,
              })
            }
          >
            {f.status === 'ERROR' ? 'Reintentar timbrado' : 'Aprobar y timbrar'}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo si la rechazas"
              aria-label="Motivo del rechazo"
              className="min-w-40 flex-1"
            />
            <Button
              variant="danger-soft"
              disabled={accion.isPending}
              onClick={() => pedir({ ruta: 'rechazar', extra: { motivo }, ok: 'Factura rechazada; el cliente ya lo sabe' })}
            >
              Rechazar
            </Button>
          </div>
        </div>
      )}

      {puedeGestionar && f.status === 'TIMBRANDO' && f.error && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <p className="text-[13px] text-muted-foreground">Factura.com no contestó. Búscala en su panel antes de hacer nada.</p>
          <Button variant="secondary" disabled={accion.isPending} onClick={() => pedir({ ruta: 'liberar', ok: 'Lista para reintentar' })}>
            Ya revisé: no se timbró
          </Button>
        </div>
      )}

      {puedeGestionar && f.status === 'TIMBRADA' && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <Button
            variant="secondary"
            className="self-start"
            loading={accion.isPending && accion.variables.ruta === 'reenviar'}
            disabled={accion.isPending}
            onClick={() => pedir({ ruta: 'reenviar', ok: 'Reenviada al cliente' })}
          >
            Reenviar al cliente
          </Button>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Motivo de cancelación" className="min-w-56 flex-1" value={motivoSat} onChange={(e) => setMotivoSat(e.target.value)}>
              {MOTIVOS_CANCELACION.map(([clave, texto]) => (
                <option key={clave} value={clave}>
                  {texto}
                </option>
              ))}
            </Select>
            {motivoSat === '01' && (
              <Input
                value={sustituto}
                onChange={(e) => setSustituto(e.target.value)}
                placeholder="UUID que la sustituye"
                aria-label="UUID que la sustituye"
                className="min-w-56 flex-1"
              />
            )}
            <Button
              variant="danger-soft"
              disabled={accion.isPending}
              onClick={() =>
                pedir({
                  ruta: 'cancelar',
                  extra: { motivo: motivoSat, sustituto },
                  ok: (x) =>
                    x.estado === 'cancelada' ? 'Factura cancelada' : 'Cancelación en proceso: el receptor tiene que aceptarla',
                })
              }
            >
              Cancelar en el SAT
            </Button>
          </div>
        </div>
      )}

      {confirmacion && porConfirmar && (
        <ConfirmDialog
          open
          onOpenChange={(abierto) => !abierto && setPorConfirmar(null)}
          title={confirmacion.titulo}
          description={confirmacion.texto}
          confirmLabel={confirmacion.boton}
          variant={confirmacion.peligro ? 'danger' : 'primary'}
          loading={accion.isPending}
          onConfirm={() => accion.mutate(porConfirmar)}
        />
      )}
    </Card>
  );
}
