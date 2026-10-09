import { Bot, Menu } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { useSesion } from '@/features/auth/sesion';
import { ApiError } from '@/lib/api';
import { Sidebar } from './Sidebar';

/**
 * El armazón: menú fijo a la izquierda en escritorio y, en teléfono, una
 * barra arriba con el menú dentro de un cajón. Nada de dentro se pinta hasta
 * saber quién entró.
 */
export function AppShell() {
  const sesion = useSesion();
  const [menuAbierto, setMenuAbierto] = useState(false);

  if (sesion.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-label="Cargando">
        <Skeleton className="size-10 rounded-xl" />
      </div>
    );
  }

  if (sesion.isError || !sesion.data) {
    if (sesion.error instanceof ApiError && sesion.error.status === 401) return <Navigate to="/login" replace />;
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState error={sesion.error} onRetry={() => sesion.refetch()} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r lg:block">
        <Sidebar />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-surface/90 px-4 backdrop-blur lg:hidden">
        <Dialog.Root open={menuAbierto} onOpenChange={setMenuAbierto}>
          <Dialog.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menú">
              <Menu />
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 animate-overlay bg-black/45" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] border-r shadow-lg" aria-describedby={undefined}>
              <Dialog.Title className="sr-only">Menú</Dialog.Title>
              <Sidebar onNavigate={() => setMenuAbierto(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <Bot className="size-5 text-primary" aria-hidden />
        <span className="font-semibold tracking-tight">Jarvis</span>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
