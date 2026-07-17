import { Injectable } from '@nestjs/common';
import type { Address } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { CreateAddressDto, UpdateAddressDto } from './locations.dto';
import { LocationsRepository } from './locations.repository';

@Injectable()
export class LocationsService {
  constructor(private readonly locations: LocationsRepository) {}

  async list(userId: string): Promise<Address[]> {
    return this.locations.findAllByUser(userId);
  }

  async create(userId: string, dto: CreateAddressDto): Promise<Address> {
    return this.locations.create(userId, dto);
  }

  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<Address> {
    await this.requireOwned(userId, id);
    return this.locations.update(id, userId, dto);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.locations.remove(id);
  }

  /** Ownership check: a mismatched owner is indistinguishable from "doesn't exist". */
  private async requireOwned(userId: string, id: string): Promise<Address> {
    const address = await this.locations.findByIdForUser(id, userId);
    if (!address) {
      throw new ResourceNotFoundException('Address');
    }
    return address;
  }
}
