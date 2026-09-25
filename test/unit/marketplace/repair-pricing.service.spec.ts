import { Test } from '@nestjs/testing';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { RepairPricingRepository } from '@/modules/marketplace/repair-pricing.repository';
import { RepairPricingService } from '@/modules/marketplace/repair-pricing.service';

const plumbing = {
  subCategory: 'plm',
  hourlyRate: 79 as never,
  partsFee: 20 as never,
  updatedAt: new Date(),
};

describe('RepairPricingService', () => {
  let service: RepairPricingService;
  let prices: jest.Mocked<RepairPricingRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RepairPricingService,
        {
          provide: RepairPricingRepository,
          useValue: {
            list: jest.fn().mockResolvedValue([plumbing]),
            find: jest.fn().mockResolvedValue(plumbing),
            upsert: jest.fn().mockResolvedValue({ ...plumbing, hourlyRate: 99 as never }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RepairPricingService);
    prices = moduleRef.get(RepairPricingRepository);
  });

  it('charges the hourly rate for every hour and every technician', async () => {
    await expect(service.quote('plm', 3, 2, false)).resolves.toEqual({
      amount: 474,
      feesAmount: 0,
    });
  });

  it('adds the parts fee only when the technician brings them', async () => {
    await expect(service.quote('plm', 1, 1, true)).resolves.toEqual({
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
      { subCategory: 'plm', hourlyRate: 79, partsFee: 20 },
    ]);
  });

  it('saves an admin update', async () => {
    const saved = await service.update('plm', { hourlyRate: 99, partsFee: 20 });
    expect(prices.upsert).toHaveBeenCalledWith('plm', 99, 20);
    expect(saved.hourlyRate).toBe(99);
  });
});
