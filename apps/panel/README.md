# panel

El panel de operación, en React + Vite + Tailwind v4. Sustituye por fases a
`apps/agent-core/src/infrastructure/http/panel/panel.page.ts` (el "panel clásico").

Mientras dura la migración conviven los dos:

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

## Migrar una sección

1. Crear `features/<seccion>/<Seccion>Page.tsx` con los tipos de lo que
   devuelve la API.
2. Añadir la ruta en `app/router.tsx`.
3. Quitar `clasica` de esa sección en `app/navegacion.ts`: el menú deja de
   mandar al panel clásico.

## Estado

| Sección        | Estado   |
| -------------- | -------- |
| Entrar         | migrada  |
| Tickets        | migrada  |
| Documentos     | migrada  |
| Cuarentena     | migrada  |
| Auditoría      | migrada  |
| Ajustes        | migrada  |
| Pendientes     | clásico  |
| Conversaciones | clásico (incluye el hilo del chat) |
| Clientes       | clásico  |
| Empresas       | clásico  |
| Ventas         | clásico (incluye facturación) |

Al migrar la última: `/panel` pasa a servir este panel y se borran
`panel.page.ts`, `PanelController` y el campo `clasica`.
