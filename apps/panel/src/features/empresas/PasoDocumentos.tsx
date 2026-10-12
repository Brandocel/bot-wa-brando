import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import { hace, hora, plural } from '@/lib/format';
import { useConector, useRefrescarEmpresas, type Empresa } from './api';

/** El alta de prueba deja una carpeta inventada: se avisa para que no se confunda con una real. */
const esDePrueba = (id: string | null) => !!id?.startsWith('drive-folder-');

/** De dónde salen los documentos de una empresa: su computadora o una carpeta de Drive. */
export function PasoDocumentos({ empresa: o }: { empresa: Empresa }) {
  const esAdmin = useUsuario().role === 'ADMIN';
  const refrescar = useRefrescarEmpresas();
  const [carpeta, setCarpeta] = useState(o.driveFolderId ?? '');
  const [aPc, setAPc] = useState(false);
  const [aDrive, setADrive] = useState(false);
  const [conectando, setConectando] = useState(false);

  const accion = useMutation({
    mutationFn: (p: { ruta: string; cuerpo: object; ok: string }) => api.post(p.ruta, { id: o.id, ...p.cuerpo }),
    onSuccess: (_, p) => {
      toast.success(p.ok);
      setAPc(false);
      setADrive(false);
      refrescar();
    },
    onError: (err) => {
      setAPc(false);
      toast.error(err.message);
    },
  });

  const guardarCarpeta = (e: FormEvent) => {
    e.preventDefault();
    accion.mutate({
      ruta: 'empresas/actualizar',
      cuerpo: { driveFolderId: carpeta },
      ok: 'Carpeta actualizada. Corre /sync por WhatsApp para reindexar.',
    });
  };

  function cambiarOrigen(origen: string) {
    if (origen === 'PC') setAPc(true);
    else setADrive(true);
  }

  const pasarADrive = (e: FormEvent) => {
    e.preventDefault();
    accion.mutate({
      ruta: 'empresas/origen',
      cuerpo: { sourceType: 'DRIVE', driveFolderId: carpeta },
      ok: 'Listo. Se va a volver a leer la carpeta de Drive.',
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {esAdmin && (
        <Select
          aria-label="De dónde salen sus documentos"
          className="w-56"
          value={o.sourceType}
          disabled={accion.isPending}
          onChange={(e) => cambiarOrigen(e.target.value)}
        >
          <option value="PC">Su computadora</option>
          <option value="DRIVE">Google Drive</option>
        </Select>
      )}

      {o.sourceType === 'PC' ? (
        <>
          <EstadoPc empresaId={o.id} />
          {esAdmin && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setConectando(true)}>
              Conectar una computadora
            </Button>
          )}
        </>
      ) : esAdmin ? (
        <form onSubmit={guardarCarpeta} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Id de la carpeta de Drive"
            className="min-w-56 flex-1 font-mono text-[13px]"
            placeholder="1a2B3c4D5e6F7g8H"
            value={carpeta}
            onChange={(e) => setCarpeta(e.target.value)}
          />
          <Button type="submit" variant="secondary" loading={accion.isPending} disabled={carpeta === (o.driveFolderId ?? '')}>
            Guardar
          </Button>
          {esDePrueba(o.driveFolderId) && <Badge tone="warning">De prueba</Badge>}
        </form>
      ) : (
        <p className="font-mono text-[13px]">{o.driveFolderId ?? 'Sin carpeta'}</p>
      )}

      <ConfirmDialog
        open={aPc}
        onOpenChange={setAPc}
        title="¿Cambiar a su computadora?"
        description="El bot dejará de leer su carpeta de Drive."
        confirmLabel="Cambiar"
        loading={accion.isPending}
        onConfirm={() =>
          accion.mutate({
            ruta: 'empresas/origen',
            cuerpo: { sourceType: 'PC' },
            ok: 'Listo. Pulsa «Conectar una computadora» para instalar el conector.',
          })
        }
      />
      <Dialog
        open={aDrive}
        onOpenChange={setADrive}
        title="Cambiar a Google Drive"
        description="El id que sale en la URL de la carpeta. Vacío: la que tenía antes."
        footer={
          <>
            <Button variant="secondary" onClick={() => setADrive(false)} disabled={accion.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="form-a-drive" loading={accion.isPending}>
              Cambiar
            </Button>
          </>
        }
      >
        <form id="form-a-drive" onSubmit={pasarADrive}>
          <Input
            aria-label="Id de la carpeta de Drive"
            className="font-mono text-[13px]"
            placeholder="1a2B3c4D5e6F7g8H"
            value={carpeta}
            onChange={(e) => setCarpeta(e.target.value)}
            autoFocus
          />
        </form>
      </Dialog>
      {conectando && <DialogoConector empresa={o} onCerrar={() => setConectando(false)} />}
    </div>
  );
}

function EstadoPc({ empresaId }: { empresaId: string }) {
  const esAdmin = useUsuario().role === 'ADMIN';
  const refrescar = useRefrescarEmpresas();
  const conector = useConector(empresaId, true);
  const [porQuitar, setPorQuitar] = useState<{ id: string; name: string } | null>(null);

  const revocar = useMutation({
    mutationFn: (id: string) => api.post('empresas/conector/revocar', { id }),
    onSuccess: () => {
      toast.success('Equipo desconectado');
      setPorQuitar(null);
      refrescar();
    },
    onError: (err) => toast.error(err.message),
  });

  const r = conector.data;
  if (!r) return <p className="text-[13px] text-muted-foreground">Revisando…</p>;
  if (r.devices.length === 0) return <Badge tone="warning">Sin conectar</Badge>;

  const visto = r.devices.map((d) => d.lastSeenAt).filter(Boolean).sort().pop();
  // El conector revisa cada pocos minutos: más de 30 sin noticias es que la PC está apagada.
  const enLinea = !!visto && Date.now() - new Date(visto).getTime() < 30 * 60_000;

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={enLinea ? 'success' : 'warning'} dot>
          {enLinea ? 'En línea' : 'Apagada'}
        </Badge>
        <Link to="/documentos" className="font-medium text-primary underline-offset-2 hover:underline">
          {plural(r.documentos.entregables, 'entregable', 'entregables')}
        </Link>
        {r.documentos.revision > 0 && (
          <Link to="/cuarentena" className="font-medium text-warning underline-offset-2 hover:underline">
            {r.documentos.revision} por revisar
          </Link>
        )}
        {r.documentos.descartados > 0 && (
          <span className="text-muted-foreground">{plural(r.documentos.descartados, 'descartado', 'descartados')}</span>
        )}
        {r.lastUploadAt && <span className="text-muted-foreground">· última subida {hace(r.lastUploadAt)}</span>}
      </p>
      <ul className="flex flex-wrap gap-2">
        {r.devices.map((d) => (
          <li key={d.id} className="flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2.5">
            {d.name}
            {esAdmin && (
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setPorQuitar(d)}>
                Quitar
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={porQuitar !== null}
        onOpenChange={(a) => !a && setPorQuitar(null)}
        title={`¿Desconectar ${porQuitar?.name ?? 'este equipo'}?`}
        description="Deja de subir archivos; lo ya subido se queda."
        confirmLabel="Desconectar"
        variant="danger"
        loading={revocar.isPending}
        onConfirm={() => porQuitar && revocar.mutate(porQuitar.id)}
      />
    </div>
  );
}

/**
 * Conectar la PC de una empresa. Lo principal es el instalador: trae la
 * dirección y el código adentro, así que el cliente solo le da doble clic.
 * El código a mano queda como plan B.
 */
export function DialogoConector({ empresa: o, onCerrar }: { empresa: Pick<Empresa, 'id' | 'name'>; onCerrar: () => void }) {
  const codigo = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: string }>('empresas/conector/codigo', { id: o.id }),
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(a) => !a && onCerrar()}
      title={`Conectar la computadora de ${o.name}`}
      description="Cada descarga sirve para una computadora y vale 3 días."
      className="max-w-lg"
      footer={
        <Button variant="secondary" onClick={onCerrar}>
          Cerrar
        </Button>
      }
    >
      <a
        href={`/panel/api/empresas/conector/descarga?id=${encodeURIComponent(o.id)}`}
        download
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
      >
        <Download className="size-4" aria-hidden />
        Descargar conector
      </a>
      <ol className="mt-4 list-decimal space-y-1.5 pl-4 text-[13px] text-muted-foreground">
        <li>Mándale el archivo al cliente por correo o WhatsApp, o ábrelo tú en su computadora.</li>
        <li>
          Doble clic. Si Windows avisa «protegió su PC»: <em>Más información → Ejecutar de todas formas</em>.
        </li>
        <li>
          Pulsa <strong className="font-medium text-foreground">Crear carpeta nueva</strong> (recomendado) y pon ahí los
          documentos. Queda trabajando solo, sin ventanas, también al reiniciar.
        </li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Cada archivo se revisa antes de poder mandarse: lo que no sea un documento de la empresa o traiga contraseñas no se
        entrega, y lo dudoso te llega a Cuarentena.
      </p>

      <details className="mt-4 border-t pt-3 text-[13px]">
        <summary className="font-medium">¿Ya tiene el conector? Usa un código</summary>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" loading={codigo.isPending} onClick={() => codigo.mutate()}>
            Generar código
          </Button>
          {codigo.data && (
            <p>
              <strong className="font-mono text-lg tracking-widest">
                {codigo.data.code.slice(0, 3)} {codigo.data.code.slice(3)}
              </strong>
              <span className="block text-xs text-muted-foreground">
                Dirección <code className="font-mono">{location.origin}</code> · vence {hora(codigo.data.expiresAt)}
              </span>
            </p>
          )}
        </div>
      </details>
    </Dialog>
  );
}
