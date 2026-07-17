import { Inject, Injectable } from '@nestjs/common';
import type { Address } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export interface AddressInput {
  label: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  isDefault?: boolean;
}

@Injectable()
export class LocationsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findAllByUser(userId: string): Promise<Address[]> {
    return this.db.address.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  /** The user's default address, falling back to their oldest saved one. */
  async findDefaultForUser(userId: string): Promise<Address | null> {
    return this.db.address.findFirst({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** Scoped to [userId] so a mismatched owner behaves exactly like "not found". */
  async findByIdForUser(id: string, userId: string): Promise<Address | null> {
    return this.db.address.findFirst({ where: { id, userId } });
  }

  /** Creates the address, first clearing any existing default when [input.isDefault] is set. */
  async create(userId: string, input: AddressInput): Promise<Address> {
    return this.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: {
          userId,
          label: input.label,
          formattedAddress: input.formattedAddress,
          lat: input.lat,
          lng: input.lng,
          isDefault: input.isDefault ?? false,
        },
      });
    });
  }

  /** Updates [id], first clearing any existing default when [input.isDefault] is being set to true. */
  async update(id: string, userId: string, input: Partial<AddressInput>): Promise<Address> {
    return this.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.address.update({ where: { id }, data: input });
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.address.delete({ where: { id } });
  }
}
