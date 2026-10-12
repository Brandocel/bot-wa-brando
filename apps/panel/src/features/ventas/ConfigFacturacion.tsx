import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Callout, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAlcance, useConfigFacturacion, usePuedeGestionar, type ConfigFacturacion as Config, type Serie } from './api';

const TASAS_IVA: ReadonlyArray<[number, string]> = [
  [1600, '16% general'],
  [800, '8% frontera'],
  [0, '0% tasa cero'],
];

interface Props {
  empresaId: string;
  onGuardado?: () => void;
}

/** La conexión de una empresa con Factura.com y sus claves del SAT. */
export function ConfigFacturacion({ empresaId, onGuardado }: Props) {
  const config = useConfigFacturacion(empresaId);
  if (config.isPending) return <Skeleton className="h-96 rounded-lg" />;
  if (config.isError) return <ErrorState error={config.error} onRetry={() => config.refetch()} />;
  // La clave incluye si ya hay llaves: al guardarlas por primera vez aparece "Probar conexión".
  return (
    <Formulario
      key={`${empresaId}|${config.data.llavesCapturadas}`}
      empresaId={empresaId}
      inicial={config.data}
      onGuardado={onGuardado}
    />
  );
}

function Formulario({ empresaId, inicial, onGuardado }: Props & { inicial: Config }) {
  const { cuerpo } = useAlcance(empresaId);
  const queryClient = useQueryClient();
  const bloqueado = !usePuedeGestionar();
  const [c, setC] = useState(inicial);
  // Las llaves nunca vuelven del servidor: vacías significa "conserva las guardadas".
  const [llaves, setLlaves] = useState({ apiKey: '', secretKey: '' });
  const [series, setSeries] = useState<Serie[] | null>(null);
  const guardada = inicial.llavesCapturadas ? '•••••• guardada' : '';

  const probar = useMutation({
    mutationFn: () => api.post<Serie[]>('facturas/probar', cuerpo),
    onSuccess: (lista) => {
      setSeries(lista);
      toast.success(
        lista.length
          ? 'Conexión correcta: elige la serie'
          : 'Conexión correcta, pero no hay series de factura: créala en Factura.com',
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const guardar = useMutation({
    mutationFn: () => api.post('facturas/config', { ...cuerpo, ...c, ...llaves }),
    onSuccess: () => {
      toast.success('Facturación guardada');
      void queryClient.invalidateQueries({ queryKey: ['facturas', empresaId] });
      void queryClient.invalidateQueries({ queryKey: ['empresas'] });
      onGuardado?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    guardar.mutate();
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      {!c.cifradoDisponible && (
        <Callout tone="danger">
          Falta <code className="font-mono">FACTURACION_SECRET</code> en el servidor, o no tiene 64 caracteres hexadecimales
          (revísala en Render): sin ella no se pueden guardar las llaves.
        </Callout>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <Checkbox checked={c.enabled} disabled={bloqueado} onChange={(e) => setC({ ...c, enabled: e.target.checked })}>
            <strong className="font-semibold">Facturar por WhatsApp</strong>
            <span className="block text-[13px] text-muted-foreground">
              El cliente pide su factura, el bot junta sus datos y aquí la apruebas antes de timbrar.
            </span>
          </Checkbox>
          <Checkbox checked={c.sandbox} disabled={bloqueado} onChange={(e) => setC({ ...c, sandbox: e.target.checked })}>
            Modo prueba (sandbox de Factura.com, sin validez fiscal)
          </Checkbox>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Llaves de Factura.com"
          description={`Factura.com → Desarrolladores → Datos de acceso, con la empresa seleccionada. ${
            inicial.llavesCapturadas ? 'Ya hay llaves guardadas: déjalas vacías para conservarlas.' : 'Todavía no hay llaves.'
          }`}
        />
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API Key">
              {(ids) => (
                <Input
                  {...ids}
                  type="password"
                  autoComplete="off"
                  disabled={bloqueado}
                  placeholder={guardada}
                  value={llaves.apiKey}
                  onChange={(e) => setLlaves({ ...llaves, apiKey: e.target.value })}
                />
              )}
            </Field>
            <Field label="Secret Key">
              {(ids) => (
                <Input
                  {...ids}
                  type="password"
                  autoComplete="off"
                  disabled={bloqueado}
                  placeholder={guardada}
                  value={llaves.secretKey}
                  onChange={(e) => setLlaves({ ...llaves, secretKey: e.target.value })}
                />
              )}
            </Field>
          </div>
          {!bloqueado && inicial.llavesCapturadas && (
            <Button variant="secondary" className="self-start" loading={probar.isPending} onClick={() => probar.mutate()}>
              Probar conexión
            </Button>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Serie" hint={series ? undefined : 'Usa «Probar conexión» para elegirla de una lista.'}>
              {(ids) =>
                series ? (
                  <Select
                    {...ids}
                    disabled={bloqueado}
                    value={c.serieId ?? ''}
                    onChange={(e) => setC({ ...c, serieId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Elige una serie</option>
                    {series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                        {!s.activa && ' (inactiva)'}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    {...ids}
                    type="number"
                    placeholder="SerieID"
                    disabled={bloqueado}
                    value={c.serieId ?? ''}
                    onChange={(e) => setC({ ...c, serieId: e.target.value ? Number(e.target.value) : null })}
                  />
                )
              }
            </Field>
            <Field label="Correo de la empresa" hint="Factura.com lo pide si el cliente no da el suyo.">
              {(ids) => (
                <Input
                  {...ids}
                  type="email"
                  disabled={bloqueado}
                  value={c.fallbackEmail ?? ''}
                  onChange={(e) => setC({ ...c, fallbackEmail: e.target.value })}
                />
              )}
            </Field>
            <Field label="CP de expedición" hint="Vacío = el de Factura.com.">
              {(ids) => (
                <Input
                  {...ids}
                  maxLength={5}
                  inputMode="numeric"
                  disabled={bloqueado}
                  value={c.lugarExpedicion ?? ''}
                  onChange={(e) => setC({ ...c, lugarExpedicion: e.target.value })}
                />
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Impuestos y claves del SAT"
          description="01010101 = «No existe en el catálogo» (válida). Pregúntale a tu contador la clave exacta de lo que vendes; H87 = pieza, E48 = servicio."
        />
        <CardContent className="flex flex-col gap-4">
          <Checkbox
            checked={c.pricesIncludeTax}
            disabled={bloqueado}
            onChange={(e) => setC({ ...c, pricesIncludeTax: e.target.checked })}
          >
            Los precios del catálogo ya incluyen IVA
          </Checkbox>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IVA">
              {(ids) => (
                <Select
                  {...ids}
                  disabled={bloqueado}
                  value={c.ivaBasisPoints}
                  onChange={(e) => setC({ ...c, ivaBasisPoints: Number(e.target.value) })}
                >
                  {TASAS_IVA.map(([puntos, texto]) => (
                    <option key={puntos} value={puntos}>
                      {texto}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Días para pedir factura">
              {(ids) => (
                <Input
                  {...ids}
                  type="number"
                  min={1}
                  max={365}
                  disabled={bloqueado}
                  value={c.maxDaysAfterSale}
                  onChange={(e) => setC({ ...c, maxDaysAfterSale: e.target.valueAsNumber || 1 })}
                />
              )}
            </Field>
            <Field label="Clave de producto por omisión">
              {(ids) => (
                <Input
                  {...ids}
                  maxLength={8}
                  disabled={bloqueado}
                  value={c.defaultProdCode ?? ''}
                  onChange={(e) => setC({ ...c, defaultProdCode: e.target.value })}
                />
              )}
            </Field>
            <Field label="Clave de unidad">
              {(ids) => (
                <Input
                  {...ids}
                  maxLength={3}
                  disabled={bloqueado}
                  value={c.defaultUnitCode ?? ''}
                  onChange={(e) => setC({ ...c, defaultUnitCode: e.target.value })}
                />
              )}
            </Field>
            <Field label="Clave del envío">
              {(ids) => (
                <Input
                  {...ids}
                  maxLength={8}
                  disabled={bloqueado}
                  value={c.deliveryProdCode ?? ''}
                  onChange={(e) => setC({ ...c, deliveryProdCode: e.target.value })}
                />
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      {!bloqueado && (
        <Button type="submit" loading={guardar.isPending} className="self-start">
          Guardar facturación
        </Button>
      )}
    </form>
  );
}
