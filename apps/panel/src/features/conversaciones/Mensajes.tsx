import { FileText, Ticket } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { hora, nombreDia } from '@/lib/format';
import type { Hilo, Mensaje, Pendiente, TicketHilo } from './api';

const ETIQUETAS: Record<string, string> = {
  SOLICITUD: 'solicitud',
  QUEJA: 'queja',
  CONSULTA: 'consulta',
  SEGUIMIENTO: 'seguimiento',
  PIDE_HUMANO: 'pide persona',
  CORTESIA: 'cortesía',
};

const FORMATO = /(\*[^*\n]+\*|https:\/\/maps\.google\.com\/\?q=[-0-9.,]+)/g;

/** El texto como se ve en WhatsApp: *negritas*, y las ubicaciones como liga a Maps. */
export function TextoWhatsApp({ texto }: { texto: string }): ReactNode {
  return texto.split(FORMATO).map((parte, i) => {
    if (parte.startsWith('https://maps.google.com/')) {
      return (
        <a key={i} href={parte} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">
          Ver en Maps
        </a>
      );
    }
    if (parte.length > 2 && parte.startsWith('*') && parte.endsWith('*')) {
      return <strong key={i}>{parte.slice(1, -1)}</strong>;
    }
    return <Fragment key={i}>{parte}</Fragment>;
  });
}

/** Un documento que mandó el bot llega como "[documento] nombre.pdf": se enseña como archivo. */
function Cuerpo({ body }: { body: string }) {
  let texto = body.slice(0, 1200);
  const doc = /^\[documento\] (.+)(?:\n|$)/.exec(texto);
  if (doc) texto = texto.slice(doc[0].length);
  return (
    <>
      {doc && (
        <span className="mb-1 flex items-center gap-2 rounded-md bg-black/10 px-2.5 py-2 text-[13px] font-medium dark:bg-white/10">
          <FileText className="size-4 shrink-0" aria-hidden />
          <span className="break-all">{doc[1]}</span>
        </span>
      )}
      <TextoWhatsApp texto={texto} />
    </>
  );
}

/** Quién escribió un saliente. Lo viejo, sin registro, no se firma: no se sabe. */
function autor(sentBy: string | null | undefined): { firma: string | null; persona: boolean } {
  if (!sentBy) return { firma: null, persona: false };
  if (sentBy.startsWith('persona:')) {
    return { firma: `Soporte · ${sentBy.slice('persona:'.length).split('@')[0]}`, persona: true };
  }
  return { firma: 'Jarvis · bot', persona: false };
}

/** Solo se marca lo que pide atención: una etiqueta en cada mensaje era ruido. */
function etiquetaDe(m: Mensaje): string | null {
  if (m.direction !== 'IN' || !m.intent || !ETIQUETAS[m.intent]) return null;
  if (!m.molesto && m.intent !== 'QUEJA' && m.intent !== 'PIDE_HUMANO') return null;
  return [ETIQUETAS[m.intent], m.motivo?.replace(/_/g, ' '), m.molesto && 'molesto'].filter(Boolean).join(' · ');
}

interface BurbujaProps {
  entra: boolean;
  persona?: boolean;
  firma?: string | null;
  etiqueta?: string | null;
  pie: string;
  fallo?: boolean;
  tenue?: boolean;
  children: ReactNode;
}

function Burbuja({ entra, persona, firma, etiqueta, pie, fallo, tenue, children }: BurbujaProps) {
  return (
    <div
      className={cn(
        'max-w-[82%] rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap',
        entra
          ? 'self-start rounded-bl-md border bg-surface'
          : persona
            ? 'self-end rounded-br-md bg-primary text-primary-foreground'
            : 'self-end rounded-br-md bg-primary-soft text-primary-soft-foreground',
        tenue && 'opacity-60',
        fallo && 'opacity-100 ring-2 ring-danger',
      )}
    >
      {firma && <span className="mb-0.5 block text-[11px] font-semibold opacity-80">{firma}</span>}
      {etiqueta && (
        <Badge tone="danger" className="mb-1 flex w-fit">
          {etiqueta}
        </Badge>
      )}
      {children}
      <span className={cn('mt-1 block text-right text-[11px] opacity-70', fallo && 'font-medium opacity-100')}>{pie}</span>
    </div>
  );
}

