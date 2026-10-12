import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { useUsuario } from '@/features/auth/sesion';
import { CATEGORIAS, NOMBRE_CATEGORIA, type Categoria } from '@/features/documentos/categorias';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SENSIBLES, useRefrescarClientes, type Firma, type RolCliente } from './api';
import { CamposAtestacion } from './Atestacion';

const TIPOS: ReadonlyArray<{ rol: RolCliente; nombre: string; ayuda: string }> = [
  { rol: 'VIEWER', nombre: 'Cliente', ayuda: 'Solo lo que marques abajo, y solo documentos a su nombre.' },
  { rol: 'MANAGER', nombre: 'Gerente', ayuda: 'Todos los documentos de la empresa.' },
  { rol: 'ADMIN', nombre: 'Administrador', ayuda: 'Todo, y además autoriza a otros por WhatsApp.' },
];

interface Vista {
  display: string;
  exists: boolean;
  unverified: boolean;
  error?: string;
}

/** Cómo quedará guardado el número, comprobado contra WhatsApp mientras se escribe. */
function useVistaNumero(telefono: string) {
  const [estable, setEstable] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setEstable(telefono.trim()), 400);
    return () => clearTimeout(t);
  }, [telefono]);

  return useQuery({
    queryKey: ['numeros', 'preview', estable],
    queryFn: () => api.post<Vista>('numeros/preview', { phone: estable }),
    enabled: estable.length >= 8,
    staleTime: 60_000,
    retry: false,
  });
}

interface Props {
  empresaId: string;
  /** Con la empresa ya decidida (pestaña de una empresa) no se ofrece elegir otra. */
  empresas?: Array<{ id: string; name: string }>;
  onCerrar: () => void;
}

export function AltaCliente({ empresaId, empresas, onCerrar }: Props) {
  const deEmpresa = useUsuario().role === 'EMPRESA';
  const refrescar = useRefrescarClientes();
  const [d, setD] = useState({
    organizationId: empresaId,
    phone: '',
    fullName: '',
    displayName: '',
    role: 'VIEWER' as RolCliente,
    categories: [] as Categoria[],
  });
  const [firma, setFirma] = useState<Firma>({ confirmo: false, nota: '' });
  const vista = useVistaNumero(d.phone);

  const esCliente = d.role === 'VIEWER';
  const pideFirma = esCliente && d.categories.some((c) => SENSIBLES.includes(c));

  const alta = useMutation({
    mutationFn: () =>
      api.post<{ display: string; existsOnWhatsApp: boolean }>('numeros', {
        ...d,
        categories: esCliente ? d.categories : [],
        ...firma,
      }),
    onSuccess: (r) => {
      toast.success(`Alta lista: ${r.display}${r.existsOnWhatsApp ? '' : ' (WhatsApp no lo reconoció)'}`);
      refrescar();
      onCerrar();
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    alta.mutate();
  };

  const alternar = (cat: Categoria) =>
    setD({ ...d, categories: d.categories.includes(cat) ? d.categories.filter((c) => c !== cat) : [...d.categories, cat] });

  const v = vista.data;
  const ayudaNumero = vista.isFetching
    ? 'Comprobando…'
    : v?.error
      ? v.error
      : v
        ? `Se guardará como ${v.display} · ${
            v.exists ? 'WhatsApp lo reconoce' : v.unverified ? 'no se pudo comprobar con WhatsApp' : 'WhatsApp NO reconoce este número'
          }`
        : 'Escríbelo como lo tengas; yo lo formateo.';

  return (
    <Sheet
      open
      onOpenChange={(abierto) => !abierto && onCerrar()}
      title="Nuevo cliente"
      description="Recibirá documentos por WhatsApp cuando confirme su nombre."
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={alta.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="form-alta-cliente" loading={alta.isPending}>
            Dar de alta
          </Button>
        </>
      }
    >
      <form id="form-alta-cliente" onSubmit={enviar} className="flex flex-col gap-4">
        {!deEmpresa && empresas && empresas.length > 1 && (
          <Field label="Empresa">
            {(ids) => (
              <Select {...ids} value={d.organizationId} onChange={(e) => setD({ ...d, organizationId: e.target.value })}>
                {empresas.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label="Número de WhatsApp"
          hint={<span className={cn(v && !vista.isFetching && (v.exists ? 'text-success' : 'text-warning'))}>{ayudaNumero}</span>}
        >
          {(ids) => (
            <Input
              {...ids}
              required
              inputMode="tel"
              autoComplete="off"
              placeholder="998 486 2017"
              value={d.phone}
              onChange={(e) => setD({ ...d, phone: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Nombre completo, con apellidos"
          hint="El bot se lo pide por WhatsApp antes del primer documento y debe coincidir."
        >
          {(ids) => (
            <Input
              {...ids}
              required
              autoComplete="off"
              placeholder="Ana Ruiz Soto"
              value={d.fullName}
              onChange={(e) => setD({ ...d, fullName: e.target.value })}
            />
          )}
        </Field>
        <Field label="Cómo lo identificas (opcional)">
          {(ids) => (
            <Input
              {...ids}
              autoComplete="off"
              placeholder="Contadora de Flores"
              value={d.displayName}
              onChange={(e) => setD({ ...d, displayName: e.target.value })}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium">Tipo de acceso</legend>
          {TIPOS.filter((t) => !deEmpresa || t.rol !== 'ADMIN').map((t) => (
            <label key={t.rol} className="flex items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-primary-soft/40">
              <input
                type="radio"
                name="rol"
                className="mt-0.5 size-4 accent-primary"
                checked={d.role === t.rol}
                onChange={() => setD({ ...d, role: t.rol })}
              />
              <span>
                <span className="font-medium">{t.nombre}</span>
                <span className="block text-[13px] text-muted-foreground">{t.ayuda}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {esCliente && (
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Qué puede pedir</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CATEGORIAS.map((cat) => (
                <Checkbox key={cat} checked={d.categories.includes(cat)} onChange={() => alternar(cat)}>
                  {NOMBRE_CATEGORIA[cat]}
                  {SENSIBLES.includes(cat) && (
                    <Badge tone="warning" className="ml-1.5">
                      sensible
                    </Badge>
                  )}
                </Checkbox>
              ))}
            </div>
          </fieldset>
        )}

        {pideFirma && (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4">
            <p className="font-medium">Marcaste documentos sensibles</p>
            <CamposAtestacion value={firma} onChange={setFirma} />
          </div>
        )}
      </form>
    </Sheet>
  );
}
