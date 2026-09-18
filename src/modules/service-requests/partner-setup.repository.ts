import { Inject, Injectable } from '@nestjs/common';
import type { ProviderProfile, RentalShop, SellerStaff, User } from '@prisma/client';
import { Role } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export interface PartnerSetupRow {
  profile: Pick<ProviderProfile, 'status' | 'isAvailable' | 'businessName'> | null;
  districts: string[];
  cleaningServices: { serviceType: string; price: number }[];
  rentalShop: RentalShop | null;
  rentalVehicles: { vehicleType: string; quantity: number; pricePerDay: number }[];
}

export type StaffRow = SellerStaff & { staffUser: Pick<User, 'phone' | 'name'> };

@Injectable()
export class PartnerSetupRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findSetup(sellerId: string): Promise<PartnerSetupRow> {
    const [profile, districts, services, shop, vehicles] = await Promise.all([
      this.db.providerProfile.findUnique({
        where: { userId: sellerId },
        select: { status: true, isAvailable: true, businessName: true },
      }),
      this.db.partnerDistrict.findMany({ where: { sellerId }, orderBy: { district: 'asc' } }),
      this.db.cleaningServicePrice.findMany({ where: { sellerId } }),
      this.db.rentalShop.findUnique({ where: { sellerId } }),
      this.db.rentalVehicle.findMany({ where: { sellerId } }),
    ]);
    return {
      profile,
      districts: districts.map((d) => d.district),
      cleaningServices: services.map((s) => ({
        serviceType: s.serviceType,
        price: Number(s.price),
      })),
      rentalShop: shop,
      rentalVehicles: vehicles.map((v) => ({
        vehicleType: v.vehicleType,
        quantity: v.quantity,
        pricePerDay: Number(v.pricePerDay),
      })),
    };
  }

  /** Replaces the partner's districts and prices whole. */
  async replaceCleaning(
    sellerId: string,
    districts: string[],
    services: { serviceType: string; price: number }[],
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // Raw deletes: the soft-delete extension sends `deleteMany` through the
      // base client, outside this transaction, where it waits on this
      // transaction's own locks.
      await tx.$executeRaw`DELETE FROM partner_districts WHERE sellerId = ${sellerId}`;
      await tx.$executeRaw`DELETE FROM cleaning_service_prices WHERE sellerId = ${sellerId}`;
      await tx.partnerDistrict.createMany({
        data: districts.map((district) => ({ sellerId, district })),
      });
      await tx.cleaningServicePrice.createMany({
        data: services.map((s) => ({ sellerId, serviceType: s.serviceType, price: s.price })),
      });
    });
  }

  async replaceRental(
    sellerId: string,
    shop: { address: string; lat: number; lng: number; deliveryFee: number },
    vehicles: { vehicleType: string; quantity: number; pricePerDay: number }[],
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.rentalShop.upsert({
        where: { sellerId },
        create: { sellerId, ...shop },
        update: shop,
      });
      // Raw for the same reason as in replaceCleaning.
      await tx.$executeRaw`DELETE FROM rental_vehicles WHERE sellerId = ${sellerId}`;
      await tx.rentalVehicle.createMany({ data: vehicles.map((v) => ({ sellerId, ...v })) });
    });
  }

  // ─── staff ─────────────────────────────────────────────────────────────────

  async listStaff(sellerId: string): Promise<StaffRow[]> {
    return this.db.sellerStaff.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'asc' },
      include: { staffUser: { select: { phone: true, name: true } } },
    });
  }

  async findStaff(id: string): Promise<SellerStaff | null> {
    return this.db.sellerStaff.findUnique({ where: { id } });
  }

  async findStaffMembership(sellerId: string, staffUserId: string): Promise<SellerStaff | null> {
    return this.db.sellerStaff.findUnique({
      where: { sellerId_staffUserId: { sellerId, staffUserId } },
    });
  }

  /** The sellers this user works for, with the name the buyer knows them by. */
  async sellersOfStaff(
    staffUserId: string,
  ): Promise<{ sellerId: string; sellerName: string; staffName: string }[]> {
    const rows = await this.db.sellerStaff.findMany({
      where: { staffUserId },
      include: {
        seller: { select: { name: true, providerProfile: { select: { businessName: true } } } },
      },
    });
    return rows.map((r) => ({
      sellerId: r.sellerId,
      sellerName: r.seller.providerProfile?.businessName ?? r.seller.name ?? 'ELK partner',
      staffName: r.name,
    }));
  }

  /** The staff member's account, created bare when their phone is new to ELK. */
  async findOrCreateUserByPhone(phone: string): Promise<User> {
    const existing = await this.db.user.findFirst({ where: { phone } });
    return existing ?? this.db.user.create({ data: { phone, roles: [Role.USER] } });
  }

  async addStaff(sellerId: string, staffUserId: string, name: string): Promise<StaffRow> {
    return this.db.sellerStaff.create({
      data: { sellerId, staffUserId, name },
      include: { staffUser: { select: { phone: true, name: true } } },
    });
  }

  async removeStaff(id: string): Promise<void> {
    await this.db.sellerStaff.delete({ where: { id } });
  }
}
