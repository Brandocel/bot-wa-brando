/**
 * Los frenos de la demo pública. Cualquiera puede escribirle, y cada
 * mensaje es una llamada al modelo que se paga: por eso hay tope por
 * visita, por IP y por día. Viven en memoria: si el proceso se reinicia,
 * vuelven a cero, y está bien (el tope del día es para que una noche mala
 * no salga cara, no una cuenta exacta).
 */
export interface TopesDemo {
  /** Mensajes por visita (la misma pestaña). */
  porSesion: number;
  /** Mensajes por IP en una hora. */
  porIpHora: number;
  /** Mensajes de todos en un día (UTC). */
  porDia: number;
}

export type Freno = 'sesion' | 'ip' | 'dia';

const HORA = 60 * 60 * 1000;

export class DemoLimites {
  private readonly sesiones = new Map<string, number>();
  private readonly ips = new Map<string, number[]>();
  private dia = '';
  private delDia = 0;

  constructor(
    private readonly topes: TopesDemo,
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Cuenta el mensaje si cabe; si no, dice qué tope lo frenó. */
  pasar(ip: string, sesion: string): Freno | null {
    const t = this.ahora();
    const hoy = new Date(t).toISOString().slice(0, 10);
    if (hoy !== this.dia) {
      this.dia = hoy;
      this.delDia = 0;
      // Cambia el día: lo viejo ya no sirve y así el mapa no crece sin fin.
      this.sesiones.clear();
    }
    if (this.delDia >= this.topes.porDia) return 'dia';

    const usados = this.sesiones.get(sesion) ?? 0;
    if (usados >= this.topes.porSesion) return 'sesion';

    const recientes = (this.ips.get(ip) ?? []).filter((x) => t - x < HORA);
    if (recientes.length >= this.topes.porIpHora) {
      this.ips.set(ip, recientes);
      return 'ip';
    }

    recientes.push(t);
    this.ips.set(ip, recientes);
    this.sesiones.set(sesion, usados + 1);
    this.delDia += 1;
    return null;
  }

  /** Cuántos mensajes le quedan a esta visita. */
  restantes(sesion: string): number {
    return Math.max(0, this.topes.porSesion - (this.sesiones.get(sesion) ?? 0));
  }
}
