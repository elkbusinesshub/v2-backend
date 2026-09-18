import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DomainException,
  ForbiddenResourceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { PartnerSetupRepository, type StaffRow } from './partner-setup.repository';
import { districtName } from './service-requests.mapper';
import type {
  AddStaffDto,
  UpdateCleaningSetupDto,
  UpdateRentalSetupDto,
} from './service-requests.dto';

type Json = Record<string, unknown>;

/**
 * What a partner offers, and who works for them.
 *
 * Cleaning: the districts covered and a price per service type. Rental: the
 * shop's address and pin, a delivery fee, and how many of each vehicle type at
 * what price per day. Both are replaced whole on save — the screen edits the
 * full set at once.
 */
@Injectable()
export class PartnerSetupService {
  constructor(private readonly setup: PartnerSetupRepository) {}

  async get(user: AuthUser): Promise<Json> {
    const row = await this.setup.findSetup(user.id);
    const shop = row.rentalShop;
    return {
      // Whether requests can reach this partner at all, so the screen can say
      // why none are arriving.
      profileStatus: row.profile?.status ?? null,
      isAvailable: row.profile?.isAvailable ?? false,
      businessName: row.profile?.businessName ?? null,
      cleaning: {
        districts: row.districts.map((slug) => ({ slug, name: districtName(slug) })),
        services: row.cleaningServices,
      },
      rental: {
        shop: shop
          ? {
              address: shop.address,
              lat: Number(shop.lat),
              lng: Number(shop.lng),
              deliveryFee: Number(shop.deliveryFee),
            }
          : null,
        vehicles: row.rentalVehicles,
      },
    };
  }

  async updateCleaning(user: AuthUser, dto: UpdateCleaningSetupDto): Promise<Json> {
    const districts = [...new Set(dto.districts)];
    this.assertUnique(
      dto.services.map((s) => s.serviceType),
      'services',
    );
    await this.setup.replaceCleaning(user.id, districts, dto.services);
    return this.get(user);
  }

  async updateRental(user: AuthUser, dto: UpdateRentalSetupDto): Promise<Json> {
    this.assertUnique(
      dto.vehicles.map((v) => v.vehicleType),
      'vehicles',
    );
    await this.setup.replaceRental(
      user.id,
      { address: dto.address, lat: dto.lat, lng: dto.lng, deliveryFee: dto.deliveryFee },
      dto.vehicles,
    );
    return this.get(user);
  }

  // ─── staff ─────────────────────────────────────────────────────────────────

  async listStaff(user: AuthUser): Promise<Json[]> {
    return (await this.setup.listStaff(user.id)).map(toStaffJson);
  }

  /**
   * Adds a staff login. The staff member signs in with this phone number like
   * anyone else; an account is created for a number ELK has not seen.
   */
  async addStaff(user: AuthUser, dto: AddStaffDto): Promise<Json> {
    const account = await this.setup.findOrCreateUserByPhone(dto.phone);
    if (account.id === user.id) {
      throw new ValidationFailedException([
        { field: 'phone', message: 'You cannot add yourself as staff' },
      ]);
    }
    try {
      return toStaffJson(await this.setup.addStaff(user.id, account.id, dto.name.trim()));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DomainException(
          HttpStatus.CONFLICT,
          'STAFF_EXISTS',
          'This person is already on your staff',
        );
      }
      throw err;
    }
  }

  async removeStaff(user: AuthUser, id: string): Promise<void> {
    const staff = await this.setup.findStaff(id);
    if (!staff) throw new ResourceNotFoundException('Staff member');
    if (staff.sellerId !== user.id) throw new ForbiddenResourceException('Not one of your staff');
    await this.setup.removeStaff(id);
  }

  /** The partners this user is staff for — empty for everyone else. */
  async staffOf(user: AuthUser): Promise<Json[]> {
    return this.setup.sellersOfStaff(user.id);
  }

  private assertUnique(values: string[], field: string): void {
    if (new Set(values).size !== values.length) {
      throw new ValidationFailedException([
        { field, message: `${field} lists the same type twice` },
      ]);
    }
  }
}

function toStaffJson(row: StaffRow): Json {
  return {
    id: row.id,
    name: row.name,
    phone: row.staffUser.phone,
    createdAt: row.createdAt.toISOString(),
  };
}
