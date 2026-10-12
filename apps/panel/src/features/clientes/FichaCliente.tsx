import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { CATEGORIAS, NOMBRE_CATEGORIA, type Categoria } from '@/features/documentos/categorias';
import { usePuedeGestionar } from '@/features/ventas/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fecha, numeroBonito } from '@/lib/format';
import { nombreVisible, pasosDe, ROL, SENSIBLES, useRefrescarClientes, type ClavePaso, type Cliente, type Firma } from './api';
import { Atestacion } from './Atestacion';

/** Qué espera el doble paso o el formulario abierto dentro de la ficha. */
type Abierto = { tipo: ClavePaso } | { tipo: 'permiso'; categoria: Categoria } | null;

interface Peticion {
  ruta: string;
  cuerpo: object;
  ok: string;
}

interface Props {
  cliente: Cliente;
  /** Tras quitarle el acceso: la ficha ya no tiene a quién enseñar. */
  onRevocado: () => void;
}

/** Todo sobre un cliente: quién es, qué le falta, qué puede pedir y si factura. */
export function FichaCliente({ cliente: c, onRevocado }: Props) {
  const puedeGestionar = usePuedeGestionar();
  const refrescar = useRefrescarClientes();
  const [abierto, setAbierto] = useState<Abierto>(null);
  const [confirmando, setConfirmando] = useState<'revocar' | 'facturar' | null>(null);

  const accion = useMutation({
    mutationFn: (p: Peticion) => api.post(p.ruta, p.cuerpo),
    onSuccess: (_, p) => {
      toast.success(p.ok);
      setAbierto(null);
      setConfirmando(null);
      refrescar();
      if (p.ruta === 'numeros/revocar') onRevocado();
    },
    onError: (err) => {
      setConfirmando(null);
      toast.error(err.message);
    },
  });

  const nombre = nombreVisible(c);
  const tiene = new Set(c.grants.map((g) => g.category));

  function alternarPermiso(categoria: Categoria, activar: boolean) {
    // Lo sensible no se da con un clic: primero el doble paso.
    if (activar && SENSIBLES.includes(categoria)) return setAbierto({ tipo: 'permiso', categoria });
    accion.mutate({
      ruta: 'numeros/permiso',
      cuerpo: { membershipId: c.id, category: categoria, enabled: activar },
      ok: activar ? `Ahora puede pedir ${NOMBRE_CATEGORIA[categoria]}` : 'Permiso retirado',
    });
  }

  const facturar = (enabled: boolean) =>
    accion.mutate({
      ruta: 'numeros/facturar',
      cuerpo: { id: c.id, enabled },
      ok: enabled ? 'Ya puede emitir facturas por WhatsApp' : 'Ya no puede emitir facturas',
    });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <Avatar name={nombre} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">{nombre}</h2>
          <p className="text-[13px] text-muted-foreground">
            <span className="font-mono">{numeroBonito(c.contact.waId)}</span> · {ROL[c.role]}
            {c.contact.displayName && c.fullName && ` · ${c.contact.displayName}`}
          </p>
        </div>
      </header>

      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Identidad</h3>
        <ol className="flex flex-col gap-4">
          {pasosDe(c).map((paso, i) => (
            <li key={paso.clave} className="flex gap-3">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  paso.listo ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground',
                )}
              >
                {paso.listo ? <Check className="size-3.5" aria-label="Hecho" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{paso.titulo}</p>
                <p className="text-[13px] text-muted-foreground">{paso.detalle}</p>
                {puedeGestionar && (
                  <Paso
                    cliente={c}
                    clave={paso.clave}
                    listo={paso.listo}
                    abierto={abierto?.tipo === paso.clave}
                    cargando={accion.isPending}
                    onAbrir={() => setAbierto({ tipo: paso.clave })}
                    onCancelar={() => setAbierto(null)}
                    onEnviar={(p) => accion.mutate(p)}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Qué puede pedir</h3>
        {c.role === 'VIEWER' ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {CATEGORIAS.map((cat) => (
                <Checkbox
                  key={cat}
                  checked={tiene.has(cat)}
                  disabled={!puedeGestionar || accion.isPending}
                  onChange={(e) => alternarPermiso(cat, e.target.checked)}
                >
                  {NOMBRE_CATEGORIA[cat]}
                  {SENSIBLES.includes(cat) && (
                    <Badge tone="warning" className="ml-1.5">
                      sensible
                    </Badge>
                  )}
                </Checkbox>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">Solo recibe documentos que estén a su nombre.</p>
            {abierto?.tipo === 'permiso' && (
              <Atestacion
                titulo={`Dar acceso a ${NOMBRE_CATEGORIA[abierto.categoria]}`}
                explicacion="Es un documento sensible: solo dáselo a quien ya comprobaste quién es."
                cargando={accion.isPending}
                onCancelar={() => setAbierto(null)}
                onConfirmar={(firma) =>
                  accion.mutate({
                    ruta: 'numeros/permiso',
                    cuerpo: { membershipId: c.id, category: abierto.categoria, enabled: true, ...firma },
                    ok: `Ahora puede pedir ${NOMBRE_CATEGORIA[abierto.categoria]}`,
                  })
                }
              />
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Como {ROL[c.role].toLowerCase()}, ve todos los documentos de su empresa.</p>
        )}
      </section>

      <section>
        {/* Emitir facturas es otra cosa que ver documentos: permiso aparte. */}
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Facturación</h3>
        <Checkbox
          checked={c.canInvoice}
          disabled={!puedeGestionar || accion.isPending || !(c.verifiedAt || c.canInvoice)}
          onChange={(e) => (e.target.checked ? setConfirmando('facturar') : facturar(false))}
        >
          Puede emitir facturas de {c.organization.name} por WhatsApp
        </Checkbox>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {c.verifiedAt
            ? 'Le escribe al bot «factura para…» con los datos de su cliente y se timbra con su «sí».'
            : 'Primero verifica el número: va a facturar a nombre de la empresa.'}
        </p>
      </section>

      {puedeGestionar && (
        <footer className="flex items-center justify-between gap-3 border-t pt-4">
          <span className="text-xs text-muted-foreground">Alta: {fecha(c.createdAt)}</span>
          <Button variant="danger-soft" size="sm" onClick={() => setConfirmando('revocar')}>
            Quitar acceso
          </Button>
        </footer>
      )}

      <ConfirmDialog
        open={confirmando === 'revocar'}
        onOpenChange={(a) => !a && setConfirmando(null)}
        title="¿Quitarle el acceso?"
        description={`${nombre} deja de recibir documentos por WhatsApp desde este momento.`}
        confirmLabel="Quitar acceso"
        variant="danger"
        loading={accion.isPending}
        onConfirm={() => accion.mutate({ ruta: 'numeros/revocar', cuerpo: { id: c.id }, ok: 'Acceso retirado' })}
      />
      <ConfirmDialog
        open={confirmando === 'facturar'}
        onOpenChange={(a) => !a && setConfirmando(null)}
        title="¿Dejar que emita facturas?"
        description="Este número podrá timbrar facturas a nombre de la empresa desde WhatsApp."
        confirmLabel="Sí, puede facturar"
        loading={accion.isPending}
        onConfirm={() => facturar(true)}
      />
    </div>
  );
}

interface PasoProps {
  cliente: Cliente;
  clave: ClavePaso;
  listo: boolean;
  abierto: boolean;
  cargando: boolean;
  onAbrir: () => void;
  onCancelar: () => void;
  onEnviar: (p: Peticion) => void;
}

/** Lo que se puede hacer en cada paso de identidad: un botón, o su formulario ya abierto. */
function Paso({ cliente: c, clave, listo, abierto, cargando, onAbrir, onCancelar, onEnviar }: PasoProps) {
  const [nombre, setNombre] = useState(c.fullName ?? '');
  const boton = (texto: string) => (
    <Button variant="secondary" size="sm" className="mt-2" onClick={onAbrir}>
      {texto}
    </Button>
  );

  if (clave === 'nombre') {
    if (!abierto) return boton(c.fullName ? 'Cambiar' : 'Registrar');
    const enviar = (e: FormEvent) => {
      e.preventDefault();
      onEnviar({ ruta: 'numeros/nombre', cuerpo: { id: c.id, fullName: nombre }, ok: 'Nombre guardado' });
    };
    return (
      <form onSubmit={enviar} className="mt-3 flex flex-col gap-3 rounded-lg border bg-background p-4">
        <Field
          label="Nombre completo, con apellidos"
          hint={c.nameConfirmedAt ? 'Si lo cambias, tendrá que confirmarlo otra vez.' : undefined}
        >
          {(ids) => <Input {...ids} required autoComplete="off" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={cargando}>
            Guardar
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancelar} disabled={cargando}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  if (listo) return null;
  const firmar = (ruta: string, ok: string) => (firma: Firma) => onEnviar({ ruta, cuerpo: { id: c.id, ...firma }, ok });

  if (clave === 'confirmar') {
    if (!c.fullName) return null;
    if (!abierto) return boton('Confirmar a mano');
    return (
      <Atestacion
        titulo="Confirmar el nombre a mano"
        explicacion="Desde ahora el bot no le preguntará su nombre: le entregará directamente lo que tenga permitido."
        cargando={cargando}
        onCancelar={onCancelar}
        onConfirmar={firmar('numeros/confirmar-nombre', 'Nombre confirmado')}
      />
    );
  }

  if (!abierto) return boton('Verificar número');
  return (
    <Atestacion
      titulo="Verificar el número"
      explicacion="Un número de WhatsApp se reasigna, se clona o se pierde con el teléfono. Verifícalo solo si comprobaste que es de esta persona."
      cargando={cargando}
      onCancelar={onCancelar}
      onConfirmar={firmar('numeros/verificar', 'Número verificado')}
    />
  );
}
