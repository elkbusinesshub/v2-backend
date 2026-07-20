import { Inject, Injectable } from '@nestjs/common';
import type { PorterAddon, PorterVehicle } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class PorterCatalogRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async listActiveVehicles(): Promise<PorterVehicle[]> {
    return this.db.porterVehicle.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findActiveVehicleBySlug(slug: string): Promise<PorterVehicle | null> {
    return this.db.porterVehicle.findFirst({ where: { slug, isActive: true } });
  }

  async listActiveAddons(): Promise<PorterAddon[]> {
    return this.db.porterAddon.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findActiveAddonsByKeys(keys: string[]): Promise<PorterAddon[]> {
    if (keys.length === 0) return [];
    return this.db.porterAddon.findMany({ where: { key: { in: keys }, isActive: true } });
  }
}
