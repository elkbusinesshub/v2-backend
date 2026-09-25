import { Injectable } from '@nestjs/common';
import type { RepairPrice } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { HourlyQuote } from './cleaning-pricing.service';
import type { RepairPriceDto, UpdateRepairPriceDto } from './marketplace.dto';
import { RepairPricingRepository } from './repair-pricing.repository';

/** The tile a repair listing sits under when the seller did not pick one. */
export const DEFAULT_REPAIR_SUB_CATEGORY = 'gen';

/**
 * Admin-set repair prices, and the one place a repair visit is priced — the
 * same arithmetic as cleaning, with spare parts in place of materials.
 */
@Injectable()
export class RepairPricingService {
  constructor(private readonly prices: RepairPricingRepository) {}

  async list(): Promise<RepairPriceDto[]> {
    return (await this.prices.list()).map((p) => this.toJson(p));
  }

  async update(subCategory: string, dto: UpdateRepairPriceDto): Promise<RepairPriceDto> {
    return this.toJson(await this.prices.upsert(subCategory, dto.hourlyRate, dto.partsFee));
  }

  async quote(
    subCategory: string,
    hours: number,
    technicians: number,
    withParts: boolean,
  ): Promise<HourlyQuote> {
    const price = await this.prices.find(subCategory);
    if (!price) {
      throw new ResourceNotFoundException('Repair price');
    }
    return {
      amount: Number(price.hourlyRate) * hours * technicians,
      feesAmount: withParts ? Number(price.partsFee) : 0,
    };
  }

  private toJson(price: RepairPrice): RepairPriceDto {
    return {
      subCategory: price.subCategory,
      hourlyRate: Number(price.hourlyRate),
      partsFee: Number(price.partsFee),
    };
  }
}
