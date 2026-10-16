import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, FlaskConical, RotateCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/app/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { useEmpresas } from '@/features/ventas/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { hora, numeroBonito } from '@/lib/format';

interface Mensaje {
  id: string;
  direction: 'IN' | 'OUT';
  kind: string;
  body: string;
  sentBy: string | null;
  createdAt: string;
}

interface Chat {
  remitente: string;
  propio: boolean;
  awaiting: string | null;
  tickets: Array<{ number: number; state: string; subject: string }>;
  mensajes: Mensaje[];
}

/**
 * Chat de prueba del equipo: se le escribe al bot como un cliente, con el
 * flujo real y sus datos reales, pero nada sale por WhatsApp.
 */
export function PruebaPage() {
  const empresas = useEmpresas();
  const queryClient = useQueryClient();
  const [empresa, setEmpresa] = useState('');
  const [numero, setNumero] = useState('');
  const [texto, setTexto] = useState('');
  const fondo = useRef<HTMLDivElement>(null);

  const org = empresas.data?.find((o) => o.id === empresa);
  const persona = org?.kind === 'PERSONA';
  const listo = !!empresa && (persona || numero.trim().length >= 10);
  const params = { empresa, numero: numero.trim() || undefined };
  const clave = ['prueba', empresa, numero.trim()];

  const chat = useQuery({
    queryKey: clave,
    queryFn: () => api.get<Chat>('prueba', params),
    enabled: listo,
    refetchInterval: 1_500,
  });

  const enviar = useMutation({
    mutationFn: (t: string) => api.post<{ procesado: boolean }>('prueba/mensaje', { ...params, texto: t }),
    onSuccess: (r) => {
      if (!r.procesado) toast.warning('El bot ignoró este mensaje: lo cortó un filtro antes de contestar.');
      void queryClient.invalidateQueries({ queryKey: clave });
    },
    onError: (err) => toast.error(err.message),
  });

  const reiniciar = useMutation({
    mutationFn: () => api.post('prueba/reiniciar', params),
    onSuccess: () => {
      toast.success('Chat de prueba reiniciado');
      void queryClient.invalidateQueries({ queryKey: clave });
    },
    onError: (err) => toast.error(err.message),
  });

  const cuantos = chat.data?.mensajes.length ?? 0;
  useEffect(() => {
    fondo.current?.scrollIntoView({ block: 'end' });
  }, [cuantos, enviar.isPending]);

  const mandar = (e: FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t || enviar.isPending) return;
    setTexto('');
    enviar.mutate(t);
  };

  return (
    <>
      <PageHeader title="Chat de prueba" description="Háblale al bot como un cliente. Nada sale por WhatsApp." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Empresa" className="w-56" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
          <option value="">Elige empresa o persona…</option>
          {empresas.data?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.kind === 'PERSONA' ? ' · persona' : ''}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Número de quien escribe"
          className="w-56 font-mono text-[13px]"
          placeholder={persona ? 'Su propio número' : 'Número del cliente'}
          inputMode="tel"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
        />
        {listo && (
          <Button variant="ghost" size="sm" loading={reiniciar.isPending} onClick={() => reiniciar.mutate()}>
            <RotateCcw />
            Reiniciar
          </Button>
        )}
      </div>

      {!listo ? (
        <EmptyState
          icon={FlaskConical}
          title="Elige con quién probar"
          description="Una empresa y el número de un cliente suyo. A una persona se le escribe como ella misma."
        />
      ) : chat.isError ? (
        <ErrorState error={chat.error} onRetry={() => chat.refetch()} />
      ) : (
        <section className="flex h-[calc(100dvh-15rem)] min-h-96 flex-col overflow-hidden rounded-lg border bg-surface shadow-xs">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-[13px]">
            <span className="font-mono">{numeroBonito(chat.data?.remitente)}</span>
            {chat.data?.propio && <Badge>chat propio</Badge>}
            {chat.data?.awaiting && <Badge tone="warning">espera: {chat.data.awaiting.toLowerCase()}</Badge>}
            {chat.data?.tickets.map((t) => (
              <Badge key={t.number} tone="danger">
                Ticket #{t.number}
              </Badge>
            ))}
            <Badge tone="neutral" className="ml-auto">
              prueba
            </Badge>
          </header>

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {cuantos === 0 && <p className="py-10 text-center text-[13px] text-muted-foreground">Escribe el primer mensaje.</p>}
            {chat.data?.mensajes.map((m) => <Burbuja key={m.id} m={m} />)}
            {enviar.isPending && <p className="text-[13px] text-muted-foreground">El bot está pensando…</p>}
            <div ref={fondo} />
          </div>

          <form onSubmit={mandar} className="flex gap-2 border-t p-3">
            <Input
              aria-label="Mensaje"
              placeholder="Escribe como el cliente…"
              value={texto}
              autoFocus
              onChange={(e) => setTexto(e.target.value)}
            />
            <Button type="submit" disabled={!texto.trim()} loading={enviar.isPending} aria-label="Enviar">
              <Send />
            </Button>
          </form>
        </section>
      )}
    </>
  );
}

/** Lo del cliente a la derecha (somos nosotros); lo del bot a la izquierda. */
function Burbuja({ m }: { m: Mensaje }) {
  const cliente = m.direction === 'IN';
  const doc = m.kind === 'DOCUMENT';
  const [titulo, ...resto] = m.body.split('\n');
  return (
    <div className={cn('flex', cliente ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
          cliente ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {doc ? (
          <>
            <span className="flex items-center gap-1.5 font-medium">
              <FileText className="size-4 shrink-0" aria-hidden />
              {titulo?.replace(/^\[documento\]\s*/, '')}
            </span>
            {resto.length > 0 && <span className="mt-1 block">{resto.join('\n')}</span>}
          </>
        ) : (
          m.body
        )}
        <span className="mt-1 block text-right text-[11px] opacity-60">
          {hora(m.createdAt)}
          {!cliente && m.sentBy && m.sentBy !== 'bot' ? ` · ${m.sentBy.replace(/^persona:/, '')}` : ''}
        </span>
      </div>
    </div>
  );
}
