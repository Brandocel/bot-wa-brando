import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useRefrescarEmpresas } from './api';

interface Props {
  onCerrar: () => void;
  /** La empresa recién creada, para abrirla; `conPc` si toca conectar su computadora. */
  onCreada: (empresa: { id: string; name: string }, conPc: boolean) => void;
}

export function AltaEmpresa({ onCerrar, onCreada }: Props) {
  const refrescar = useRefrescarEmpresas();
  const [d, setD] = useState({
    name: '',
    kind: 'EMPRESA' as 'EMPRESA' | 'PERSONA',
    taxId: '',
    sourceType: 'PC' as 'PC' | 'DRIVE',
    driveFolderId: '',
  });
  const persona = d.kind === 'PERSONA';
  const creada = persona ? 'Persona creada' : 'Empresa creada';

  const crear = useMutation({
    mutationFn: () => api.post<{ id: string }>('empresas', d),
    onSuccess: (r) => {
      toast.success(
        d.sourceType === 'PC'
          ? `${creada}. Ahora conecta su computadora.`
          : `${creada}. Comparte la carpeta con la cuenta de servicio y corre /sync.`,
      );
      refrescar();
      onCreada({ id: r.id, name: d.name }, d.sourceType === 'PC');
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    crear.mutate();
  };

  return (
    <Sheet
      open
      onOpenChange={(a) => !a && onCerrar()}
      title={persona ? 'Nueva persona' : 'Nueva empresa'}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={crear.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="form-alta-empresa" loading={crear.isPending}>
            {persona ? 'Crear persona' : 'Crear empresa'}
          </Button>
        </>
      }
    >
      <form id="form-alta-empresa" onSubmit={enviar} className="flex flex-col gap-4">
        <Segmented
          label="Tipo de cliente"
          value={d.kind}
          onChange={(kind) => setD({ ...d, kind })}
          options={[
            { value: 'EMPRESA', label: 'Empresa' },
            { value: 'PERSONA', label: 'Persona' },
          ]}
        />
        <Field label="Nombre">
          {(ids) => (
            <Input {...ids} required autoFocus placeholder={persona ? 'Alan Pérez' : 'Flores de Paula'} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          )}
        </Field>
        <Field label="RFC (opcional)">
          {(ids) => <Input {...ids} placeholder={persona ? 'PEPA800101AB1' : 'FDP240101AB1'} value={d.taxId} onChange={(e) => setD({ ...d, taxId: e.target.value })} />}
        </Field>
        <Field label="¿De dónde salen sus documentos?">
          {(ids) => (
            <Select {...ids} value={d.sourceType} onChange={(e) => setD({ ...d, sourceType: e.target.value as 'PC' | 'DRIVE' })}>
              <option value="PC">Su computadora</option>
              <option value="DRIVE">Google Drive</option>
            </Select>
          )}
        </Field>
        {d.sourceType === 'DRIVE' && (
          <Field label="Carpeta de Drive" hint="El id que sale en la URL de la carpeta.">
            {(ids) => (
              <Input
                {...ids}
                required
                className="font-mono text-[13px]"
                placeholder="1a2B3c4D5e6F7g8H"
                value={d.driveFolderId}
                onChange={(e) => setD({ ...d, driveFolderId: e.target.value })}
              />
            )}
          </Field>
        )}
      </form>
    </Sheet>
  );
}
