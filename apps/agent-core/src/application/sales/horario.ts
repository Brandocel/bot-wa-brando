/**
 * El horario de un negocio, en su hora local.
 *
 * Se guarda como { "lun": [["11:00","21:00"]], "dom": [] } en
 * SalesSettings.hours. Un día sin entrada o con lista vacía = cerrado. Un
 * tramo que cruza medianoche ("18:00"-"02:00") no se admite: se parte en dos
 * días al capturarlo.
 *
 * Todo lo que compara horas pasa por la zona horaria del negocio: el
 * servidor corre en UTC y "abre a las 11" es a las 11 de Cancún, no de
 * Oregón.
 */

export const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const;
export type Dia = (typeof DIAS)[number];
export type Horario = Partial<Record<Dia, Array<[string, string]>>>;

const NOMBRE_DIA: Record<Dia, string> = {
  dom: 'domingo', lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado',
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Lo que venga de la base, limpio: tramos válidos y ordenados. */
export function leerHorario(raw: unknown): Horario {
  const out: Horario = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const dia of DIAS) {
    const tramos = (raw as Record<string, unknown>)[dia];
    if (!Array.isArray(tramos)) continue;
    out[dia] = tramos
      .filter((t): t is [string, string] =>
        Array.isArray(t) && HHMM.test(String(t[0])) && HHMM.test(String(t[1])) && String(t[0]) < String(t[1]))
      .map((t) => [t[0], t[1]] as [string, string])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }
  return out;
}

/** Fecha y hora LOCALES del negocio para un instante. */
export function enZona(instante: Date, timezone: string): { dia: Dia; hhmm: string; fecha: string } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instante);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const dia = DIAS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday'))]!;
  return { dia, hhmm: `${v('hour')}:${v('minute')}`, fecha: `${v('year')}-${v('month')}-${v('day')}` };
}

/**
 * "2026-10-02T19:30" en la hora local del negocio, como instante UTC. Sin
 * zona en el texto a propósito: el modelo habla en la hora del negocio.
 */
export function desdeLocal(local: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const comoUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  // Cuánto se corre la zona en ese momento: se mide y se corrige dos veces
  // por si el ajuste cae justo en un cambio de horario.
  let instante = comoUtc;
  for (let i = 0; i < 2; i++) {
    const visto = enZona(new Date(instante), timezone);
    const [h, mi] = visto.hhmm.split(':').map(Number);
    const [y, mo, d] = visto.fecha.split('-').map(Number);
    const vistoUtc = Date.UTC(y!, mo! - 1, d!, h!, mi!);
    instante += comoUtc - vistoUtc;
  }
  const fecha = new Date(instante);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function abiertoEn(horario: Horario, instante: Date, timezone: string): boolean {
  const { dia, hhmm } = enZona(instante, timezone);
  return (horario[dia] ?? []).some(([de, a]) => hhmm >= de && hhmm < a);
}

/** La próxima vez que abre, dentro de una semana. null = nunca abre. */
export function siguienteApertura(horario: Horario, desde: Date, timezone: string): Date | null {
  const hoy = enZona(desde, timezone);
  for (let n = 0; n < 8; n++) {
    const dia = DIAS[(DIAS.indexOf(hoy.dia) + n) % 7]!;
    const fecha = sumarDias(hoy.fecha, n);
    for (const [de] of horario[dia] ?? []) {
      if (n === 0 && de <= hoy.hhmm) continue;
      return desdeLocal(`${fecha}T${de}`, timezone);
    }
  }
  return null;
}

/** "hoy a las 7:30 pm", "mañana a las 11:00 am", "el sábado a las 2:00 pm". */
export function cuandoEnPalabras(instante: Date, ahora: Date, timezone: string): string {
  const a = enZona(instante, timezone);
  const h = enZona(ahora, timezone);
  const hora = horaBonita(a.hhmm);
  if (a.fecha === h.fecha) return `hoy a las ${hora}`;
  if (a.fecha === sumarDias(h.fecha, 1)) return `mañana a las ${hora}`;
  return `el ${NOMBRE_DIA[a.dia]} a las ${hora}`;
}

/** El horario en una línea, para el prompt y para el cliente. */
export function horarioEnPalabras(horario: Horario): string {
  const partes = DIAS.map((d) => {
    const tramos = horario[d] ?? [];
    return `${NOMBRE_DIA[d]}: ${tramos.length ? tramos.map(([de, a]) => `${horaBonita(de)} a ${horaBonita(a)}`).join(' y ') : 'cerrado'}`;
  });
  return partes.join('; ');
}

function horaBonita(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const sufijo = h! < 12 ? 'am' : 'pm';
  const h12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`;
}

function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}
