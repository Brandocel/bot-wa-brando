import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Send, Ticket, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { CLAVE_RESUMEN } from '@/app/layout/resumen';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import { hora, numeroBonito, separarLinea } from '@/lib/format';
import { claveHilo, estadoDe, nombreDe, useHilo, useNombresDeLinea, type Pendiente } from './api';
import { BorrarConversacion } from './BorrarConversacion';
import { Mensajes } from './Mensajes';

interface HiloProps {
  chatId: string;
  onCerrar: () => void;
}

/** Una conversación completa: quién es, en qué está, la charla y la caja para contestar. */
export function Hilo({ chatId, onCerrar }: HiloProps) {
  const usuario = useUsuario();
  const queryClient = useQueryClient();
  const hilo = useHilo(chatId);
  const lineas = useNombresDeLinea();
  const [porSalir, setPorSalir] = useState<Pendiente[]>([]);
  const [borrando, setBorrando] = useState(false);

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: claveHilo(chatId) });
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['pendientes'] });
    void queryClient.invalidateQueries({ queryKey: CLAVE_RESUMEN });
  };

  const atender = useMutation({
    mutationFn: (activo: boolean) => api.post('conversacion/atender', { chatId, activo }),
    onSuccess: (_, activo) => {
      toast.success(activo ? 'El bot se calla en este chat; lo atiendes tú.' : 'El bot vuelve a atender este chat.');
      refrescar();
    },
    onError: (err) => toast.error(err.message),
  });

  const resolver = useMutation({
    mutationFn: (id: string) => api.post('ticket/cerrar', { id }),
    onSuccess: () => {
      toast.success('Ticket cerrado');
      refrescar();
    },
    onError: (err) => toast.error(err.message),
  });

  const datos = hilo.data;
  const nombre = datos ? nombreDe(datos.contact, chatId) : numeroBonito(chatId);
  const linea = separarLinea(chatId).linea;
  const abiertos = datos?.tickets.filter((t) => t.state !== 'CERRADO') ?? [];

  /** Lleva al ticket abierto más reciente; si no hay abiertos, al último. */
  function irAlTicket() {
    const destino = [...(abiertos.length ? abiertos : (datos?.tickets ?? []))].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
    if (!destino) return toast('Esta persona no tiene tickets.');
    document.getElementById(`ticket-${destino.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <section aria-label={`Conversación con ${nombre}`} className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-3 border-b px-3 py-3 sm:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onCerrar} aria-label="Volver a la lista">
          <ArrowLeft />
        </Button>
        <Avatar name={nombre} />
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="truncate font-semibold">{nombre}</h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{numeroBonito(datos?.contact?.waId ?? chatId)}</p>
        </div>
        {datos && (
          <>
            <Button variant="ghost" size="sm" onClick={irAlTicket} aria-label={`Tickets: ${abiertos.length} abiertos`}>
              <Ticket />
              {abiertos.length > 0 && <span className="tabular-nums">{abiertos.length}</span>}
            </Button>
            <Button
              variant={datos.enManosDePersona ? 'secondary' : 'primary'}
              size="sm"
              loading={atender.isPending}
              onClick={() => atender.mutate(!datos.enManosDePersona)}
              title={datos.enManosDePersona ? 'El bot vuelve a contestar este chat' : 'El bot se calla y contestas tú'}
            >
              {datos.enManosDePersona ? 'Devolver al bot' : 'Atender yo'}
            </Button>
            {/* Borrar es de ADMIN; el servidor lo comprueba igual. */}
            {usuario.role === 'ADMIN' && (
              <Button variant="ghost" size="icon" onClick={() => setBorrando(true)} aria-label="Borrar esta conversación">
                <Trash2 />
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={onCerrar} aria-label="Cerrar">
          <X />
        </Button>
      </header>

      {hilo.isPending ? (
        <div className="flex flex-1 flex-col gap-3 bg-background p-4" role="status" aria-label="Cargando conversación">
          {[52, 70, 46, 38, 64].map((ancho, i) => (
            <Skeleton key={i} className={i % 2 ? 'h-10 self-end' : 'h-10 self-start'} style={{ width: `${ancho}%` }} />
          ))}
        </div>
      ) : hilo.isError ? (
        <div className="flex-1 p-4">
          <ErrorState error={hilo.error} onRetry={() => hilo.refetch()} />
        </div>
      ) : !datos ? (
        <p className="m-auto p-6 text-[13px] text-muted-foreground">Esta conversación ya no existe.</p>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-2">
            <Badge tone={estadoDe(datos).tono} dot>
              {estadoDe(datos).texto}
              {datos.enManosDePersona && datos.handoffUntil && ` · hasta ${hora(datos.handoffUntil)}`}
            </Badge>
            {/* Por qué número escribió: la misma persona por dos números son dos chats. */}
            <Badge>
              {linea && <Building2 className="size-3" aria-hidden />}
              {linea ? (lineas[linea] ?? 'Otra empresa') : 'Número principal'}
            </Badge>
            {datos.contact?.memberships.map((m) => (
              <Badge key={m.organization.name + m.role}>
                {m.organization.name} · {m.role.toLowerCase()}
                {!m.verifiedAt && ' · sin verificar'}
              </Badge>
            ))}
            {datos.topic && <Badge>{datos.topic}</Badge>}
          </div>

          <Mensajes hilo={datos} porSalir={porSalir} onResolver={(id) => resolver.mutate(id)} />
          <Compositor
            key={chatId}
            chatId={chatId}
            onPorSalir={setPorSalir}
            onEnviado={refrescar}
          />
          <BorrarConversacion
            open={borrando}
            onOpenChange={setBorrando}
            chatId={chatId}
            quien={nombre}
            onBorrado={(todo) => {
              refrescar();
              if (todo) onCerrar();
            }}
          />
        </>
      )}
    </section>
  );
}

interface CompositorProps {
  chatId: string;
  onPorSalir: (pendientes: Pendiente[]) => void;
  onEnviado: () => void;
}

function Compositor({ chatId, onPorSalir, onEnviado }: CompositorProps) {
  const campo = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState('');

  // El campo crece con el texto hasta un tope; después, se desplaza.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  useEffect(() => {
    if (matchMedia('(min-width: 1024px)').matches) campo.current?.focus();
  }, []);

  const enviar = useMutation({
    mutationFn: (text: string) => api.post('mensaje', { chatId, text }),
    // Se pinta ya, como pendiente: el mensaje existe para ti desde que le das enviar.
    onMutate: (text) => onPorSalir([{ id: `local-${Date.now()}`, body: text, status: 'PENDING' }]),
    onSuccess: onEnviado,
    onError: (err, text) => {
      toast.error(err.message);
      setTexto(text);
    },
    onSettled: () => onPorSalir([]),
  });

  function mandar(e?: FormEvent) {
    e?.preventDefault();
    const limpio = texto.trim();
    if (!limpio || enviar.isPending) return;
    setTexto('');
    enviar.mutate(limpio);
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      mandar();
    }
  }

  return (
    <form onSubmit={mandar} className="shrink-0 border-t p-3">
      <div className="flex items-end gap-2 rounded-xl border border-border-strong bg-surface p-1.5 shadow-xs focus-within:border-ring">
        <textarea
          ref={campo}
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          placeholder="Escribe un mensaje…"
          aria-label="Mensaje"
          className="max-h-40 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <Button type="submit" size="icon" disabled={!texto.trim()} aria-label="Enviar">
          <Send />
        </Button>
      </div>
      <p className="mt-1.5 hidden px-1 text-[11px] text-muted-foreground lg:block">Enter envía · Shift+Enter nueva línea</p>
    </form>
  );
}
