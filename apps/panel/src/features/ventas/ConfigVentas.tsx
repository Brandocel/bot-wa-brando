import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAlcance, useConfigVentas, usePuedeGestionar, type ConfigVentas as Config } from './api';
import { ENTREGAS, ZONAS_HORARIAS, type ModoEntrega } from './catalogos';
import { Horario } from './Horario';

interface Props {
  empresaId: string;
  /** Dentro de un panel lateral las tarjetas van en una columna. */
  compacto?: boolean;
  onGuardado?: () => void;
}

/** Cómo vende una empresa: qué ofrece, cuándo abre y cómo entrega. */
export function ConfigVentas({ empresaId, compacto, onGuardado }: Props) {
  const config = useConfigVentas(empresaId);
  if (config.isPending) return <Skeleton className="h-96 rounded-lg" />;
  if (config.isError) return <ErrorState error={config.error} onRetry={() => config.refetch()} />;
  return <Formulario key={empresaId} empresaId={empresaId} inicial={config.data} compacto={compacto} onGuardado={onGuardado} />;
}

/** "Centro, 30" por renglón ↔ [{ nombre, costo }]. */
const zonasATexto = (zonas: Config['zones']) => (zonas ?? []).map((z) => `${z.nombre}, ${z.costo}`).join('\n');
const textoAZonas = (texto: string) =>
  texto
    .split('\n')
    .map((linea) => linea.split(','))
    .filter((p) => p[0]?.trim())
    .map((p) => ({ nombre: p[0].trim(), costo: Number((p[1] ?? '0').trim()) || 0 }));

function Formulario({ empresaId, inicial, compacto, onGuardado }: Props & { inicial: Config }) {
  const { cuerpo } = useAlcance(empresaId);
  const queryClient = useQueryClient();
  const bloqueado = !usePuedeGestionar();
  const [c, setC] = useState({ ...inicial, hours: inicial.hours ?? {}, deliveryModes: inicial.deliveryModes ?? [] });
  const [zonas, setZonas] = useState(zonasATexto(inicial.zones));

  const guardar = useMutation({
    mutationFn: () => api.post('ventas/config', { ...cuerpo, ...c, zones: textoAZonas(zonas) }),
    onSuccess: () => {
      toast.success('Configuración guardada');
      void queryClient.invalidateQueries({ queryKey: ['ventas', empresaId] });
      void queryClient.invalidateQueries({ queryKey: ['empresas'] });
      onGuardado?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    guardar.mutate();
  };

  const alternarModo = (modo: ModoEntrega) =>
    setC({
      ...c,
      deliveryModes: c.deliveryModes.includes(modo) ? c.deliveryModes.filter((m) => m !== modo) : [...c.deliveryModes, modo],
    });

  // Zonas solo con domicilio; tiempo de preparación solo si hay algo físico que preparar.
  const conDomicilio = c.deliveryModes.includes('DOMICILIO');
  const conFisico = c.deliveryModes.some((m) => m !== 'DIGITAL');

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <label className="flex items-start gap-3 rounded-lg border bg-surface p-5 shadow-xs has-checked:border-primary">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={c.enabled}
          disabled={bloqueado}
          onChange={(e) => setC({ ...c, enabled: e.target.checked })}
        />
        <span>
          <strong className="font-semibold">Vender por WhatsApp</strong>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">
            Quien escriba al WhatsApp de la empresa y no sea cliente registrado podrá cotizar y hacer pedidos.
          </span>
        </span>
      </label>

      <div className={cn('grid items-start gap-4', !compacto && 'xl:grid-cols-2')}>
        <Card className={cn(!compacto && 'xl:col-span-2')}>
          <CardHeader title="El negocio" />
          <CardContent className="flex flex-col gap-4">
            <Field label="Qué vende, en una frase">
              {(ids) => (
                <Input
                  {...ids}
                  disabled={bloqueado}
                  value={c.businessType}
                  onChange={(e) => setC({ ...c, businessType: e.target.value })}
                  placeholder="Ej. comida para llevar, equipo de cómputo, servicios digitales"
                />
              )}
            </Field>
            <Field
              label="Lo que el bot debe saber para recomendar"
              hint="El bot no inventa promociones ni precios: solo usa lo que escribas aquí y lo que esté en el Catálogo."
            >
              {(ids) => (
                <Textarea
                  {...ids}
                  rows={6}
                  disabled={bloqueado}
                  value={c.pitch}
                  onChange={(e) => setC({ ...c, pitch: e.target.value })}
                  placeholder="Qué es lo más pedido, para quién es cada cosa, promociones vigentes y qué recomendar a quien no sabe qué elegir."
                />
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Horario" />
          <CardContent className="flex flex-col gap-4">
            <Field label="Zona horaria">
              {(ids) => (
                <Select {...ids} disabled={bloqueado} value={c.timezone} onChange={(e) => setC({ ...c, timezone: e.target.value })}>
                  {ZONAS_HORARIAS.map(([zona, texto]) => (
                    <option key={zona} value={zona}>
                      {texto}
                    </option>
                  ))}
                  {!ZONAS_HORARIAS.some(([zona]) => zona === c.timezone) && <option value={c.timezone}>{c.timezone}</option>}
                </Select>
              )}
            </Field>
            <Horario value={c.hours} onChange={(hours) => setC({ ...c, hours })} disabled={bloqueado} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Entrega" />
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {(Object.keys(ENTREGAS) as ModoEntrega[]).map((modo) => (
                <label key={modo} className="flex items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-primary-soft/40">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={c.deliveryModes.includes(modo)}
                    disabled={bloqueado}
                    onChange={() => alternarModo(modo)}
                  />
                  <span>
                    <span className="font-medium">{ENTREGAS[modo].nombre}</span>
                    <span className="block text-[13px] text-muted-foreground">{ENTREGAS[modo].ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
            {conDomicilio && (
              <Field label="Zonas a domicilio" hint="Una por renglón: nombre, costo.">
                {(ids) => (
                  <Textarea
                    {...ids}
                    rows={3}
                    disabled={bloqueado}
                    value={zonas}
                    onChange={(e) => setZonas(e.target.value)}
                    placeholder={'Centro, 30\nRegión 100, 45'}
                  />
                )}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {conFisico && (
                <Field label="Minutos para tener listo un pedido">
                  {(ids) => (
                    <Input
                      {...ids}
                      type="number"
                      min={5}
                      max={1440}
                      disabled={bloqueado}
                      value={c.prepMinutes}
                      onChange={(e) => setC({ ...c, prepMinutes: e.target.valueAsNumber || 0 })}
                    />
                  )}
                </Field>
              )}
              <Field label="Pedido mínimo" hint="En pesos; 0 = sin mínimo.">
                {(ids) => (
                  <Input
                    {...ids}
                    type="number"
                    min={0}
                    disabled={bloqueado}
                    value={c.minOrder}
                    onChange={(e) => setC({ ...c, minOrder: e.target.valueAsNumber || 0 })}
                  />
                )}
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      {!bloqueado && (
        <Button type="submit" loading={guardar.isPending} className="self-start">
          Guardar configuración
        </Button>
      )}
    </form>
  );
}
