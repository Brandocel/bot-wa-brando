import { Bot, LogOut, Moon, Sun } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NOMBRE_ROL, useSalir, useUsuario } from "@/features/auth/sesion";
import { cn } from "@/lib/cn";
import { iniciales } from "@/lib/format";
import { useEmpresas } from "@/features/ventas/api";
import { gruposDe, type Seccion } from "../navegacion";
import { useTema } from "../tema";
import { totalPendientes, useResumen, type Resumen } from "./resumen";

const item =
  "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function contadorDe(seccion: Seccion, resumen: Resumen | undefined): number {
  if (!resumen || !seccion.contador) return 0;
  return seccion.contador === "pendientes"
    ? totalPendientes(resumen)
    : resumen[seccion.contador];
}

/** El menú. `onNavigate` cierra el cajón en móvil al elegir una sección. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const usuario = useUsuario();
  const resumen = useResumen().data;
  const salir = useSalir();
  const { tema, alternar } = useTema();
  const { pathname, search } = useLocation();
  // El usuario de empresa ve solo lo que tiene contratado.
  const empresas = useEmpresas();
  const herramientas =
    usuario.role === "EMPRESA"
      ? (empresas.data?.[0]?.herramientas ?? null)
      : null;

  /** Activa por ruta y, si la lleva, por pestaña: "Facturas" es Ventas?tab=facturas. */
  const activa = (ruta: string) => {
    const [camino, query] = ruta.split("?");
    if (pathname !== `/${camino}` && !pathname.startsWith(`/${camino}/`))
      return false;
    const tab = new URLSearchParams(search).get("tab");
    return query
      ? tab === new URLSearchParams(query).get("tab")
      : tab !== "facturas";
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-16 shrink-0 items-center gap-3 px-5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="size-[18px]" aria-hidden />
        </span>
        <span className="text-base font-semibold tracking-tight">Jarvis</span>
      </div>

      <nav
        aria-label="Secciones"
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2"
      >
        {gruposDe(usuario.role, herramientas).map((g) => (
          <div key={g.titulo ?? "inicio"} className="flex flex-col gap-0.5">
            {g.titulo && (
              <p className="mt-4 mb-1 px-3 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
                {g.titulo}
              </p>
            )}
            {g.secciones.map((s) => {
              const n = contadorDe(s, resumen);
              return (
                <NavLink
                  key={s.ruta}
                  to={`/${s.ruta}`}
                  onClick={onNavigate}
                  className={() =>
                    cn(
                      item,
                      activa(s.ruta) &&
                        "bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft hover:text-primary-soft-foreground",
                    )
                  }
                >
                  <s.icono className="size-[18px] shrink-0" aria-hidden />
                  <span className="flex-1 truncate text-left">{s.nombre}</span>
                  {n > 0 && (
                    <span className="rounded-full bg-warning-soft px-2 text-xs font-semibold text-warning tabular-nums">
                      {n}
                      <span className="sr-only"> por atender</span>
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-3 border-t p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
          {iniciales(usuario.name)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium">{usuario.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {usuario.role === "EMPRESA"
              ? (usuario.organizationName ?? "Empresa")
              : NOMBRE_ROL[usuario.role]}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={alternar}
          aria-label={
            tema === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
          }
        >
          {tema === "oscuro" ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={salir}
          aria-label="Salir"
        >
          <LogOut />
        </Button>
      </div>
    </div>
  );
}
