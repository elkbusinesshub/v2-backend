import { Inject, Injectable } from '@nestjs/common';
import type { AdminModule } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class AdminAccessRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async modules(userId: string): Promise<AdminModule[]> {
    const rows = await this.db.adminModuleAccess.findMany({
      where: { userId },
      select: { module: true },
    });
    return rows.map((r) => r.module);
  }
}
