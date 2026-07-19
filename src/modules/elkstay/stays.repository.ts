import { Inject, Injectable } from '@nestjs/common';
import { Prisma, StayCategoryType, type Stay, type StayCoupon } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { StayWithAmenities, StayWithDetail } from './elkstay.mapper';

export interface StayListFilters {
  category?: StayCategoryType;
  verified?: boolean;
  maxPrice?: number;
  roomType?: string;
  meals?: boolean;
  search?: string;
  skip: number;
  take: number;
}

export interface StayWriteData {
  name: string;
  categoryType: StayCategoryType;
  badge: string;
  roomType: string;
  location: string;
  fullAddress: string;
  distanceKm: number;
  latitude?: number;
  longitude?: number;
  description: string;
  gradientStart: bigint;
  gradientEnd: bigint;
  pricePerMonth: number;
  amenities: { iconKey: string; label: string }[];
  roomOptions: { kind: string; subtitle: string; pricePerMonth: number }[];
}

@Injectable()
export class StaysRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  private listWhere(f: StayListFilters): Prisma.StayWhereInput {
    return {
      ...(f.category ? { categoryType: f.category } : {}),
      ...(f.verified !== undefined ? { isVerified: f.verified } : {}),
      ...(f.maxPrice !== undefined ? { pricePerMonth: { lte: f.maxPrice } } : {}),
      // MySQL's default collation is case-insensitive — no `mode` needed (and
      // Prisma doesn't support it on MySQL)
      ...(f.roomType ? { roomType: { contains: f.roomType } } : {}),
      ...(f.meals ? { amenities: { some: { iconKey: 'meals' } } } : {}),
      ...(f.search
        ? {
            OR: [
              { name: { contains: f.search } },
              { location: { contains: f.search } },
              { fullAddress: { contains: f.search } },
            ],
          }
        : {}),
    };
  }

  async list(f: StayListFilters): Promise<{ items: StayWithAmenities[]; total: number }> {
    const where = this.listWhere(f);
    const [items, total] = await Promise.all([
      this.db.stay.findMany({
        where,
        include: { amenities: true },
        orderBy: [{ rating: 'desc' }, { name: 'asc' }],
        skip: f.skip,
        take: f.take,
      }),
      this.db.stay.count({ where }),
    ]);
    return { items, total };
  }

  async topRated(limit: number): Promise<StayWithAmenities[]> {
    return this.db.stay.findMany({
      where: { isVerified: true },
      include: { amenities: true },
      orderBy: [{ rating: 'desc' }, { name: 'asc' }],
      take: limit,
    });
  }

  async categoryCounts(): Promise<Record<StayCategoryType, number>> {
    const rows = await this.db.stay.groupBy({ by: ['categoryType'], _count: { _all: true } });
    const counts = Object.fromEntries(Object.values(StayCategoryType).map((c) => [c, 0])) as Record<
      StayCategoryType,
      number
    >;
    for (const row of rows) {
      counts[row.categoryType] = row._count._all;
    }
    return counts;
  }

  /** findFirst so the soft-delete filter applies. */
  async findDetailById(id: string): Promise<StayWithDetail | null> {
    return this.db.stay.findFirst({
      where: { id },
      include: { amenities: true, roomOptions: true },
    });
  }

  async findById(id: string): Promise<Stay | null> {
    return this.db.stay.findFirst({ where: { id } });
  }

  /** Includes soft-deleted rows on purpose — a deleted stay still owns its slug. */
  async findBySlug(slug: string): Promise<Stay | null> {
    return this.db.stay.findUnique({ where: { slug } });
  }

  async findRoomOption(id: string) {
    return this.db.stayRoomOption.findUnique({ where: { id } });
  }

  async create(providerId: string, slug: string, data: StayWriteData): Promise<StayWithDetail> {
    const { amenities, roomOptions, ...stay } = data;
    return this.db.stay.create({
      data: {
        ...stay,
        slug,
        providerId,
        amenities: { create: amenities.map((a, i) => ({ ...a, sortOrder: i })) },
        roomOptions: { create: roomOptions.map((r, i) => ({ ...r, sortOrder: i })) },
      },
      include: { amenities: true, roomOptions: true },
    });
  }

  /**
   * Replaces amenities/room options atomically with the stay row update —
   * a partial failure must never leave a stay without its child rows.
   */
  async update(id: string, data: Partial<StayWriteData>): Promise<StayWithDetail> {
    const { amenities, roomOptions, ...stay } = data;
    return this.db.$transaction(async (tx) => {
      if (amenities) {
        await tx.stayAmenity.deleteMany({ where: { stayId: id } });
        await tx.stayAmenity.createMany({
          data: amenities.map((a, i) => ({ ...a, stayId: id, sortOrder: i })),
        });
      }
      if (roomOptions) {
        await tx.stayRoomOption.deleteMany({ where: { stayId: id } });
        await tx.stayRoomOption.createMany({
          data: roomOptions.map((r, i) => ({ ...r, stayId: id, sortOrder: i })),
        });
      }
      return tx.stay.update({
        where: { id },
        data: stay,
        include: { amenities: true, roomOptions: true },
      });
    });
  }

  /** Soft delete via the client extension (delete → deletedAt stamp). */
  async softDelete(id: string): Promise<void> {
    await this.db.stay.delete({ where: { id } });
  }

  async setVerified(id: string, isVerified: boolean): Promise<Stay> {
    return this.db.stay.update({ where: { id }, data: { isVerified } });
  }

  // ─── favorites ─────────────────────────────────────────────────────────────

  /** Idempotent: favoriting twice is a no-op, not an error. */
  async addFavorite(userId: string, stayId: string): Promise<void> {
    await this.db.stayFavorite.upsert({
      where: { userId_stayId: { userId, stayId } },
      update: {},
      create: { userId, stayId },
    });
  }

  async removeFavorite(userId: string, stayId: string): Promise<void> {
    await this.db.stayFavorite.deleteMany({ where: { userId, stayId } });
  }

  async isFavorite(userId: string, stayId: string): Promise<boolean> {
    const row = await this.db.stayFavorite.findUnique({
      where: { userId_stayId: { userId, stayId } },
    });
    return row !== null;
  }

  async listFavorites(userId: string): Promise<StayWithAmenities[]> {
    const rows = await this.db.stayFavorite.findMany({
      where: { userId, stay: { deletedAt: null } },
      include: { stay: { include: { amenities: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => r.stay);
  }

  // ─── coupons ───────────────────────────────────────────────────────────────

  async findActiveCoupon(code: string): Promise<StayCoupon | null> {
    return this.db.stayCoupon.findFirst({ where: { code, isActive: true } });
  }
}