/** Un ticket dentro del hilo, en el punto de la plática donde se abrió. */
function AnclaTicket({ t, onResolver }: { t: TicketHilo; onResolver: (id: string) => void }) {
  const cerrado = t.state === 'CERRADO';
  const estado = cerrado ? 'resuelto' : t.state === 'EN_REVISION' ? 'espera a una persona' : 'abierto';
  return (
    <div
      id={`ticket-${t.id}`}
      className={cn(
        'flex scroll-mt-4 items-start gap-3 self-stretch rounded-lg border px-3.5 py-3 text-[13px]',
        cerrado ? 'bg-muted/50 text-muted-foreground' : 'border-warning/40 bg-warning-soft',
      )}
    >
      <Ticket className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>
          <strong className="font-semibold">Ticket #{t.number}</strong>{' '}
          <span className="text-xs opacity-80">
            · {estado} · {hora(t.createdAt)}
          </span>
        </p>
        <p className="mt-0.5 break-words">
          <TextoWhatsApp texto={t.subject} />
        </p>
        {cerrado && t.closeReason && <p className="mt-0.5 text-xs">{t.closeReason}</p>}
      </div>
      {!cerrado && (
        <Button variant="secondary" size="sm" onClick={() => onResolver(t.id)}>
          Resolver
        </Button>
      )}
    </div>
  );
}

type Evento = { fecha: string; m: Mensaje; t?: undefined } | { fecha: string; t: TicketHilo; m?: undefined };

interface MensajesProps {
  hilo: Hilo;
  /** Lo que el operador acaba de mandar y aún no vuelve del servidor. */
  porSalir: Pendiente[];
  onResolver: (ticketId: string) => void;
}

/** Mensajes y tickets en una sola línea de tiempo, con el día como separador. */
export function Mensajes({ hilo, porSalir, onResolver }: MensajesProps) {
  const caja = useRef<HTMLDivElement>(null);
  const pegadoAbajo = useRef(true);
  const pendientes = [...hilo.pendientes, ...porSalir];

  // Solo baja al final si ya estabas abajo: si estás leyendo arriba, no te arrastra.
  useLayoutEffect(() => {
    const el = caja.current;
    if (el && pegadoAbajo.current) el.scrollTop = el.scrollHeight;
  }, [hilo.messages.length, hilo.tickets.length, pendientes.length]);

  const eventos: Evento[] = [
    ...hilo.messages.map((m) => ({ fecha: m.createdAt, m })),
    ...hilo.tickets.map((t) => ({ fecha: t.createdAt, t })),
  ].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

  let diaAnterior: string | null = null;
  let firmaAnterior: string | null = null;

  return (
    <div
      ref={caja}
      onScroll={(e) => {
        const el = e.currentTarget;
        pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="flex flex-1 flex-col gap-2 overflow-y-auto bg-background px-4 py-4"
    >
      {eventos.length + pendientes.length === 0 && (
        <p className="m-auto text-[13px] text-muted-foreground">Sin mensajes todavía.</p>
      )}

      {eventos.map((ev) => {
        const dia = new Date(ev.fecha).toDateString();
        const cambiaDia = dia !== diaAnterior;
        if (cambiaDia) firmaAnterior = null;
        diaAnterior = dia;

        let contenido: ReactNode;
        if (ev.t) {
          firmaAnterior = null;
          contenido = <AnclaTicket t={ev.t} onResolver={onResolver} />;
        } else {
          const m = ev.m;
          const entra = m.direction === 'IN';
          const a = autor(m.sentBy);
          // La firma solo cuando cambia quién escribe: repetida en cada burbuja era ruido.
          const firma = entra || a.firma === firmaAnterior ? null : a.firma;
          firmaAnterior = entra ? null : a.firma;
          contenido = (
            <Burbuja entra={entra} persona={a.persona} firma={firma} etiqueta={etiquetaDe(m)} pie={hora(m.createdAt)}>
              <Cuerpo body={m.body} />
            </Burbuja>
          );
        }

        return (
          <Fragment key={ev.t ? `t${ev.t.id}` : ev.m.id}>
            {cambiaDia && (
              <span className="my-2 self-center rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground first-letter:uppercase">
                {nombreDia(ev.fecha)}
              </span>
            )}
            {contenido}
          </Fragment>
        );
      })}

      {pendientes.map((p) => {
        const a = autor(p.sentBy);
        const fallo = p.status === 'FAILED';
        return (
          <Burbuja
            key={p.id}
            entra={false}
            persona={a.persona || !p.sentBy}
            firma={a.firma}
            tenue
            fallo={fallo}
            pie={fallo ? `no salió: ${p.error ?? 'error'}` : 'enviando…'}
          >
            <Cuerpo body={p.body} />
          </Burbuja>
        );
      })}
    </div>
  );
}
