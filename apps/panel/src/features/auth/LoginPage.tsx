import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { useSesion } from './sesion';

export function LoginPage() {
  const sesion = useSesion();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Ya con sesión, la pantalla de entrar no tiene nada que hacer.
  if (sesion.data) return <Navigate to="/" replace />;

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    setError(null);
    setEnviando(true);
    try {
      await api.post('login', { email: datos.get('email'), password: datos.get('password') });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Correo o contraseña incorrectos.'
          : 'No se pudo entrar. Revisa tu conexión e inténtalo de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Bot className="size-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Entra a Jarvis</h1>
          <p className="mt-1 text-muted-foreground">Panel de operación</p>
        </div>

        <form onSubmit={entrar} className="flex flex-col gap-4 rounded-xl border bg-surface p-6 shadow-sm">
          <Field label="Correo">
            {(ids) => <Input {...ids} type="email" name="email" required autoComplete="username" autoFocus />}
          </Field>
          <Field label="Contraseña">
            {(ids) => <Input {...ids} type="password" name="password" required autoComplete="current-password" />}
          </Field>
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" loading={enviando} className="mt-1">
            Entrar
          </Button>
        </form>
      </div>
    </main>
  );
}
