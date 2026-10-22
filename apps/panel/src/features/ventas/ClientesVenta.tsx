import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { dinero, fecha, hace, numeroBonito } from '@/lib/format';
import { useAlcance, usePuedeGestionar } from './api';
import { nombreEntrega } from './catalogos';

type Segmento =
  | 'NUEVO' | 'PROSPECTO_CALIENTE' | 'PROSPECTO' | 'PROSPECTO_FRIO' | 'PRIMERA_COMPRA' | 'VIP' | 'LEAL'
  | 'PROMETEDOR' | 'OCASIONAL' | 'EN_RIESGO' | 'HIBERNANDO' | 'PERDIDO' | 'NECESITA_ATENCION';
type Filtro = 'todos' | 'seguimientos' | Segmento;

interface Perfil {
  contactId: string;
  nombre: string | null;
  primerContactoAt: string;
  ultimoContactoAt: string;
  ultimoPedidoAt: string | null;
  pedidos: number;
  gastoCents: number;
  ticketPromedioCents: number;
  frecuenciaDias: number | null;
  entregaPreferida: string | null;
  zonaPreferida: string | null;
  direccionHabitual: string | null;
  horaHabitual: number | null;
  diasHabituales: string[];
  ultimoScore: number | null;
  sentimiento: number | null;
  tendencia: string | null;
  emocionDominante: string | null;
  puntaje: number;
  segmento: Segmento;
  rfm: string | null;
  proximaAccion: string | null;
  proximaAccionAt: string | null;
  notas: string | null;
  contact: { id: string; waId: string; displayName: string | null };
}

interface Lista {
  segmentos: Partial<Record<Segmento, number>>;
  seguimientos: number;
  clientes: Array<Perfil & { favoritos: Array<{ producto: string; veces: number }> }>;
}

interface Detalle {
  perfil: Perfil;
  preferencias: Array<{ producto: string; veces: number; unidades: number; notas: string[]; ultimaVez: string }>;
  eventos: Array<{ id: string; tipo: string; detalle: Record<string, unknown>; createdAt: string }>;
}

/** Del que más atención pide al más frío; es el orden de los filtros. */
const SEGMENTO: Record<Segmento, { texto: string; tono: Tone }> = {
  NECESITA_ATENCION: { texto: 'Atender', tono: 'danger' },
  VIP: { texto: 'VIP', tono: 'success' },
  LEAL: { texto: 'Leal', tono: 'success' },
  PROMETEDOR: { texto: 'Prometedor', tono: 'primary' },
  PRIMERA_COMPRA: { texto: 'Primera compra', tono: 'primary' },
  PROSPECTO_CALIENTE: { texto: 'Caliente', tono: 'warning' },
  PROSPECTO: { texto: 'Prospecto', tono: 'neutral' },
  OCASIONAL: { texto: 'Ocasional', tono: 'neutral' },
  EN_RIESGO: { texto: 'En riesgo', tono: 'warning' },
  HIBERNANDO: { texto: 'Hibernando', tono: 'neutral' },
  PROSPECTO_FRIO: { texto: 'Frío', tono: 'neutral' },
  NUEVO: { texto: 'Nuevo', tono: 'neutral' },
  PERDIDO: { texto: 'Perdido', tono: 'danger' },
};

const EVENTO: Record<string, string> = {
  primer_contacto: 'Primer mensaje',
  pedido_armando: 'Empezó un pedido',
  pedido_confirmado: 'Confirmó el pedido',
  pedido_aceptado: 'Pedido aceptado',
  pedido_rechazado: 'Pedido rechazado',
  pedido_entregado: 'Pedido entregado',
  pedido_cancelado: 'Canceló',
  reclamo: 'Reclamo',
  pidio_persona: 'Pidió hablar con alguien',
};

const DIAS: Record<string, string> = { lun: 'lun', mar: 'mar', mie: 'mié', jue: 'jue', vie: 'vie', sab: 'sáb', dom: 'dom' };
const TENDENCIA: Record<string, string> = { mejora: '↗ mejora', empeora: '↘ empeora', estable: '→ estable' };

const quien = (p: Perfil) => p.nombre || p.contact.displayName || numeroBonito(p.contact.waId);

