import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fecha } from '@/lib/format';

interface Plan {
  disponible: boolean;
  iva: number;
  escalones: Array<{ mes: number; base: number; factura: number }>;
  suscripcion: {
    estado: 'PENDIENTE' | 'ACTIVA' | 'ATRASADA' | 'CANCELADA';
    conFactura: boolean;
    mesesPagados: number;
    siguiente: { subtotal: number; iva: number; total: number };
    ultimoCobroAt: string | null;
    checkoutUrl: string | null;
  } | null;
}

const ESTADO: Record<NonNullable<Plan['suscripcion']>['estado'], { texto: string; tono: Tone }> = {
  PENDIENTE: { texto: 'Liga sin pagar', tono: 'warning' },
  ACTIVA: { texto: 'Activo', tono: 'success' },
  ATRASADA: { texto: 'Pago rechazado', tono: 'danger' },
  CANCELADA: { texto: 'Cancelado', tono: 'neutral' },
};

const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;

/** Clave de la consulta del plan de una cuenta. */
const clave = (id: string) => ['empresas', id, 'plan'] as const;

export function usePlan(empresaId: string, activo = true) {
  return useQuery({
    queryKey: clave(empresaId),
    queryFn: () => api.get<Plan>('plan', { empresa: empresaId }),
    enabled: activo,
  });
}

/** Los cinco escalones, con el que toca resaltado. */
function Escalera({ plan, siguiente }: { plan: Plan; siguiente: number }) {
  const conFactura = plan.suscripcion?.conFactura ?? false;
  return (
    <ol className="mt-2 grid grid-cols-5 gap-1.5">
      {plan.escalones.map((e) => {
        const toca = e.mes === Math.min(siguiente, plan.escalones.length);
        return (
          <li
            key={e.mes}
            className={cn(
              'rounded-md border px-2 py-1.5 text-center',
              toca ? 'border-primary bg-primary-soft text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className="block text-[11px]">{e.mes === plan.escalones.length ? `Mes ${e.mes}+` : `Mes ${e.mes}`}</span>
            <span className="font-medium tabular-nums">{pesos(e.base + (conFactura ? e.factura : 0))}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** El plan Persona: en qué escalón va, la liga para pagarlo y cancelarlo. */
export function PasoPlan({ empresaId }: { empresaId: string }) {
  const usuario = useUsuario();
  const puede = usuario.role === 'ADMIN' || (usuario.role === 'EMPRESA' && usuario.organizationId === empresaId);
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [conFactura, setConFactura] = useState(false);
  const [email, setEmail] = useState('');

  const { data: plan } = usePlan(empresaId);
  const refrescar = () => void queryClient.invalidateQueries({ queryKey: clave(empresaId) });

  const liga = useMutation({
    mutationFn: () => api.post<{ url: string }>('plan/liga', { empresa: empresaId, conFactura, email }),
    onSuccess: () => refrescar(),
    onError: (err) => toast.error(err.message),
  });
  const cancelar = useMutation({
    mutationFn: () => api.post('plan/cancelar', { empresa: empresaId }),
    onSuccess: () => {
      setCancelando(false);
      toast.success('Ya no se cobrará el próximo mes');
      refrescar();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!plan) return null;
  const s = plan.suscripcion;
  const vivo = s && (s.estado === 'ACTIVA' || s.estado === 'ATRASADA');
  const url = liga.data?.url ?? s?.checkoutUrl;
  const copiar = (u: string) => void navigator.clipboard.writeText(u).then(() => toast.success('Liga copiada'));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {s ? <Badge tone={ESTADO[s.estado].tono} dot>{ESTADO[s.estado].texto}</Badge> : <span>Sin plan</span>}
        {vivo && (
          <span>
            Próximo cobro {pesos(s.siguiente.total)} <span className="text-xs">con IVA</span>
            {s.ultimoCobroAt && ` · pagó el ${fecha(s.ultimoCobroAt)}`}
          </span>
        )}
        {puede && plan.disponible && !vivo && (
          <Button variant="secondary" size="sm" onClick={() => setAbierto(true)}>
            {url ? 'Ver liga' : 'Liga de pago'}
          </Button>
        )}
        {puede && vivo && (
          <Button variant="ghost" size="sm" onClick={() => setCancelando(true)}>
            Cancelar
          </Button>
        )}
      </div>
      <Escalera plan={plan} siguiente={(s && vivo ? s.mesesPagados : 0) + 1} />
      <p className="mt-1.5 text-[11px]">Sin IVA. Baja cada mes; si cancela, vuelve a empezar.</p>

      <Dialog
        open={abierto}
        onOpenChange={setAbierto}
        title="Liga de pago"
        description="Empieza en el mes 1 y Stripe cobra cada mes solo."
        footer={
          url ? (
            <Button onClick={() => copiar(url)}>
              <Copy className="size-4" /> Copiar liga
            </Button>
          ) : (
            <Button onClick={() => liga.mutate()} loading={liga.isPending}>
              Crear liga
            </Button>
          )
        }
      >
        {url ? (
          <p className="break-all rounded-md bg-muted p-3 font-mono text-xs">{url}</p>
        ) : (
          <div className="space-y-4">
            <Field label="Correo (opcional)">
              {(ids) => (
                <Input {...ids} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="para su recibo" />
              )}
            </Field>
            <Checkbox checked={conFactura} onChange={(e) => setConFactura(e.target.checked)}>
              Con facturación{' '}
              <span className="text-muted-foreground">
                (+{pesos(plan.escalones[0].factura)} el primer mes)
              </span>
            </Checkbox>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={cancelando}
        onOpenChange={setCancelando}
        title="¿Cancelar el plan?"
        description="Se queda activo hasta fin del mes pagado. Si vuelve, empieza otra vez en el mes 1."
        confirmLabel="Cancelar plan"
        variant="danger"
        loading={cancelar.isPending}
        onConfirm={() => cancelar.mutate()}
      />
    </div>
  );
}
