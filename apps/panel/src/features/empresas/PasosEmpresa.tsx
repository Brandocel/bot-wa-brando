import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { ConfigFacturacion } from '@/features/ventas/ConfigFacturacion';
import { ConfigVentas } from '@/features/ventas/ConfigVentas';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { juntar, pasosDe, type Empresa } from './api';
import { PasoDocumentos } from './PasoDocumentos';
import { PasoPlan, usePlan } from './PasoPlan';
import { PasoWhatsApp } from './PasoWhatsApp';

interface PasoProps {
  n: number;
  listo: boolean;
  titulo: string;
  children: ReactNode;
  acciones?: ReactNode;
}

function Paso({ n, listo, titulo, children, acciones }: PasoProps) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
          listo ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground',
        )}
      >
        {listo ? <Check className="size-4" aria-label="Listo" /> : n}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium">{titulo}</p>
        <div className="mt-1 text-[13px] text-muted-foreground">{children}</div>
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </li>
  );
}

interface Props {
  empresa: Empresa;
  onVerPersonas: () => void;
}

/** Lo que una empresa necesita para trabajar, como cinco pasos con su estado y su acción. */
export function PasosEmpresa({ empresa: o, onVerPersonas }: Props) {
  const navigate = useNavigate();
  const [cajon, setCajon] = useState<'ventas' | 'facturacion' | null>(null);

  const pasos = pasosDe(o);
  const persona = o.kind === 'PERSONA';
  const plan = usePlan(o.id, persona).data?.suscripcion;
  const faltan = pasos.filter((p) => !p.listo).map((p) => p.nombre);
  const [, ventas, facturacion, quienFactura, documentos] = pasos;
  const productos = o._count.products;
  const facturan = o.memberships.map((m) => (m.fullName || m.contact?.displayName || 'alguien').split(' ')[0]);
  const irAVentas = (tab: string) => navigate(`/ventas?empresa=${encodeURIComponent(o.id)}&tab=${tab}`);

  return (
    <>
      <p className="mb-4">
        {faltan.length ? (
          <>
            A {o.name} le {faltan.length === 1 ? 'falta' : 'faltan'} <strong className="font-semibold">{juntar(faltan)}</strong>.
          </>
        ) : (
          `${o.name} ya está lista para vender, facturar y atender.`
        )}
      </p>

      <ol className="divide-y rounded-lg border bg-surface shadow-xs">
        <Paso n={1} listo={pasos[0].listo} titulo="Su WhatsApp">
          <PasoWhatsApp empresa={o} />
        </Paso>

        <Paso
          n={2}
          listo={ventas.listo}
          titulo="Ventas"
          acciones={
            <>
              <Button variant="secondary" size="sm" onClick={() => setCajon('ventas')}>
                {ventas.listo ? 'Ajustar' : 'Configurar'}
              </Button>
              {(productos > 0 || ventas.listo) && (
                <Button variant="secondary" size="sm" onClick={() => irAVentas('catalogo')}>
                  Catálogo
                </Button>
              )}
            </>
          }
        >
          {ventas.listo ? `Vende ${plural(productos, 'producto', 'productos')}` : 'El bot todavía no vende'}
        </Paso>

        <Paso
          n={3}
          listo={facturacion.listo}
          titulo="Facturación"
          acciones={
            <>
              <Button variant="secondary" size="sm" onClick={() => setCajon('facturacion')}>
                {facturacion.listo ? 'Ajustar' : 'Configurar'}
              </Button>
              {facturacion.listo && (
                <Button variant="secondary" size="sm" onClick={() => irAVentas('facturas')}>
                  Facturas
                </Button>
              )}
            </>
          }
        >
          {facturacion.listo ? (o.invoicing?.sandbox ? 'En modo prueba' : 'Factura de verdad') : 'Aún no factura'}
        </Paso>

        <Paso
          n={4}
          listo={quienFactura.listo}
          titulo="Quién factura por WhatsApp"
          acciones={
            <Button variant="secondary" size="sm" onClick={onVerPersonas}>
              Elegir
            </Button>
          }
        >
          {facturan.length ? juntar(facturan) : 'Nadie todavía'}
        </Paso>

        <Paso n={5} listo={documentos.listo} titulo="Sus documentos">
          {/* La clave reinicia la carpeta capturada si cambia la guardada. */}
          <PasoDocumentos key={`${o.id}|${o.driveFolderId}`} empresa={o} />
        </Paso>

        {persona && (
          <Paso n={6} listo={plan?.estado === 'ACTIVA' || (plan?.estado === 'PRUEBA' && !plan.prueba?.vencida)} titulo="Su plan">
            <PasoPlan empresaId={o.id} />
          </Paso>
        )}
      </ol>

      <Sheet
        open={cajon !== null}
        onOpenChange={(a) => !a && setCajon(null)}
        title={`${cajon === 'ventas' ? 'Ventas' : 'Facturación'} · ${o.name}`}
        className="max-w-xl"
      >
        {cajon === 'ventas' && <ConfigVentas empresaId={o.id} compacto onGuardado={() => setCajon(null)} />}
        {cajon === 'facturacion' && <ConfigFacturacion empresaId={o.id} onGuardado={() => setCajon(null)} />}
      </Sheet>
    </>
  );
}
