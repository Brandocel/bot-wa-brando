import { Injectable } from '@nestjs/common';
import type { DocCategory, Document, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import type { OrgScope } from './access-scope.service';

/**
 * Búsqueda sobre el índice local de Drive.
 *
 * Recibe un alcance YA resuelto, nunca un waId: si esta clase no conoce al
 * solicitante, no puede filtrar mal por él. El WHERE se arma a partir del
 * alcance, así que un documento fuera de él es inalcanzable por construcción.
 *
 * Metadatos primero. "Factura de febrero 2026" es una consulta exacta
 * (categoría + periodo), no semántica. El texto completo es el plan B.
 */

export interface SearchQuery {
  category: DocCategory | null;
  /** Primer día del mes del documento. */
  period: Date | null;
  folio: string | null;
  /** Texto libre, para cuando los metadatos no alcanzan. */
  text: string | null;
  /** Fija la organización cuando el solicitante pertenece a varias. */
  organizationId?: string | null;
}

@Injectable()
export class DocumentSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    scopes: readonly OrgScope[],
    query: SearchQuery,
    limit = 5,
  ): Promise<Document[]> {
    const scoped = this.scopeFilter(scopes, query);
    if (scoped.length === 0) return [];

    const filters: Prisma.DocumentWhereInput[] = [];

    if (query.category) filters.push({ category: query.category });
    if (query.period) filters.push({ period: query.period });
    if (query.folio) {
      filters.push({ folio: { equals: query.folio, mode: 'insensitive' } });
    }
    if (query.text) {
      filters.push({
        OR: [
          { name: { contains: query.text, mode: 'insensitive' } },
          { extractedText: { contains: query.text, mode: 'insensitive' } },
        ],
      });
    }

    return this.prisma.document.findMany({
      where: {
        // QUARANTINE nunca se entrega: un archivo cuya organización no pudimos
        // determinar es exactamente el que no debe salir. DELETED tampoco.
        status: 'INDEXED',
        OR: scoped,
        AND: filters,
      },
      orderBy: [{ period: 'desc' }, { name: 'asc' }],
      take: limit,
    });
  }

  /**
   * Un documento por su id. Solo para reenviar algo YA entregado a esta
   * misma conversación: el permiso se comprobó cuando se entregó, y quien
   * llama pasa un id que salió de su propia bitácora, no del usuario.
   */
  async byId(id: string): Promise<Document | null> {
    return this.prisma.document.findFirst({
      where: { id, status: 'INDEXED' },
    });
  }

  /**
   * Traduce el alcance a condiciones SQL: una por (organización, categoría),
   * con su ventana de periodo. Si la consulta fija categoría u organización,
   * las condiciones que no apliquen se descartan aquí y no llegan a la base.
   */
  private scopeFilter(
    scopes: readonly OrgScope[],
    query: SearchQuery,
  ): Prisma.DocumentWhereInput[] {
    const conditions: Prisma.DocumentWhereInput[] = [];

    for (const scope of scopes) {
      if (query.organizationId && scope.organizationId !== query.organizationId) {
        continue;
      }

      for (const window of scope.windows) {
        if (query.category && window.category !== query.category) continue;

        const condition: Prisma.DocumentWhereInput = {
          organizationId: scope.organizationId,
          category: window.category,
        };

        if (window.periodFrom || window.periodTo) {
          condition.period = {
            ...(window.periodFrom ? { gte: window.periodFrom } : {}),
            ...(window.periodTo ? { lte: window.periodTo } : {}),
          };
        }

        conditions.push(condition);
      }
    }

    return conditions;
  }
}
