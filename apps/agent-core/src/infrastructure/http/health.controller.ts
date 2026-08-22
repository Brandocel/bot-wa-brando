import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  async health(): Promise<{ ok: boolean; db: boolean }> {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    return { ok: true, db };
  }
}
