# panel

El panel de operación, en React + Vite + Tailwind v4. Sustituye a
`apps/agent-core/src/infrastructure/http/panel/panel.page.ts` (el "panel clásico").

Hasta el relevo conviven los dos:

| Ruta        | Qué es                                                    |
| ----------- | --------------------------------------------------------- |
| `/panel`    | Panel clásico. Sigue siendo el de producción.             |
| `/panel/v2` | Este. Lo sirve agent-core ya compilado (`panel-spa.ts`).  |
| `/panel/api`| La API. La misma para los dos; aquí no se toca.           |

## Correr

```bash
npm run dev:panel
```

Abre `http://localhost:5173/panel/v2/`. La API se pide por proxy al core local
(`CORE_PORT` del `.env`), así que el core tiene que estar arriba.

```bash
npm run build:panel
```

Deja `apps/panel/dist`, que agent-core sirve en `/panel/v2` al arrancar.

## Estructura

```
src/
  app/            Arranque: router, tema, menú y armazón (layout/)
  components/ui/  El sistema de diseño: botón, tarjeta, tabla, diálogo…
  features/       Una carpeta por sección del panel (tickets/, documentos/…)
  lib/            Lo que no es de ninguna sección: api, formato, cn
  styles/         globals.css: los tokens del diseño
```

Las dependencias van en un solo sentido: `features → components/ui → lib`.
Un componente de `ui/` no sabe de tickets ni de empresas; una sección no
importa de otra salvo tipos y catálogos compartidos.

## Reglas del diseño

1. **Los colores son papeles, no tonos.** Se escribe `bg-primary`,
   `text-muted-foreground`, `border-danger/30`; nunca `bg-emerald-600` ni un
   hexadecimal. Los papeles se definen en `styles/globals.css`, claro y oscuro.
2. **Nada de CSS suelto ni `style=`** salvo un valor que sale de los datos (el
   ancho de una barra). Si un patrón se repite, es un componente de `ui/`.
3. **Cada lista tiene sus cuatro estados**: cargando (`TableSkeleton`), vacía
   (`EmptyState`), error (`ErrorState`) y con datos.
4. **Los datos del servidor van por React Query** (`useQuery` / `useMutation`)
   y siempre a través de `lib/api.ts`. Sin `fetch` en los componentes.
5. **Nada de `confirm()` ni `prompt()`**: `ConfirmDialog` y `Dialog`.
6. **Los avisos son `toast`** (sonner), con el mismo texto que ya conocía la
   operación.
7. **Ningún archivo pasa de 500 líneas.** Antes de llegar, la sección se parte:
   página, piezas y `api.ts` (tipos y consultas). Se revisa con
   `find apps/panel/src -type f | xargs wc -l | sort -rn | head`.

## Añadir una sección

1. Crear `features/<seccion>/` con su `api.ts` (tipos de lo que devuelve la
   API y sus consultas) y su `<Seccion>Page.tsx`.
2. Añadir la ruta en `app/router.tsx`.
3. Añadirla al menú en `app/navegacion.ts`.

## Estado

Las once pantallas del panel clásico ya viven aquí: Entrar, Pendientes,
Conversaciones (con el hilo), Tickets, Clientes, Empresas, Ventas (pedidos,
catálogo, configuración, facturas y facturación), Documentos, Cuarentena,
Auditoría y Ajustes.

Falta el relevo: que `/panel` sirva este panel y borrar `panel.page.ts` y
`PanelController`. Se hace después de probar este contra datos reales.
