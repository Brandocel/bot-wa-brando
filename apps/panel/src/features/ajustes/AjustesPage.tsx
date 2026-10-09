import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/app/layout/PageHeader';
import { CLAVE_RESUMEN } from '@/app/layout/resumen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, ErrorState, Meter, Skeleton } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { useUsuario } from '@/features/auth/sesion';
import { api } from '@/lib/api';
import { hora, numeroBonito } from '@/lib/format';

type ClaveTope = 'porChatHora' | 'globalHora' | 'porChatMinuto';
type Limites = Record<ClaveTope, number> & { contarDocumentos: boolean };

interface UsoLimites {
  limites: Limites;
  desde: string;
  global: number;
  chats: Array<{ chatId: string; nombre: string | null; cuenta: number }>;
  rango: Record<ClaveTope, [number, number]>;
  defecto: Limites;
}

type Tarea = 'conversacion' | 'redaccion' | 'clasificacion';
type Modelos = Record<Tarea, string>;

interface ModelosConfig {
  modelos: Modelos;
  disponibles: Array<{ id: string; nombre: string; entrada: number; salida: number; descripcion: string }>;
  defecto: Modelos;
}

const TOPES: Array<{ clave: ClaveTope; etiqueta: string; ayuda: string }> = [
  { clave: 'porChatHora', etiqueta: 'Por chat, por hora', ayuda: 'Respuestas a una misma persona en una hora.' },
  {
    clave: 'globalHora',
    etiqueta: 'En total, por hora',
    ayuda: 'Todas las respuestas del bot sumadas. Al llegar, deja de contestar a todos.',
  },
  { clave: 'porChatMinuto', etiqueta: 'Por chat, por minuto', ayuda: 'Seguro contra bucles.' },
];

const TAREAS: Array<{ clave: Tarea; etiqueta: string; ayuda: string }> = [
  { clave: 'conversacion', etiqueta: 'Entender mensajes', ayuda: 'Saca del mensaje qué documento, mes o folio pide el cliente.' },
  { clave: 'redaccion', etiqueta: 'Redactar respuestas', ayuda: 'Escribe la respuesta en lenguaje natural.' },
  {
    clave: 'clasificacion',
    etiqueta: 'Clasificar archivos',
    ayuda: 'Decide si un archivo se puede entregar o es interno o sensible.',
  },
];

const SOLO_ADMIN = <p className="text-[13px] text-muted-foreground">Solo un administrador puede cambiarlos.</p>;

export function AjustesPage() {
  const esAdmin = useUsuario().role === 'ADMIN';
  const uso = useQuery({
    queryKey: ['ajustes', 'limites'],
    queryFn: () => api.get<UsoLimites>('ajustes/limites'),
    refetchInterval: 20_000,
  });
  const modelos = useQuery({ queryKey: ['ajustes', 'modelos'], queryFn: () => api.get<ModelosConfig>('ajustes/modelos') });

  return (
    <>
      <PageHeader
        title="Ajustes"
        description="Cuánto puede mandar el bot y con qué modelo piensa."
        onRefresh={() => {
          void uso.refetch();
          void modelos.refetch();
        }}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {uso.isPending ? (
          <>
            <Skeleton className="h-72 rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </>
        ) : uso.isError ? (
          <div className="xl:col-span-2">
            <ErrorState error={uso.error} onRetry={() => uso.refetch()} />
          </div>
        ) : (
          <>
            <TarjetaUso uso={uso.data} />
            {/* La clave son los topes guardados: al guardar, el formulario arranca de lo nuevo. */}
            <FormTopes key={JSON.stringify(uso.data.limites)} uso={uso.data} esAdmin={esAdmin} />
          </>
        )}

        {modelos.isPending ? (
          <Skeleton className="h-80 rounded-lg xl:col-start-2" />
        ) : modelos.isError ? (
          <div className="xl:col-start-2">
            <ErrorState error={modelos.error} onRetry={() => modelos.refetch()} />
          </div>
        ) : (
          <FormModelos key={JSON.stringify(modelos.data.modelos)} config={modelos.data} esAdmin={esAdmin} />
        )}
      </div>
    </>
  );
}

