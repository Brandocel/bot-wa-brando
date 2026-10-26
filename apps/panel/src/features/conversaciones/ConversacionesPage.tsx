import { MessageSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/app/layout/PageHeader';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { SearchInput } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { hace, normalizar, separarLinea } from '@/lib/format';
import { estadoDe, nombreDe, useChats, useNombresDeLinea, type Chat, type FiltroChats } from './api';
import { Hilo } from './Hilo';

const FILTROS: ReadonlyArray<{ value: FiltroChats; label: string }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'persona', label: 'Esperan a una persona' },
  { value: 'BOT', label: 'Sin responder' },
  { value: 'CLIENTE', label: 'Esperan al cliente' },
];

const resumenDe = (c: Chat): string =>
  c.ultimo
    ? (c.ultimo.direction === 'OUT' ? '↩ ' : '') + c.ultimo.body.replace(/\*/g, '').replace(/\s+/g, ' ').slice(0, 90)
    : 'Sin mensajes';

/**
 * La bandeja: lista de personas a la izquierda y la conversación a la derecha.
 * En teléfono, la conversación ocupa toda la pantalla. El chat abierto va en
 * la URL (?chat=), así otras secciones pueden mandar directo a uno.
 */
export function ConversacionesPage() {
  const [params, setParams] = useSearchParams();
  const abierto = params.get('chat');
  const [filtro, setFiltro] = useState<FiltroChats>('todas');
  const [busqueda, setBusqueda] = useState('');
  const chats = useChats(filtro);
  const lineas = useNombresDeLinea();
  const hayLineas = Object.keys(lineas).length > 0;

  const visibles = useMemo(() => {
    const q = normalizar(busqueda).trim();
    return (chats.data ?? []).filter(
      (c) => !q || normalizar(`${nombreDe(c.contact, c.chatId)} ${c.contact?.waId ?? ''} ${resumenDe(c)}`).includes(q),
    );
  }, [chats.data, busqueda]);

  const abrir = (chatId: string | null) => setParams(chatId ? { chat: chatId } : {}, { replace: abierto !== null });

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col lg:h-[calc(100dvh-4rem)]">
      <div className={cn(abierto && 'hidden lg:block')}>
        <PageHeader title="Conversaciones" onRefresh={() => chats.refetch()} />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className={cn('flex min-w-0 flex-1 flex-col', abierto && 'hidden lg:flex lg:max-w-md')}>
          <div className="mb-3 flex flex-col gap-2">
            <SearchInput
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Busca por nombre, número o mensaje"
              aria-label="Buscar conversación"
            />
            <Segmented label="Qué conversaciones ver" value={filtro} onChange={setFiltro} options={FILTROS} className="self-start" />
          </div>

          {chats.isPending ? (
            <div className="flex flex-col gap-2" role="status" aria-label="Cargando">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[76px] rounded-lg" />
              ))}
            </div>
          ) : chats.isError ? (
            <ErrorState error={chats.error} onRetry={() => chats.refetch()} />
          ) : visibles.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={busqueda ? 'Nadie coincide con la búsqueda' : filtro === 'todas' ? 'Nadie ha escrito' : 'Nada aquí'}
              description={
                busqueda ? undefined : filtro === 'todas' ? 'Sin actividad en las últimas dos semanas.' : 'Todo atendido.'
              }
            />
          ) : (
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border bg-surface shadow-xs">
              {visibles.map((c) => (
                <FilaChat
                  key={c.id}
                  chat={c}
                  activo={c.chatId === abierto}
                  linea={
                    separarLinea(c.chatId).linea
                      ? (lineas[separarLinea(c.chatId).linea!] ?? 'Otra línea')
                      : hayLineas
                        ? 'Sin línea'
                        : null
                  }
                  onAbrir={() => abrir(c.chatId)}
                />
              ))}
            </ul>
          )}
        </div>

        {abierto ? (
          <div className="min-w-0 flex-1 overflow-hidden lg:flex-[1.4] lg:rounded-lg lg:border lg:shadow-xs max-lg:fixed max-lg:inset-0 max-lg:z-40">
            <Hilo key={abierto} chatId={abierto} onCerrar={() => abrir(null)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface FilaChatProps {
  chat: Chat;
  activo: boolean;
  /** Por qué número llegó, cuando hay más de uno. */
  linea: string | null;
  onAbrir: () => void;
}

function FilaChat({ chat, activo, linea, onAbrir }: FilaChatProps) {
  const nombre = nombreDe(chat.contact, chat.chatId);
  const estado = estadoDe(chat);
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-current={activo || undefined}
        className={cn(
          'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
          activo && 'bg-primary-soft hover:bg-primary-soft',
        )}
      >
        <Avatar name={nombre} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate font-medium">{nombre}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{hace(chat.lastInboundAt)}</span>
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">{resumenDe(chat)}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={estado.tono} dot>
              {estado.texto}
            </Badge>
            {linea && <Badge>{linea}</Badge>}
            {chat.topic && <Badge>{chat.topic}</Badge>}
            {chat.quejas > 0 && <Badge tone="danger">Queja</Badge>}
            {chat.tickets[0] && <span className="font-mono text-xs text-muted-foreground">#{chat.tickets[0].number}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
