import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/app/layout/PageHeader';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Callout, EmptyState, ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { dinero, fecha, plural } from '@/lib/format';

type Estado = 'PRUEBA' | 'PENDIENTE' | 'ACTIVA' | 'ATRASADA' | 'CANCELADA';

interface Resumen {
  disponible: boolean;
  totales: {
    pagando: number;
    enPrueba: number;
    atrasados: number;
    /** Centavos, sin IVA. */
    alMes: number;
    esteMes: { total: number; cobros: number };
    historico: { total: number; cobros: number };
  };
  cuentas: Array<{
    organizationId: string;
    nombre: string;
    estado: Estado;
    mesesPagados: number;
    pagado: number;
    ultimoCobroAt: string | null;
    siguiente: { subtotal: number; total: number };
    pruebaHasta: string | null;
  }>;
  ultimos: Array<{ id: string; nombre: string; total: number; mes: number; pagadoAt: string; reciboUrl: string | null }>;
}

const ESTADO: Record<Estado, { texto: string; tono: Tone }> = {
  PRUEBA: { texto: 'Mes gratis', tono: 'info' },
  PENDIENTE: { texto: 'Liga sin pagar', tono: 'warning' },
  ACTIVA: { texto: 'Pagando', tono: 'success' },
  ATRASADA: { texto: 'Pago rechazado', tono: 'danger' },
  CANCELADA: { texto: 'Cancelado', tono: 'neutral' },
};

function Titulo({ texto, nota }: { texto: string; nota?: string }) {
  return (
    <header className="mb-3 flex items-baseline gap-3">
      <h2 className="text-base font-semibold tracking-tight">{texto}</h2>
      {nota && <p className="text-[13px] text-muted-foreground">{nota}</p>}
    </header>
  );
}

/** Una cifra grande con su etiqueta: lo que se lee de un vistazo. */
function Cifra({ etiqueta, valor, nota, tono }: { etiqueta: string; valor: string; nota?: string; tono?: 'danger' }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[13px] text-muted-foreground">{etiqueta}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tono === 'danger' ? 'text-danger' : ''}`}>{valor}</p>
      {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
    </Card>
  );
}

/** Cobros del plan Persona: quién paga, cuánto entró y lo que viene. Stripe manda; esto es su reflejo. */
export function CobrosPage() {
  const navigate = useNavigate();
  const resumen = useQuery({
    queryKey: ['cobros'],
    queryFn: () => api.get<Resumen>('cobros'),
    // Con ligas pendientes, cada 5 s: el servidor revisa en Stripe y el pago aparece solo.
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) => (q.state.data?.cuentas.some((c) => c.estado === 'PENDIENTE') ? 5_000 : 30_000),
  });

  return (
    <>
      <PageHeader title="Cobros" description="Quién paga su plan y cuánto ha entrado." onRefresh={() => resumen.refetch()} />

      {resumen.isPending ? (
        <TableSkeleton />
      ) : resumen.isError ? (
        <ErrorState error={resumen.error} onRetry={() => resumen.refetch()} />
      ) : (
        <Contenido r={resumen.data} abrir={(id) => navigate(`/empresas?empresa=${encodeURIComponent(id)}`)} />
      )}
    </>
  );
}

function Contenido({ r, abrir }: { r: Resumen; abrir: (id: string) => void }) {
  const t = r.totales;
  return (
    <div className="space-y-6">
      {!r.disponible && (
        <Callout tone="warning" title="Stripe no está conectado">
          Pon STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET en Render para cobrar y ver los pagos aquí.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra etiqueta="Pagando" valor={String(t.pagando)} nota={t.enPrueba ? `+ ${t.enPrueba} en mes gratis` : undefined} />
        <Cifra etiqueta="Entró este mes" valor={dinero(t.esteMes.total)} nota={`${plural(t.esteMes.cobros, 'cobro', 'cobros')}, con IVA`} />
        <Cifra etiqueta="Próximo mes" valor={dinero(t.alMes)} nota="si todos siguen, sin IVA" />
        <Cifra
          etiqueta="Pagos rechazados"
          valor={String(t.atrasados)}
          nota={`Desde el inicio: ${dinero(t.historico.total)}`}
          tono={t.atrasados ? 'danger' : undefined}
        />
      </div>

      <section>
        <Titulo texto="Cuentas" nota="Toca una para abrir su plan." />
        {r.cuentas.length === 0 ? (
          <EmptyState icon={Wallet} title="Nadie tiene plan todavía" description="Desde Empresas → Su plan das el mes gratis o mandas la liga de pago." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Cuenta</Th>
                <Th>Estado</Th>
                <Th className="text-right">Meses pagados</Th>
                <Th className="text-right">Ha pagado</Th>
                <Th>Último pago</Th>
                <Th className="text-right">Próximo cobro</Th>
              </tr>
            </THead>
            <TBody>
              {r.cuentas.map((c) => (
                <Tr key={c.organizationId} className="cursor-pointer" onClick={() => abrir(c.organizationId)}>
                  <Td className="font-medium">{c.nombre}</Td>
                  <Td>
                    <Badge tone={ESTADO[c.estado].tono} dot>
                      {ESTADO[c.estado].texto}
                    </Badge>
                    {c.pruebaHasta && <span className="ml-2 text-xs text-muted-foreground">gratis hasta el {fecha(c.pruebaHasta)}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{c.mesesPagados}</Td>
                  <Td className="text-right tabular-nums">{dinero(c.pagado)}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{c.ultimoCobroAt ? fecha(c.ultimoCobroAt) : '—'}</Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {c.estado === 'CANCELADA' ? '—' : `$${c.siguiente.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {r.ultimos.length > 0 && (
        <section>
          <Titulo texto="Últimos pagos" />
          <Table>
            <THead>
              <tr>
                <Th>Cuándo</Th>
                <Th>Cuenta</Th>
                <Th className="text-right">Mes</Th>
                <Th className="text-right">Monto</Th>
                <Th>
                  <span className="sr-only">Recibo</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {r.ultimos.map((p) => (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">{fecha(p.pagadoAt)}</Td>
                  <Td>{p.nombre}</Td>
                  <Td className="text-right tabular-nums">{p.mes}</Td>
                  <Td className="text-right tabular-nums">{dinero(p.total)}</Td>
                  <Td className="text-right">
                    {p.reciboUrl && (
                      <a href={p.reciboUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline">
                        Recibo <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      )}
    </div>
  );
}
