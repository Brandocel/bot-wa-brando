import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sin base de datos el core no atiende nada: ni registra entrantes ni
   * despacha el outbox. Un 200 aquí hacía que Render lo diera por sano;
   * con 503 lo marca caído y lo reinicia.
   */
  @Get('healthz')
  async health(): Promise<{ ok: boolean; db: boolean }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: false });
    }
    return { ok: true, db: true };
  }
}
