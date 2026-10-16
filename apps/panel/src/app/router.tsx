import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AjustesPage } from '@/features/ajustes/AjustesPage';
import { AuditoriaPage } from '@/features/auditoria/AuditoriaPage';
import { EmpresasPage } from '@/features/empresas/EmpresasPage';
import { MiWhatsAppPage } from '@/features/empresas/MiWhatsAppPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ClientesPage } from '@/features/clientes/ClientesPage';
import { ConversacionesPage } from '@/features/conversaciones/ConversacionesPage';
import { CuarentenaPage } from '@/features/cuarentena/CuarentenaPage';
import { DocumentosPage } from '@/features/documentos/DocumentosPage';
import { PendientesPage } from '@/features/pendientes/PendientesPage';
import { PruebaPage } from '@/features/prueba/PruebaPage';
import { TicketsPage } from '@/features/tickets/TicketsPage';
import { VentasPage } from '@/features/ventas/VentasPage';
import { AppShell } from './layout/AppShell';
import { INICIO } from './navegacion';

function Inicio() {
  return <Navigate to={`/${INICIO}`} replace />;
}

export const router = createBrowserRouter(
  [
    { path: 'login', element: <LoginPage /> },
    {
      element: <AppShell />,
      children: [
        { index: true, element: <Inicio /> },
        { path: 'pendientes', element: <PendientesPage /> },
        { path: 'conversaciones', element: <ConversacionesPage /> },
        { path: 'tickets', element: <TicketsPage /> },
        { path: 'directorio', element: <ClientesPage /> },
        { path: 'empresas', element: <EmpresasPage /> },
        { path: 'whatsapp', element: <MiWhatsAppPage /> },
        { path: 'ventas', element: <VentasPage /> },
        { path: 'documentos', element: <DocumentosPage /> },
        { path: 'cuarentena', element: <CuarentenaPage /> },
        { path: 'auditoria', element: <AuditoriaPage /> },
        { path: 'ajustes', element: <AjustesPage /> },
        { path: 'prueba', element: <PruebaPage /> },
        { path: '*', element: <Inicio /> },
      ],
    },
  ],
  // BASE_URL trae la barra final; el router la quiere sin ella.
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
);
