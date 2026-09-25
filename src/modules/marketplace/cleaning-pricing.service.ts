import { Injectable } from '@nestjs/common';
import type { CleaningPrice } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { CleaningPricingRepository } from './cleaning-pricing.repository';
import type { CleaningPriceDto, UpdateCleaningPriceDto } from './marketplace.dto';

/** The tile a cleaning listing sits under when the seller did not pick one. */
export const DEFAULT_CLEANING_SUB_CATEGORY = 'cln';

/** What an hourly job (cleaning, repair) costs, split the way the order stores it. */
export interface HourlyQuote {
  /** `hourlyRate × hours × professionals` — the order's `amount`. */
  amount: number;
  /** The materials fee, or zero when the buyer has their own — the order's `feesAmount`. */
  feesAmount: number;
}

/**
 * Admin-set cleaning prices, and the one place a cleaning job is priced.
 *
 * The app shows the same arithmetic live as the buyer changes hours and
 * professionals, but the order is priced here from the stored rates — the
 * buyer's device does not get to say what it owes.
 */
@Injectable()
export class CleaningPricingService {
  constructor(private readonly prices: CleaningPricingRepository) {}

  async list(): Promise<CleaningPriceDto[]> {
    return (await this.prices.list()).map((p) => this.toJson(p));
  }

  async update(subCategory: string, dto: UpdateCleaningPriceDto): Promise<CleaningPriceDto> {
    return this.toJson(await this.prices.upsert(subCategory, dto.hourlyRate, dto.materialsFee));
  }

  async quote(
    subCategory: string,
    hours: number,
    professionals: number,
    withMaterials: boolean,
  ): Promise<HourlyQuote> {
    const price = await this.prices.find(subCategory);
    if (!price) {
      throw new ResourceNotFoundException('Cleaning price');
    }
    return {
      amount: Number(price.hourlyRate) * hours * professionals,
      feesAmount: withMaterials ? Number(price.materialsFee) : 0,
    };
  }

  private toJson(price: CleaningPrice): CleaningPriceDto {
    return {
      subCategory: price.subCategory,
      hourlyRate: Number(price.hourlyRate),
      materialsFee: Number(price.materialsFee),
    };
  }
}
