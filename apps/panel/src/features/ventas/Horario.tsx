import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { Horario as Horas } from './api';
import { DIAS, type Dia } from './catalogos';

const POR_OMISION: [string, string] = ['09:00', '19:00'];

/**
 * El mismo horario todos los días abiertos se captura una vez: siete
 * renglones iguales era lo que más estorbaba. Devuelve null si de verdad
 * cambia por día.
 */
function horarioSimple(horas: Horas): [string, string] | null {
  const abiertos = DIAS.map((d) => horas[d.clave] ?? []).filter((tramos) => tramos.length > 0);
  if (abiertos.some((tramos) => tramos.length !== 1)) return null;
  if (new Set(abiertos.map((tramos) => tramos[0].join('-'))).size > 1) return null;
  return abiertos[0]?.[0] ?? POR_OMISION;
}

interface Props {
  value: Horas;
  onChange: (horas: Horas) => void;
  disabled?: boolean;
}

export function Horario({ value, onChange, disabled }: Props) {
  const [porDia, setPorDia] = useState(() => horarioSimple(value) === null);
  const rango = horarioSimple(value) ?? POR_OMISION;
  const abre = (dia: Dia) => (value[dia] ?? []).length > 0;

  const ponerDia = (dia: Dia, tramo: [string, string] | null) => onChange({ ...value, [dia]: tramo ? [tramo] : [] });

  /** En el modo simple, cambiar la hora la cambia en todos los días abiertos. */
  const ponerRango = (de: string, a: string) =>
    onChange(Object.fromEntries(DIAS.map((d) => [d.clave, abre(d.clave) ? [[de, a]] : []])) as Horas);

  return (
    <div className="flex flex-col gap-3">
      {porDia ? (
        <ul className="flex flex-col gap-2">
          {DIAS.map((d) => {
            const tramo = value[d.clave]?.[0];
            return (
              <li key={d.clave} className="flex flex-wrap items-center gap-2">
                <Checkbox
                  className="w-28"
                  checked={!!tramo}
                  disabled={disabled}
                  onChange={(e) => ponerDia(d.clave, e.target.checked ? POR_OMISION : null)}
                >
                  {d.nombre}
                </Checkbox>
                <Input
                  type="time"
                  aria-label={`${d.nombre}: abre a las`}
                  className="w-28"
                  disabled={disabled || !tramo}
                  value={tramo?.[0] ?? POR_OMISION[0]}
                  onChange={(e) => ponerDia(d.clave, [e.target.value, tramo?.[1] ?? POR_OMISION[1]])}
                />
                <span className="text-muted-foreground">a</span>
                <Input
                  type="time"
                  aria-label={`${d.nombre}: cierra a las`}
                  className="w-28"
                  disabled={disabled || !tramo}
                  value={tramo?.[1] ?? POR_OMISION[1]}
                  onChange={(e) => ponerDia(d.clave, [tramo?.[0] ?? POR_OMISION[0], e.target.value])}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Días que abre">
            {DIAS.map((d) => (
              <button
                key={d.clave}
                type="button"
                aria-pressed={abre(d.clave)}
                aria-label={d.nombre}
                disabled={disabled}
                onClick={() => ponerDia(d.clave, abre(d.clave) ? null : rango)}
                className={cn(
                  'h-9 w-12 rounded-md border border-border-strong text-[13px] font-medium text-muted-foreground transition-colors disabled:opacity-60',
                  abre(d.clave) && 'border-primary bg-primary-soft text-primary-soft-foreground',
                )}
              >
                {d.corto}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            De
            <Input
              type="time"
              aria-label="Abre a las"
              className="w-28"
              disabled={disabled}
              value={rango[0]}
              onChange={(e) => ponerRango(e.target.value, rango[1])}
            />
            a
            <Input
              type="time"
              aria-label="Cierra a las"
              className="w-28"
              disabled={disabled}
              value={rango[1]}
              onChange={(e) => ponerRango(rango[0], e.target.value)}
            />
          </div>
        </>
      )}

      {!disabled && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start px-0 text-primary hover:bg-transparent hover:underline"
          onClick={() => {
            // Al volver al modo simple, el horario del primer día abierto vale para todos.
            if (porDia) {
              const primero = DIAS.map((d) => value[d.clave]?.[0]).find(Boolean) ?? POR_OMISION;
              onChange(Object.fromEntries(DIAS.map((d) => [d.clave, abre(d.clave) ? [primero] : []])) as Horas);
            }
            setPorDia(!porDia);
          }}
        >
          {porDia ? 'Mismo horario todos los días' : 'Horario distinto por día'}
        </Button>
      )}
    </div>
  );
}