/** Los clientes de venta: segmento, clima, qué le gusta, qué sigue y todo lo que ha pasado. */
export function ClientesVenta({ empresaId }: { empresaId: string }) {
  const { params } = useAlcance(empresaId);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [abierto, setAbierto] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['ventas', empresaId, 'clientes', filtro],
    queryFn: () => api.get<Lista>('ventas/clientes', { ...params, vista: filtro }),
    refetchInterval: 30_000,
  });

  const conteo = lista.data?.segmentos ?? {};
  const total = Object.values(conteo).reduce((n, c) => n + (c ?? 0), 0);
  const opciones: Array<{ value: Filtro; label: string }> = [
    { value: 'todos', label: `Todos ${total || ''}`.trim() },
    ...(lista.data?.seguimientos ? [{ value: 'seguimientos' as Filtro, label: `Seguimientos ${lista.data.seguimientos}` }] : []),
    ...(Object.keys(SEGMENTO) as Segmento[])
      .filter((e) => conteo[e])
      .map((e) => ({ value: e as Filtro, label: `${SEGMENTO[e].texto} ${conteo[e]}` })),
  ];

  return (
    <>
      <Segmented label="Segmento del cliente" value={filtro} onChange={setFiltro} options={opciones} className="mb-4" />

      {lista.isPending ? (
        <div className="grid gap-3" role="status" aria-label="Cargando">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : lista.isError ? (
        <ErrorState error={lista.error} onRetry={() => lista.refetch()} />
      ) : lista.data.clientes.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtro === 'seguimientos' ? 'Nada pendiente' : 'Todavía no hay clientes'}
          description={filtro === 'seguimientos' ? undefined : 'Se suman solos cuando alguien le escribe al bot para comprar.'}
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-surface shadow-xs">
          {lista.data.clientes.map((c) => (
            <li key={c.contactId}>
              <button
                type="button"
                onClick={() => setAbierto(c.contactId)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
              >
                <Avatar name={quien(c)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{quien(c)}</span>
                    <Badge tone={SEGMENTO[c.segmento].tono}>{SEGMENTO[c.segmento].texto}</Badge>
                    <Clima valor={c.sentimiento} />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {filtro === 'seguimientos' && c.proximaAccion
                      ? `${c.proximaAccion} · ${fecha(c.proximaAccionAt)}`
                      : c.favoritos.length
                        ? c.favoritos.map((f) => f.producto).join(' · ')
                        : 'Sin pedidos todavía'}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  <span className="block font-semibold tabular-nums text-foreground">{c.puntaje}</span>
                  {c.pedidos > 0 ? dinero(c.gastoCents) : hace(c.ultimoContactoAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {abierto && <FichaCliente empresaId={empresaId} contactId={abierto} onCerrar={() => setAbierto(null)} />}
    </>
  );
}

function FichaCliente({ empresaId, contactId, onCerrar }: { empresaId: string; contactId: string; onCerrar: () => void }) {
  const { params, cuerpo } = useAlcance(empresaId);
  const puede = usePuedeGestionar();
  const queryClient = useQueryClient();
  const clave = ['ventas', empresaId, 'cliente', contactId];
  const ficha = useQuery({ queryKey: clave, queryFn: () => api.get<Detalle>('ventas/cliente', { ...params, contacto: contactId }) });
  const [notas, setNotas] = useState('');
  useEffect(() => setNotas(ficha.data?.perfil.notas ?? ''), [ficha.data?.perfil.notas]);

  const guardar = useMutation({
    mutationFn: () => api.post('ventas/cliente/notas', { ...cuerpo, contacto: contactId, notas }),
    onSuccess: () => {
      toast.success('Notas guardadas');
      void queryClient.invalidateQueries({ queryKey: clave });
    },
    onError: (err) => toast.error(err.message),
  });

  const p = ficha.data?.perfil;
  return (
    <Sheet open onOpenChange={(a) => !a && onCerrar()} title={p ? quien(p) : 'Cliente'}>
      {ficha.isPending ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : ficha.isError ? (
        <ErrorState error={ficha.error} onRetry={() => ficha.refetch()} />
      ) : (
        p && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Badge tone={SEGMENTO[p.segmento].tono}>{SEGMENTO[p.segmento].texto}</Badge>
              <span className="font-semibold tabular-nums">{p.puntaje}/100</span>
              {p.rfm && <span className="font-mono text-xs text-muted-foreground">{p.rfm}</span>}
              <span className="ml-auto font-mono text-muted-foreground">{numeroBonito(p.contact.waId)}</span>
            </div>

            {p.proximaAccion && (
              <div className="rounded-lg border bg-primary-soft px-3 py-2 text-sm">
                <span className="block text-xs text-muted-foreground">Siguiente paso · {fecha(p.proximaAccionAt)}</span>
                <span className="font-medium">{p.proximaAccion}</span>
              </div>
            )}

            <dl className="grid grid-cols-3 gap-3">
              <Dato titulo="Pedidos" valor={String(p.pedidos)} />
              <Dato titulo="Gastado" valor={dinero(p.gastoCents)} />
              <Dato titulo="Ticket" valor={p.pedidos ? dinero(p.ticketPromedioCents) : '—'} />
            </dl>

            <Seccion titulo="Cómo se siente">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Clima valor={p.sentimiento} conTexto />
                {p.tendencia && <Badge>{TENDENCIA[p.tendencia] ?? p.tendencia}</Badge>}
                {p.emocionDominante && <Badge>suele estar {p.emocionDominante.replace('_', ' ')}</Badge>}
                {p.ultimoScore !== null && <Badge tone="primary">compra {p.ultimoScore}%</Badge>}
              </div>
            </Seccion>

            <Seccion titulo="Lo que le gusta">
              {ficha.data.preferencias.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Aún no ha pedido nada.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {ficha.data.preferencias.map((f) => (
                    <li key={f.producto} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{f.producto}</span>
                        {f.notas.length > 0 && <span className="block text-xs text-muted-foreground">{f.notas.join(' · ')}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {f.veces} de {p.pedidos} · {f.unidades} pzs
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>

            {(p.entregaPreferida || p.diasHabituales.length > 0 || p.frecuenciaDias) && (
              <Seccion titulo="Hábitos">
                <div className="flex flex-wrap gap-2 text-[13px]">
                  {p.entregaPreferida && (
                    <Badge>
                      {nombreEntrega(p.entregaPreferida)}
                      {p.zonaPreferida ? ` · ${p.zonaPreferida}` : ''}
                    </Badge>
                  )}
                  {p.diasHabituales.length > 0 && <Badge>{p.diasHabituales.map((d) => DIAS[d] ?? d).join(', ')}</Badge>}
                  {p.horaHabitual !== null && <Badge>~{p.horaHabitual}:00</Badge>}
                  {p.frecuenciaDias && <Badge>cada {p.frecuenciaDias} días</Badge>}
                </div>
                {p.direccionHabitual && <p className="mt-2 text-xs text-muted-foreground">{p.direccionHabitual}</p>}
              </Seccion>
            )}

            <Seccion titulo="Notas del equipo">
              <Textarea
                aria-label="Notas del equipo"
                rows={3}
                value={notas}
                disabled={!puede}
                placeholder="Lo que conviene recordar de este cliente"
                onChange={(e) => setNotas(e.target.value)}
              />
              {puede && notas !== (p.notas ?? '') && (
                <Button size="sm" className="mt-2" loading={guardar.isPending} onClick={() => guardar.mutate()}>
                  Guardar
                </Button>
              )}
            </Seccion>

            <Seccion titulo="Trayectoria">
              <ol className="relative flex flex-col gap-3 border-l pl-4">
                {ficha.data.eventos.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                    <span className="font-medium">{EVENTO[e.tipo] ?? e.tipo}</span>
                    {detalleEvento(e.detalle) && <span className="block text-xs text-muted-foreground">{detalleEvento(e.detalle)}</span>}
                    <span className="block text-[11px] text-muted-foreground">{fecha(e.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </Seccion>
          </div>
        )
      )}
    </Sheet>
  );
}

function detalleEvento(d: Record<string, unknown>): string {
  const partes: string[] = [];
  if (typeof d.numero === 'number') partes.push(`P-${d.numero}`);
  if (Array.isArray(d.lleva) && d.lleva.length) partes.push(d.lleva.join(', '));
  if (typeof d.totalCents === 'number') partes.push(dinero(d.totalCents));
  if (typeof d.motivo === 'string') partes.push(d.motivo);
  if (typeof d.texto === 'string') partes.push(`“${d.texto}”`);
  return partes.join(' · ');
}

/** Un punto de color con el clima: verde bien, ámbar neutral, rojo tenso. */
function Clima({ valor, conTexto = false }: { valor: number | null; conTexto?: boolean }) {
  if (valor === null) return conTexto ? <span className="text-muted-foreground">Sin lecturas todavía</span> : null;
  const [color, texto] = valor >= 40 ? ['bg-success', 'Buena onda'] : valor <= -30 ? ['bg-danger', 'Tenso'] : ['bg-warning', 'Neutral'];
  return (
    <span className="inline-flex items-center gap-1.5" title={`Clima ${valor}`}>
      <span className={`size-2 rounded-full ${color}`} aria-hidden />
      {conTexto ? <span>{texto}</span> : <span className="sr-only">{texto}</span>}
    </span>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-surface px-3 py-2">
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className="text-base font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{titulo}</h3>
      {children}
    </section>
  );
}