function TarjetaUso({ uso }: { uso: UsoLimites }) {
  const { limites } = uso;
  return (
    <Card>
      <CardHeader title="Cuántos lleva" description={`Última hora (desde las ${hora(uso.desde)}). Se actualiza solo.`} />
      <CardContent>
        <p className="mb-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{uso.global}</span>{' '}
          <span className="text-muted-foreground">de {limites.globalHora} mensajes en total</span>
        </p>
        <Meter value={uso.global} max={limites.globalHora} label="Mensajes en total esta hora" />

        {uso.chats.length === 0 ? (
          <p className="mt-5 text-[13px] text-muted-foreground">Nadie ha recibido mensajes en la última hora.</p>
        ) : (
          <>
            <h3 className="mt-6 mb-1 text-xs font-medium text-muted-foreground">
              Chats con más mensajes ({limites.contarDocumentos ? 'contando documentos' : 'sin contar documentos'})
            </h3>
            <ul className="divide-y">
              {uso.chats.map((c) => {
                const nombre = c.nombre || numeroBonito(c.chatId);
                return (
                  <li key={c.chatId} className="py-2.5">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] font-medium">{nombre}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {c.cuenta} de {limites.porChatHora}
                      </span>
                    </div>
                    <Meter value={c.cuenta} max={limites.porChatHora} label={`Mensajes a ${nombre} esta hora`} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FormTopes({ uso, esAdmin }: { uso: UsoLimites; esAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<Limites>(uso.limites);
  const [confirmando, setConfirmando] = useState(false);

  const guardar = useMutation({
    mutationFn: () => api.post<Limites>('ajustes/limites', valores),
    onSuccess: () => {
      toast.success('Topes guardados: aplican desde el siguiente mensaje');
      setConfirmando(false);
      void queryClient.invalidateQueries({ queryKey: ['ajustes', 'limites'] });
      void queryClient.invalidateQueries({ queryKey: CLAVE_RESUMEN });
    },
    onError: (err) => {
      setConfirmando(false);
      toast.error(err.message);
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setConfirmando(true);
  };

  return (
    <Card>
      <CardHeader title="Topes de mensajes" />
      <CardContent>
        <form onSubmit={enviar} className="flex flex-col gap-5">
          <Callout tone="warning" title="Antes de subirlos, ten en cuenta">
            <p>
              El número del bot se conecta como WhatsApp Web, no por la API oficial de WhatsApp. Si manda muchos mensajes
              seguidos, WhatsApp puede restringirlo o bloquearlo, y con él se detiene la atención de{' '}
              <strong>todas</strong> las empresas. Súbelos poco a poco y solo si el tráfico es de clientes reales.
            </p>
            <p>
              Te avisamos por WhatsApp cuando el bot llegue al 80 % y al 100 % del tope total, y cuando un chat llegue a
              su tope.
            </p>
          </Callout>

          <div className="grid gap-4 sm:grid-cols-3">
            {TOPES.map(({ clave, etiqueta, ayuda }) => {
              const [min, max] = uso.rango[clave];
              return (
                <Field
                  key={clave}
                  label={etiqueta}
                  hint={`${ayuda} Entre ${min} y ${max}; recomendado ${uso.defecto[clave]}.`}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      type="number"
                      inputMode="numeric"
                      min={min}
                      max={max}
                      required
                      disabled={!esAdmin}
                      value={valores[clave]}
                      onChange={(e) => setValores({ ...valores, [clave]: e.target.valueAsNumber })}
                    />
                  )}
                </Field>
              );
            })}
          </div>

          <Checkbox
            checked={valores.contarDocumentos}
            disabled={!esAdmin}
            onChange={(e) => setValores({ ...valores, contarDocumentos: e.target.checked })}
          >
            Contar también los documentos enviados en los topes por chat
          </Checkbox>

          {esAdmin ? (
            <Button type="submit" className="self-start">
              Guardar topes
            </Button>
          ) : (
            SOLO_ADMIN
          )}
        </form>
      </CardContent>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="¿Guardar estos topes?"
        description="Subirlos de más puede hacer que WhatsApp restrinja el número del bot, y con él se detiene la atención de todas las empresas."
        confirmLabel="Guardar topes"
        loading={guardar.isPending}
        onConfirm={() => guardar.mutate()}
      />
    </Card>
  );
}

function FormModelos({ config, esAdmin }: { config: ModelosConfig; esAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [elegidos, setElegidos] = useState<Modelos>(config.modelos);

  const guardar = useMutation({
    mutationFn: () => api.post<Modelos>('ajustes/modelos', elegidos),
    onSuccess: () => {
      toast.success('Modelos guardados: aplican desde el siguiente mensaje');
      void queryClient.invalidateQueries({ queryKey: ['ajustes', 'modelos'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    guardar.mutate();
  };

  return (
    <Card className="xl:col-start-2">
      <CardHeader
        title="Modelos de IA"
        description="Precio de lista por millón de tokens (entrada / salida). Entender y redactar pasan en cada mensaje: ahí es donde se nota el gasto. Clasificar pasa una vez por archivo."
      />
      <CardContent>
        <form onSubmit={enviar} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {TAREAS.map(({ clave, etiqueta, ayuda }) => (
              <Field key={clave} label={etiqueta} hint={ayuda}>
                {(ids) => (
                  <Select
                    {...ids}
                    disabled={!esAdmin}
                    value={elegidos[clave]}
                    onChange={(e) => setElegidos({ ...elegidos, [clave]: e.target.value })}
                  >
                    {config.disponibles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre} · ${m.entrada} / ${m.salida} USD{config.defecto[clave] === m.id ? ' (recomendado)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>

          <dl className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
            {config.disponibles.map((m) => (
              <div key={m.id}>
                <dt className="inline font-medium text-foreground">{m.nombre}: </dt>
                <dd className="inline">{m.descripcion}</dd>
              </div>
            ))}
          </dl>

          {esAdmin ? (
            <Button type="submit" loading={guardar.isPending} className="self-start">
              Guardar modelos
            </Button>
          ) : (
            SOLO_ADMIN
          )}
        </form>
      </CardContent>
    </Card>
  );
}
