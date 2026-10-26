import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { separarChat } from '../../domain/message/linea';

const VIGENCIA_MS = 10 * 60 * 1000;

/**
 * Las palabras que una cuenta usa seguido, para que la transcripción las
 * reconozca: el nombre de la empresa, a nombre de quién van sus documentos
 * y lo que vende. Whisper acierta mucho más con un nombre propio cuando lo
 * "esperaba".
 *
 * Por la línea de una empresa o persona: lo de esa cuenta. Por el número
 * principal no hay una cuenta clara, y va sin pistas.
 */
@Injectable()
export class PistasVozService {
  private readonly cache = new Map<string, { texto: string; hasta: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** ¿La cuenta de esta línea tiene la herramienta Voz? Sin línea, no. */
  async vozPermitida(chatId: string): Promise<boolean> {
    const linea = separarChat(chatId).linea;
    if (!linea) return false;
    const org = await this.prisma.organization.findUnique({ where: { waLineId: linea }, select: { herramientas: true } });
    return org?.herramientas.includes('VOZ') ?? false;
  }

  async para(chatId: string): Promise<string> {
    const linea = separarChat(chatId).linea;
    if (!linea) return '';
    const guardada = this.cache.get(linea);
    if (guardada && guardada.hasta > Date.now()) return guardada.texto;

    try {
      const org = await this.prisma.organization.findUnique({ where: { waLineId: linea }, select: { id: true, name: true } });
      if (!org) return '';
      const [titulares, productos] = await Promise.all([
        this.prisma.document.groupBy({
          by: ['counterpart'],
          where: { organizationId: org.id, status: 'INDEXED', counterpart: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { counterpart: 'desc' } },
          take: 40,
        }),
        this.prisma.product.findMany({
          where: { organizationId: org.id, active: true },
          select: { name: true },
          orderBy: { sortOrder: 'asc' },
          take: 25,
        }),
      ]);
      const texto = armarPistas(
        org.name,
        titulares.map((t) => t.counterpart!),
        productos.map((p) => p.name),
      );
      this.cache.set(linea, { texto, hasta: Date.now() + VIGENCIA_MS });
      return texto;
    } catch {
      return '';
    }
  }
}

/** "Somos del Mundo. Abner Neftali García, Raymundo Vázquez. Pollo entero, Papas." — corto y sin repetidos. */
export function armarPistas(empresa: string, titulares: readonly string[], productos: readonly string[]): string {
  const limpia = (xs: readonly string[]) =>
    [...new Set(xs.map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 3 && x.length <= 60))];
  return [empresa, limpia(titulares).join(', '), limpia(productos).join(', ')]
    .filter(Boolean)
    .join('. ')
    .slice(0, 900);
}
