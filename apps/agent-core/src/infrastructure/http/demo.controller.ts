import { Body, Controller, HttpCode, Inject, Options, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { config } from '../../config';
import { DemoAgenteService, type QuienDemo, type TurnoDemo } from '../../application/demo/demo-agente.service';
import { DemoLimites, type Freno } from '../../application/demo/demo-limites';

/** Lo más largo que se acepta: un mensaje de WhatsApp normal, no un documento pegado. */
const MAX_TEXTO = 300;
const MAX_HISTORIAL = 12;
const MAX_TEXTO_HISTORIAL = 1200;

/** Lo que se contesta cuando un tope frena: en la voz de Jarvis, con la salida a WhatsApp. */
const AL_FRENAR: Record<Freno, string> = {
  sesion: 'Hasta aquí llega la demo 🙌 Si te gustó, escríbeme por WhatsApp con el botón de la página y te dejo listo con tus papeles de verdad.',
  ip: 'Llevas muchos mensajes en poco rato. Dame un respiro y vuelve en un rato, o escríbeme por WhatsApp.',
  dia: 'Hoy ya platiqué demasiado en la demo. Vuelve mañana, o escríbeme por WhatsApp con el botón de la página.',
};

/**
 * La demo pública de la web: POST /demo/chat. Sin sesión ni cuenta: la
 * página manda la plática y recibe la respuesta. Solo la llaman las páginas
 * de DEMO_ORIGENES (CORS), y cada visita, IP y día tienen tope.
 */
@Controller('demo')
export class DemoController {
  private readonly limites = new DemoLimites({
    porSesion: config.demo.porSesion,
    porIpHora: config.demo.porIpHora,
    porDia: config.demo.porDia,
  });

  // Con el token explícito: así también arranca con tsx, que no emite los tipos de los decoradores.
  constructor(@Inject(DemoAgenteService) private readonly demo: DemoAgenteService) {}

  @Options('chat')
  @HttpCode(204)
  preflight(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    permitir(req, res);
  }

  @Post('chat')
  @HttpCode(200)
  async chat(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    if (!permitir(req, res)) {
      res.status(403);
      return { error: 'origen no permitido' };
    }
    if (!this.demo.disponible) {
      res.status(503);
      return { error: 'demo apagada' };
    }
    const entrada = leer(body);
    if (!entrada) {
      res.status(400);
      return { error: 'mensaje inválido' };
    }

    const freno = this.limites.pasar(req.ip ?? 'sin-ip', entrada.sesion);
    if (freno) {
      res.status(429);
      return { texto: AL_FRENAR[freno], archivos: [], vistos: entrada.turno.vistos, restantes: 0, freno };
    }

    const r = await this.demo.atender(entrada.turno);
    if (!r) {
      res.status(502);
      return { error: 'el modelo no respondió' };
    }
    return { ...r, restantes: this.limites.restantes(entrada.sesion) };
  }
}

/** Pone las cabeceras de CORS si el origen está en la lista. Sin Origin (curl, pruebas) se deja pasar. */
function permitir(req: Request, res: Response): boolean {
  const origen = req.headers.origin;
  if (!origen) return true;
  if (!config.demo.origenes.includes(origen)) return false;
  res.setHeader('Access-Control-Allow-Origin', origen);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

/** Valida lo que manda la página. Todo viene de afuera: se recorta y se descarta lo raro. */
export function leer(body: unknown): { sesion: string; turno: TurnoDemo } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const texto = typeof b.texto === 'string' ? b.texto.trim() : '';
  const sesion = typeof b.sesion === 'string' ? b.sesion.trim() : '';
  if (!texto || texto.length > MAX_TEXTO) return null;
  if (!/^[\w-]{8,64}$/.test(sesion)) return null;
  const quien: QuienDemo = b.quien === 'otro' ? 'otro' : 'tu';
  const historial = (Array.isArray(b.historial) ? b.historial : [])
    .filter((m): m is { rol: 'cliente' | 'bot'; texto: string } => {
      const x = m as Record<string, unknown>;
      return (x?.rol === 'cliente' || x?.rol === 'bot') && typeof x.texto === 'string' && x.texto.trim() !== '';
    })
    .slice(-MAX_HISTORIAL)
    .map((m) => ({ rol: m.rol, texto: m.texto.slice(0, MAX_TEXTO_HISTORIAL) }));
  const vistos = (Array.isArray(b.vistos) ? b.vistos : []).filter((v): v is string => typeof v === 'string' && v.length <= 8).slice(0, 20);
  return { sesion, turno: { texto, historial, vistos, quien } };
}
