import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { UsersRepository } from '@/modules/users/users.repository';
import { OffersRepository } from '@/modules/offers/offers.repository';
import { OffersService } from '@/modules/offers/offers.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const account = {
  id: 'u-1',
  phone: '+971500000001',
  email: null,
  name: 'Demo User',
  roles: [Role.USER],
  language: 'en',
  rewardPoints: 150,
  walletBalance: new Prisma.Decimal(0),
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const offer = {
  id: 'o-1',
  tagLabel: 'FOR NEW USERS',
  title: 'Welcome Offer',
  description: 'Get 20% off your first booking on any service category',
  code: 'ELK20',
  expiryLabel: 'Expires 31 May 2026',
  discountLabel: '20%',
  discountSubLabel: 'OFF',
  gradientStartHex: 0xff0d3d35,
  gradientEndHex: 0xff4bbfb0,
  sortOrder: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OffersService', () => {
  let service: OffersService;
  let offers: jest.Mocked<OffersRepository>;
  let users: jest.Mocked<UsersRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OffersService,
        {
          provide: OffersRepository,
          useValue: { listActive: jest.fn().mockResolvedValue([offer]), create: jest.fn() },
        },
        {
          provide: UsersRepository,
          useValue: { findById: jest.fn().mockResolvedValue(account) },
        },
      ],
    }).compile();

    service = moduleRef.get(OffersService);
    offers = moduleRef.get(OffersRepository);
    users = moduleRef.get(UsersRepository);
  });

  it('computes the AED-equivalent discount label from reward points', async () => {
    const page = await service.getOffersPage(user);
    expect(page).toMatchObject({
      rewardPoints: 150,
      rewardDiscountLabel: '≈ AED 15 discount available',
    });
    const offerList = page.offers as Record<string, unknown>[];
    expect(offerList[0]).toMatchObject({ code: 'ELK20', discountLabel: '20%' });
  });

  it('floors an uneven points-to-AED conversion', async () => {
    users.findById.mockResolvedValue({ ...account, rewardPoints: 47 });
    const page = await service.getOffersPage(user);
    expect(page.rewardDiscountLabel).toBe('≈ AED 4 discount available');
  });

  it('404s a deleted/missing account', async () => {
    users.findById.mockResolvedValue(null);
    await expect(service.getOffersPage(user)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('creates an offer banner (admin)', async () => {
    offers.create.mockResolvedValue(offer);
    const dto = {
      tagLabel: 'FLASH',
      title: 'Flash Sale',
      description: 'desc',
      code: 'FLASH10',
      expiryLabel: 'Today only',
      discountLabel: '10%',
      discountSubLabel: 'OFF',
      gradientStartHex: 0xff000000,
      gradientEndHex: 0xffffffff,
    };
    await service.createOffer(dto);
    expect(offers.create).toHaveBeenCalledWith(dto);
  });
});
