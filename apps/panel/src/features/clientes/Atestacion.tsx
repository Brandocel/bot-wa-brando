import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Textarea } from '@/components/ui/field';
import type { Firma } from './api';

interface CamposProps {
  value: Firma;
  onChange: (firma: Firma) => void;
}

/** Los dos campos del doble paso, para meterlos en un formulario más grande. */
export function CamposAtestacion({ value, onChange }: CamposProps) {
  return (
    <>
      <Checkbox checked={value.confirmo} onChange={(e) => onChange({ ...value, confirmo: e.target.checked })}>
        Hablé con esta persona y comprobé que el número es suyo.
      </Checkbox>
      <Field label="¿Cómo lo comprobaste?">
        {(ids) => (
          <Textarea
            {...ids}
            rows={2}
            className="min-h-16"
            value={value.nota}
            onChange={(e) => onChange({ ...value, nota: e.target.value })}
            placeholder="Ej.: le llamé al número registrado y confirmó sus datos"
          />
        )}
      </Field>
    </>
  );
}

interface Props {
  titulo: ReactNode;
  explicacion: string;
  cargando: boolean;
  onConfirmar: (firma: Firma) => void;
  onCancelar: () => void;
}

/**
 * Lo sensible —verificar el número, confirmar el nombre a mano, dar
 * documentos fiscales— pide confirmar que se habló con la persona y anotar
 * cómo. Queda en la auditoría con quién lo hizo.
 */
export function Atestacion({ titulo, explicacion, cargando, onConfirmar, onCancelar }: Props) {
  const [firma, setFirma] = useState<Firma>({ confirmo: false, nota: '' });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onConfirmar(firma);
  };

  return (
    <form onSubmit={enviar} className="mt-3 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4">
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{explicacion}</p>
      </div>
      <CamposAtestacion value={firma} onChange={setFirma} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={cargando}>
          Confirmar
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancelar} disabled={cargando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
