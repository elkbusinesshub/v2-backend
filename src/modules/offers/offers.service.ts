import { Injectable } from '@nestjs/common';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { UsersRepository } from '@/modules/users/users.repository';
import { REWARD_POINTS_PER_AED } from './offers.constants';
import type { CreateOfferDto } from './offers.dto';
import { toOfferJson } from './offers.mapper';
import { OffersRepository } from './offers.repository';

@Injectable()
export class OffersService {
  constructor(
    private readonly offers: OffersRepository,
    private readonly users: UsersRepository,
  ) {}

  async getOffersPage(user: AuthUser): Promise<Record<string, unknown>> {
    const account = await this.users.findById(user.id);
    if (!account) {
      throw new ResourceNotFoundException('User');
    }
    const offers = await this.offers.listActive();
    const aed = Math.floor(account.rewardPoints / REWARD_POINTS_PER_AED);

    return {
      rewardPoints: account.rewardPoints,
      rewardDiscountLabel: `≈ AED ${aed} discount available`,
      offers: offers.map(toOfferJson),
    };
  }

  async createOffer(dto: CreateOfferDto): Promise<Record<string, unknown>> {
    const offer = await this.offers.create(dto);
    return toOfferJson(offer);
  }
}
