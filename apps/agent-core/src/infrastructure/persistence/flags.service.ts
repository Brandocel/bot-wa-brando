import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export const FLAG_PAUSED = 'paused';
/** Lista de números (waId) que reciben respuesta. Vacía = todos. */
export const FLAG_SOLO_NUMEROS = 'solo_numeros';

/**
 * Banderas de operación, persistidas en `SystemFlag`.
 *
 * Van en la base y no en memoria a propósito: si el proceso se reinicia
 * mientras el bot está en pausa, tiene que seguir en pausa. Un kill switch
 * que se olvida al reiniciar no es un kill switch.
 *
 * Caché corta porque esto se consulta en CADA mensaje entrante y casi nunca
 * cambia. 5 segundos es suficiente para que `/pausa` se sienta inmediato sin
 * pegarle a Postgres en cada turno.
 */
@Injectable()
export class FlagsService {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly TTL_MS = 5_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;

    const row = await this.prisma.systemFlag.findUnique({ where: { key } });
    const value = (row?.value ?? fallback) as T;

    this.cache.set(key, { value, expiresAt: Date.now() + FlagsService.TTL_MS });
    return value;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.prisma.systemFlag.upsert({
      where: { key },
      create: { key, value: value as object },
      update: { value: value as object },
    });
    // Invalida ya: quien acaba de escribir /pausa espera que sea al instante.
    this.cache.delete(key);
  }

  isPaused(): Promise<boolean> {
    return this.get<boolean>(FLAG_PAUSED, false);
  }

  setPaused(paused: boolean): Promise<void> {
    return this.set(FLAG_PAUSED, paused);
  }

  async soloNumeros(): Promise<string[]> {
    const v = await this.get<unknown>(FLAG_SOLO_NUMEROS, []);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  setSoloNumeros(waIds: string[]): Promise<void> {
    return this.set(FLAG_SOLO_NUMEROS, waIds);
  }
}
