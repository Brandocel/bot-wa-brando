import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DocCategory, Document } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { LLM_PORT, type HerramientaLlm, type LlmPort } from '../ports/llm.port';
import type { OrgScope } from './access-scope.service';
import type { HistoryTurn } from './conversation-history.service';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentSearchService } from './document-search.service';
import { EntregasEnCursoService } from './entregas-en-curso.service';
import { SolicitudService, type Opcion } from './solicitud.service';
import { TicketService } from './ticket.service';

/** Cuántos se le enseñan al modelo por búsqueda, y cuántos manda de una vez. */
export const MAX_RESULTADOS = 15;
export const MAX_ENTREGA = 10;

const TIPOS: Record<DocCategory, string> = {
  FACTURA: 'facturas y CFDI',
  CONTRATO: 'contratos, convenios y acuerdos',
  COTIZACION: 'cotizaciones y presupuestos',
  REPORTE: 'reportes e informes',
  POLIZA: 'pólizas de seguro',
  ESTADO_CUENTA: 'estados de cuenta',
  CONTABLE: 'contables, nómina, IMSS, SAT, finiquitos',
  OTRO: 'todo lo demás (constancias, opiniones, comprobantes…)',
};

export interface TurnoAgente {
  chatId: string;
  waId: string;
  mensajeId: string;
  texto: string;
  conversationId: string;
  contactId: string;
  scopes: readonly OrgScope[];
  history: readonly HistoryTurn[];
}

/**
 * El agente autónomo de documentos.
 *
 * En vez de reglas para cada forma de pedir, el modelo entiende la
 * conversación y usa herramientas: busca (y vuelve a buscar con otras
 * palabras si no encuentra), enseña opciones, entrega, consulta cómo van
 * los envíos o pasa con una persona. Lo que no puede hacer:
 *  - ver documentos fuera del alcance de quien escribe: cada búsqueda y
 *    cada entrega pasan por el mismo DocumentSearchService con sus scopes;
 *  - decir que mandó algo sin mandarlo: solo `entregar_documentos` encola,
 *    y su respuesta es la que el modelo tiene para contar.
 */
@Injectable()
export class AgenteDocumentosService {
  private readonly logger = new Logger(AgenteDocumentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    private readonly search: DocumentSearchService,
    private readonly delivery: DocumentDeliveryService,
    private readonly solicitudes: SolicitudService,
    private readonly tickets: TicketService,
    @Optional() private readonly entregas?: EntregasEnCursoService,
  ) {}

  /**
   * ¿Este turno lo atiende el agente? AGENTE_AUTONOMO: "persona" (por
   * omisión: solo clientes PERSONA, el piloto), "todos" u "off".
   */
  async aplica(scopes: readonly OrgScope[]): Promise<boolean> {
    if (!this.llm.agente || scopes.length === 0) return false;
    const modo = (process.env.AGENTE_AUTONOMO ?? 'persona').toLowerCase();
    if (modo === 'off') return false;
    if (modo === 'todos') return true;
    const personas = await this.prisma.organization.count({
      where: { id: { in: scopes.map((s) => s.organizationId) }, kind: 'PERSONA' },
    });
    return personas > 0;
  }

