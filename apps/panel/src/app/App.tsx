import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { router } from './router';
import { useTema } from './tema';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Las listas del panel se refrescan solas; entre refrescos, lo que hay
      // en pantalla vale. Un 401 o un 403 no se arreglan reintentando.
      staleTime: 10_000,
      retry: (intentos, error) => !(error instanceof ApiError && error.status < 500) && intentos < 2,
    },
  },
});

export function App() {
  const { tema } = useTema();
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        theme={tema === 'oscuro' ? 'dark' : 'light'}
        position="bottom-right"
        toastOptions={{ classNames: { toast: 'font-sans' } }}
      />
    </QueryClientProvider>
  );
}
