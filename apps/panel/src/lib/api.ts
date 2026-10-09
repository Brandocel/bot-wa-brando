/**
 * El único sitio que habla con /panel/api.
 *
 * La sesión va en una cookie httpOnly: aquí no hay token que guardar. Un 401
 * significa que caducó, y se manda a entrar desde cualquier pantalla.
 */
const BASE = '/panel/api/';

export class ApiError extends Error {
  constructor(
    mensaje: string,
    readonly status: number,
  ) {
    super(mensaje);
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + ruta, init);

  if (res.status === 401 && ruta !== 'login') {
    if (!location.pathname.endsWith('/login')) location.assign(import.meta.env.BASE_URL + 'login');
    throw new ApiError('La sesión caducó', 401);
  }

  // Un error del servidor llega como { statusCode, message }.
  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    const mensaje = datos?.message;
    throw new ApiError(
      (Array.isArray(mensaje) ? mensaje.join(', ') : mensaje) || `El servidor respondió ${res.status}`,
      res.status,
    );
  }
  return datos as T;
}

export const api = {
  get: <T>(ruta: string, params?: Record<string, string | undefined>) => {
    const query = new URLSearchParams(
      Object.entries(params ?? {}).filter((par): par is [string, string] => par[1] !== undefined),
    ).toString();
    return pedir<T>(query ? `${ruta}?${query}` : ruta);
  },
  post: <T = { ok: boolean }>(ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo ?? {}),
    }),
};