  /** Atiende el turno. null = el modelo no respondió: sigue el flujo de reglas. */
  async atender(turno: TurnoAgente): Promise<string | null> {
    const sol = await this.solicitudes.actual(turno.conversationId);
    const vistos = new Map<number, string>(
      (sol.opciones ?? []).filter((o) => o.tipo === 'documento').map((o) => [o.n, o.id]),
    );
    const nombres = new Map<string, string>((sol.opciones ?? []).map((o) => [o.id, o.nombre]));
    let siguiente = Math.max(0, ...vistos.keys()) + 1;
    let entregados = 0;

    const ejecutar = async (nombre: string, entrada: Record<string, unknown>): Promise<string> => {
      switch (nombre) {
        case 'buscar_documentos': {
          const query = {
            category: esTipo(entrada.tipo) ? entrada.tipo : null,
            period: aMes(entrada.mes),
            folio: null,
            text: typeof entrada.texto === 'string' && entrada.texto.trim() ? entrada.texto.trim() : null,
            organizationId: turno.scopes.length === 1 ? turno.scopes[0]!.organizationId : null,
          };
          const limite = Math.min(MAX_RESULTADOS, Math.max(1, Number(entrada.limite) || 10));
          const [docs, total] = await Promise.all([
            this.search.search(turno.scopes, query, limite),
            this.search.count(turno.scopes, query),
          ]);
          // Cada búsqueda es una lista nueva numerada desde 1, como la ve la
          // persona. Con números que crecían de búsqueda en búsqueda le
          // salían "24." y "4." en una lista de dos, y el mismo archivo
          // cambiaba de número al turno siguiente.
          vistos.clear();
          siguiente = 1;
          const filas = docs.map((d) => {
            const ref = siguiente++;
            vistos.set(ref, d.id);
            nombres.set(d.id, d.name);
            return describir(ref, d);
          });
          return JSON.stringify({ total, mostrados: filas.length, documentos: filas });
        }

        case 'ver_inventario': {
          const lineas = await this.search.inventario(turno.scopes);
          return JSON.stringify(
            lineas.map((l) => ({ tipo: l.category, cuantos: l.count, desde: mes(l.from), hasta: mes(l.to) })),
          );
        }

        case 'entregar_documentos': {
          const refs = Array.isArray(entrada.refs) ? entrada.refs.map(Number).filter(Number.isInteger) : [];
          if (refs.length === 0) return 'error: no dijiste qué refs mandar';
          if (refs.length > MAX_ENTREGA) return `error: máximo ${MAX_ENTREGA} por vez; pide confirmación para mandar en partes`;
          const leyenda = typeof entrada.leyenda === 'string' ? entrada.leyenda.slice(0, 200) : '';
          const salida: string[] = [];
          for (const ref of refs) {
            const id = vistos.get(ref);
            if (!id) {
              salida.push(`ref ${ref}: no existe; busca primero`);
              continue;
            }
            // El permiso se revisa otra vez aquí: lo que el modelo diga no lo amplía.
            const doc = await this.search.byId(id, turno.scopes);
            if (!doc) {
              salida.push(`ref ${ref}: ya no está disponible`);
              continue;
            }
            const r = await this.delivery.deliver(
              { chatId: turno.chatId, waId: turno.waId, origen: turno.mensajeId },
              doc,
              // Sin leyenda no se repite el nombre: el archivo ya lo lleva.
              leyenda,
              `No pude mandarte ${doc.name} por aquí. Pídemelo otra vez en un rato.`,
            );
            if (r.ok) {
              entregados += 1;
              await this.solicitudes.registrarEntrega(turno.conversationId, doc);
              salida.push(`ref ${ref}: en camino (${doc.name})`);
            } else {
              salida.push(`ref ${ref}: no se pudo (${r.reason === 'too_big' ? 'pesa demasiado para WhatsApp' : 'falló la descarga'})`);
            }
          }
          return salida.join('\n');
        }

        case 'estado_entregas': {
          if (!this.entregas) return 'sin información de entregas';
          const e = await this.entregas.estado(turno.chatId);
          return JSON.stringify({
            enviados: e.enviados.length,
            pendientes: e.pendientes,
            fallidos: e.fallidos,
          });
        }

        case 'pasar_a_persona': {
          const motivo = typeof entrada.motivo === 'string' ? entrada.motivo.slice(0, 200) : 'lo pidió el cliente';
          const { ticket, agente } = await this.tickets.abrirEscalado({
            conversationId: turno.conversationId,
            contactId: turno.contactId,
            organizationId: turno.scopes.length === 1 ? turno.scopes[0]!.organizationId : null,
            subject: motivo,
            slots: { origen: 'agente' },
            reason: 'pidio_humano',
          });
          return `ticket #${ticket.number} abierto${agente ? `; lo atiende ${agente.name}` : ''}`;
        }

        default:
          return `error: no existe la herramienta ${nombre}`;
      }
    };

    const texto = await this.llm.agente!({
      tarea: 'conversacion',
      system: instrucciones(turno, nombres, vistos),
      mensajes: [
        ...turno.history.map((h) => ({ rol: h.role, texto: h.text })),
        { rol: 'cliente' as const, texto: turno.texto },
      ],
      herramientas: HERRAMIENTAS,
      ejecutar,
      maxPasos: 8,
    });

    // Lo que vio en este turno queda numerado para "mándame la 3" después.
    const opciones: Opcion[] = [...vistos.entries()]
      .sort(([a], [b]) => a - b)
      .slice(-40)
      .map(([n, id]) => ({ n, tipo: 'documento', id, nombre: nombres.get(id) ?? '' }));
    await this.solicitudes.guardar(turno.conversationId, { opciones });

    if (!texto) {
      this.logger.warn(`agente sin respuesta en ${turno.chatId}`);
      // Si alcanzó a mandar algo, se dice; si no, sigue el flujo de reglas.
      return entregados > 0 ? `Te mandé ${entregados} documento${entregados === 1 ? '' : 's'}.` : null;
    }
    return texto;
  }
}

