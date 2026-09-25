import { Test } from '@nestjs/testing';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { CleaningPricingRepository } from '@/modules/marketplace/cleaning-pricing.repository';
import { CleaningPricingService } from '@/modules/marketplace/cleaning-pricing.service';

const bathroom = {
  subCategory: 'bth',
  hourlyRate: 79 as never,
  materialsFee: 20 as never,
  updatedAt: new Date(),
};

describe('CleaningPricingService', () => {
  let service: CleaningPricingService;
  let prices: jest.Mocked<CleaningPricingRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CleaningPricingService,
        {
          provide: CleaningPricingRepository,
          useValue: {
            list: jest.fn().mockResolvedValue([bathroom]),
            find: jest.fn().mockResolvedValue(bathroom),
            upsert: jest.fn().mockResolvedValue({ ...bathroom, hourlyRate: 99 as never }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(CleaningPricingService);
    prices = moduleRef.get(CleaningPricingRepository);
  });

  it('charges the hourly rate for every hour and every professional', async () => {
    await expect(service.quote('bth', 3, 2, false)).resolves.toEqual({
      amount: 474,
      feesAmount: 0,
    });
  });

  it('adds the materials fee only when the crew brings them', async () => {
    await expect(service.quote('bth', 1, 1, true)).resolves.toEqual({
      amount: 79,
      feesAmount: 20,
    });
  });

  it('refuses to price a tile with no admin price', async () => {
    prices.find.mockResolvedValue(null);
    await expect(service.quote('crp', 1, 1, false)).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });

  it('lists prices as plain numbers', async () => {
    await expect(service.list()).resolves.toEqual([
      { subCategory: 'bth', hourlyRate: 79, materialsFee: 20 },
    ]);
  });

  it('saves an admin update', async () => {
    const saved = await service.update('bth', { hourlyRate: 99, materialsFee: 20 });
    expect(prices.upsert).toHaveBeenCalledWith('bth', 99, 20);
    expect(saved.hourlyRate).toBe(99);
  });
});
