import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AjustesPage } from '@/features/ajustes/AjustesPage';
import { AuditoriaPage } from '@/features/auditoria/AuditoriaPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { useUsuario } from '@/features/auth/sesion';
import { CuarentenaPage } from '@/features/cuarentena/CuarentenaPage';
import { DocumentosPage } from '@/features/documentos/DocumentosPage';
import { TicketsPage } from '@/features/tickets/TicketsPage';
import { AppShell } from './layout/AppShell';
import { inicioDe } from './navegacion';

function Inicio() {
  return <Navigate to={`/${inicioDe(useUsuario().role)}`} replace />;
}

export const router = createBrowserRouter(
  [
    { path: 'login', element: <LoginPage /> },
    {
      element: <AppShell />,
      children: [
        { index: true, element: <Inicio /> },
        { path: 'tickets', element: <TicketsPage /> },
        { path: 'documentos', element: <DocumentosPage /> },
        { path: 'cuarentena', element: <CuarentenaPage /> },
        { path: 'auditoria', element: <AuditoriaPage /> },
        { path: 'ajustes', element: <AjustesPage /> },
        { path: '*', element: <Inicio /> },
      ],
    },
  ],
  // BASE_URL trae la barra final; el router la quiere sin ella.
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
);