/** Exportadas para la demo pública: las mismas herramientas, sobre un archivero de ejemplo. */
export const HERRAMIENTAS: readonly HerramientaLlm[] = [
  {
    nombre: 'buscar_documentos',
    descripcion:
      'Busca en los documentos del cliente. "texto" son palabras que deben aparecer en el nombre o dentro del ' +
      'archivo (todas): nombres de personas, trámite ("alta", "baja", "finiquito", "SIPARE"), folio, empresa. ' +
      'Usa pocas palabras y las más distintivas. Si no hay resultados, vuelve a buscar con menos palabras, ' +
      'sinónimos, en singular o sin tipo/mes antes de decir que no hay. Devuelve total y los documentos con su "ref". ' +
      'Cada búsqueda REEMPLAZA la lista: las refs van del 1 en adelante y solo valen las de la última búsqueda.',
    esquema: {
      type: 'object',
      properties: {
        texto: { type: ['string', 'null'], description: 'Palabras clave. null para no filtrar por texto.' },
        tipo: {
          type: ['string', 'null'],
          enum: [...Object.keys(TIPOS), null],
          description: 'Solo si la persona dijo claramente el tipo. Tipos: ' +
            Object.entries(TIPOS).map(([k, v]) => `${k}=${v}`).join('; '),
        },
        mes: { type: ['string', 'null'], description: 'Mes del documento, "YYYY-MM". null para cualquier fecha.' },
        limite: { type: 'integer', minimum: 1, maximum: MAX_RESULTADOS },
      },
      required: ['texto', 'tipo', 'mes'],
      additionalProperties: false,
    },
  },
  {
    nombre: 'ver_inventario',
    descripcion: 'Cuántos documentos hay de cada tipo y de qué fechas. Para "¿qué tienes?" o para orientarte.',
    esquema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    nombre: 'entregar_documentos',
    descripcion:
      'Manda por WhatsApp los documentos con esas refs (de búsquedas de este turno o de la lista anterior), ' +
      'EN EL ORDEN EN QUE LA PERSONA LOS PIDIÓ ("del 5 al 14 y la 4" = 5,6,…,14,4). ' +
      `Máximo ${MAX_ENTREGA} por vez. Es la ÚNICA forma de mandar algo: solo di que mandaste lo que esta ` +
      'herramienta confirme como "en camino".',
    esquema: {
      type: 'object',
      properties: {
        refs: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: MAX_ENTREGA },
        leyenda: { type: 'string', description: 'Texto corto que acompaña cada archivo (opcional).' },
      },
      required: ['refs'],
      additionalProperties: false,
    },
  },
  {
    nombre: 'estado_entregas',
    descripcion: 'Qué documentos de las últimas 2 horas ya salieron, cuáles faltan y cuáles fallaron.',
    esquema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    nombre: 'pasar_a_persona',
    descripcion:
      'Abre un ticket para que alguien del equipo atienda. SOLO si pide hablar con una persona con esas palabras, ' +
      'si está molesto, o si ya buscaste al menos dos veces de distintas formas y no hay nada. Un pedido raro o ' +
      'mal escrito NO es motivo: busca lo que más se parezca o pregunta en una frase.',
    esquema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Qué necesita, en una frase.' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

function instrucciones(
  turno: TurnoAgente,
  nombres: ReadonlyMap<string, string>,
  vistos: ReadonlyMap<number, string>,
): string {
  const hoy = new Date();
  const lista = [...vistos.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-20)
    .map(([n, id]) => `ref ${n}: ${nombres.get(id) ?? id}`);
  return [
    `Eres el asistente de documentos por WhatsApp de ${turno.scopes.map((s) => s.organizationName).join(', ')}.`,
    `Hoy es ${hoy.toISOString().slice(0, 10)}. "Este mes" es ${hoy.toISOString().slice(0, 7)}.`,
    '',
    'Tu trabajo: entender qué documento quiere la persona, encontrarlo y mandárselo. Escribe como alguien del equipo: español de México, de tú, claro y corto. Muchas personas leen poco: frases cortas, sin tecnicismos.',
    '',
    'Cómo trabajar:',
    '- Busca SIEMPRE antes de contestar sobre documentos. Si no encuentras, intenta otra búsqueda (menos palabras, sinónimos, singular, sin mes o sin tipo) antes de rendirte.',
    '- Un solo resultado claro: mándalo. Varios: enséñalos numerados con su ref, en orden ("*1.* nombre — mes", "*2.* …") y pregunta cuál; si pidió "todos" o un rango, mándalos.',
    '- Los números que ve la persona SON las refs de la última búsqueda. No busques otra vez solo para mandar algo de la lista que ya vio: usa sus números.',
    '- Si el pedido se puede entender de dos formas, pregunta en una frase en vez de adivinar.',
    '- "La última", "la más reciente", "la nueva": busca sin mes (los resultados vienen del más reciente al más viejo) y toma la primera; "de cualquier empresa" = sin filtrar por empresa.',
    '- Muchos mensajes llegan de audios transcritos y pueden traer palabras mal oídas ("facturado" por "factura", "cargado" por "subido"): interpreta la intención más probable.',
    '- "Mándame la 3", "del 1 al 4", "todos": son refs de la lista que ya vio.',
    '- "Gracias", "listo", "ok": contesta corto y amable. No repitas lo que ya mandaste ni hables de números.',
    '- "¿Cómo va?", "¿ya salieron?": usa estado_entregas y di lo real.',
    '- Nunca digas que mandaste, estás mandando o vas a mandar algo que entregar_documentos no confirmó. Nunca prometas "voy a buscar": busca ahora.',
    '- No inventes documentos, fechas, cantidades ni trámites. Si no hay, dilo y ofrece alternativas reales de lo que sí encontraste.',
    '- Nada de enlaces. Usa *negritas* de WhatsApp solo para números de opción o un dato clave.',
    ...(lista.length > 0 ? ['', 'Lista que la persona ya vio:', ...lista] : []),
  ].join('\n');
}

function describir(ref: number, d: Document): Record<string, unknown> {
  return {
    ref,
    nombre: d.name,
    tipo: d.category,
    mes: mes(d.period),
    titular: d.counterpart ?? undefined,
    resumen: d.summary ? d.summary.slice(0, 160) : undefined,
  };
}

function mes(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 7) : null;
}

function aMes(valor: unknown): Date | null {
  if (typeof valor !== 'string') return null;
  const m = /^(20\d{2})-(\d{1,2})$/.exec(valor.trim());
  if (!m) return null;
  const n = Number(m[2]);
  return n >= 1 && n <= 12 ? new Date(Date.UTC(Number(m[1]), n - 1, 1)) : null;
}

function esTipo(valor: unknown): valor is DocCategory {
  return typeof valor === 'string' && valor in TIPOS;
}
