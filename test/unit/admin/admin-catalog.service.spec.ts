import { Test } from '@nestjs/testing';
import { Prisma, ServiceVertical } from '@prisma/client';
import {
  DomainException,
  DuplicateResourceException,
  ForbiddenResourceException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { AdminCatalogService } from '@/modules/admin/admin-catalog.service';
import { AdminRepository } from '@/modules/admin/admin.repository';
import { ServiceChangeRepository } from '@/modules/admin/service-change.repository';
import { PlacesService } from '@/modules/places/places.service';

const newService = {
  vertical: ServiceVertical.CLEANING,
  category: 'bth',
  name: 'Bathroom deep clean',
  description: '',
  minHours: 2,
  hourlyRate: 349,
  extraProRate: 299,
  materialsFee: 149,
};

const liveService = {
  id: 's-1',
  ...newService,
  hourlyRate: new Prisma.Decimal(349),
  extraProRate: new Prisma.Decimal(299),
  materialsFee: new Prisma.Decimal(149),
  active: true,
  online: true,
  approved: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BOTH = [ServiceVertical.CLEANING, ServiceVertical.REPAIR];

describe('AdminCatalogService', () => {
  let svc: AdminCatalogService;
  let repo: jest.Mocked<AdminRepository>;
  let changes: jest.Mocked<ServiceChangeRepository>;
  let places: jest.Mocked<PlacesService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminCatalogService,
        {
          provide: AdminRepository,
          useValue: {
            createService: jest
              .fn()
              .mockImplementation((data) =>
                Promise.resolve({ id: 's-1', updatedAt: new Date(), ...data }),
              ),
            service: jest.fn().mockResolvedValue(liveService),
            services: jest.fn().mockResolvedValue([]),
            updateService: jest
              .fn()
              .mockImplementation((id, data) => Promise.resolve({ ...liveService, ...data })),
            openBookingsByService: jest.fn().mockResolvedValue(new Map()),
            createLocation: jest
              .fn()
              .mockImplementation((data) => Promise.resolve({ id: 'l-1', ...data })),
            promoCodeByCode: jest.fn().mockResolvedValue(null),
            createPromoCode: jest
              .fn()
              .mockImplementation((data) => Promise.resolve({ id: 'p-1', ...data })),
            professional: jest.fn().mockResolvedValue({ id: 'pr-1', name: 'Anil Kumar' }),
            hasActiveAssignments: jest.fn().mockResolvedValue(false),
            deleteProfessional: jest.fn(),
          },
        },
        {
          provide: ServiceChangeRepository,
          useValue: {
            transaction: jest.fn().mockImplementation((fn: (tx: string) => unknown) => fn('tx')),
            requestNewService: jest.fn().mockResolvedValue({
              id: 'c-1',
              kind: 'NEW_SERVICE',
              requested: {},
              createdAt: new Date(),
            }),
            openChange: jest.fn().mockResolvedValue(null),
            requestPriceChange: jest.fn().mockImplementation((s, requested) =>
              Promise.resolve({
                id: 'c-2',
                kind: 'PRICE_CHANGE',
                requested,
                createdAt: new Date(),
              }),
            ),
            withdraw: jest.fn(),
            openChanges: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: PlacesService,
          useValue: {
            search: jest.fn().mockResolvedValue([{ placeId: 'g-1' }]),
            details: jest.fn().mockResolvedValue({ lat: 10.01, lng: 76.34 }),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(AdminCatalogService);
    repo = moduleRef.get(AdminRepository);
    changes = moduleRef.get(ServiceChangeRepository);
    places = moduleRef.get(PlacesService);
  });

  it('keeps a new service out of the app until the super admin approves it', async () => {
    const created = await svc.createService(newService, 'admin-1', BOTH);
    expect(repo.createService).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false }),
      'tx',
    );
    expect(changes.requestNewService).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      'admin-1',
      'tx',
    );
    expect(created).toMatchObject({
      approved: false,
      live: false,
      fromPrice: 698,
      pendingChange: { kind: 'NEW_SERVICE', hourlyRate: 349, startingPrice: 698 },
    });
  });

  it('keeps an inactive service offline, whatever was asked', async () => {
    const created = await svc.createService(
      { ...newService, active: false, online: true },
      'a',
      BOTH,
    );
    expect(created).toMatchObject({ active: false, online: false, live: false });
  });

  it('refuses a tile the vertical does not have', async () => {
    await expect(
      svc.createService({ ...newService, vertical: ServiceVertical.REPAIR }, 'a', BOTH),
    ).rejects.toBeInstanceOf(ValidationFailedException);
  });

  it('saves a new name straight away but sends a new price for approval', async () => {
    const updated = await svc.updateService(
      's-1',
      { name: 'Bathroom shine', hourlyRate: 449 },
      'admin-1',
      BOTH,
    );
    expect(repo.updateService).toHaveBeenCalledWith('s-1', {
      name: 'Bathroom shine',
      active: true,
      online: true,
    });
    expect(changes.requestPriceChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bathroom shine' }),
      { minHours: 2, hourlyRate: 449, extraProRate: 299, materialsFee: 149 },
      'admin-1',
    );
    expect(updated).toMatchObject({
      hourlyRate: 349,
      live: true,
      pendingChange: { kind: 'PRICE_CHANGE', hourlyRate: 449, startingPrice: 898 },
    });
  });

  it('adds to the change already waiting instead of starting over', async () => {
    changes.openChange.mockResolvedValue({
      id: 'c-2',
      kind: 'PRICE_CHANGE',
      requested: { minHours: 2, hourlyRate: 449, extraProRate: 299, materialsFee: 149 },
      createdAt: new Date(),
    });
    await svc.updateService('s-1', { extraProRate: 379 }, 'admin-1', BOTH);
    expect(changes.requestPriceChange).toHaveBeenCalledWith(
      expect.anything(),
      { minHours: 2, hourlyRate: 449, extraProRate: 379, materialsFee: 149 },
      'admin-1',
    );
  });

  it('withdraws the waiting change when the live price is asked for again', async () => {
    changes.openChange.mockResolvedValue({
      id: 'c-2',
      kind: 'PRICE_CHANGE',
      requested: { minHours: 2, hourlyRate: 449, extraProRate: 299, materialsFee: 149 },
      createdAt: new Date(),
    });
    const updated = await svc.updateService('s-1', { hourlyRate: 349 }, 'admin-1', BOTH);
    expect(changes.withdraw).toHaveBeenCalledWith('s-1');
    expect(changes.requestPriceChange).not.toHaveBeenCalled();
    expect(updated.pendingChange).toBeNull();
  });

  it('edits a service still waiting for approval directly, price included', async () => {
    repo.service.mockResolvedValue({ ...liveService, approved: false });
    await svc.updateService('s-1', { hourlyRate: 449 }, 'admin-1', BOTH);
    expect(repo.updateService).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({ hourlyRate: 449 }),
    );
    expect(changes.requestPriceChange).not.toHaveBeenCalled();
  });

  it('keeps an ELK Repair admin from adding or changing a cleaning service', async () => {
    await expect(
      svc.createService(newService, 'admin-1', [ServiceVertical.REPAIR]),
    ).rejects.toBeInstanceOf(ForbiddenResourceException);
    await expect(
      svc.updateService('s-1', { hourlyRate: 449 }, 'admin-1', [ServiceVertical.REPAIR]),
    ).rejects.toBeInstanceOf(ForbiddenResourceException);
    expect(repo.updateService).not.toHaveBeenCalled();
  });

  it('lists only the services of the admin’s verticals', async () => {
    repo.services.mockResolvedValue([liveService]);
    await expect(svc.services([ServiceVertical.REPAIR])).resolves.toEqual([]);
    await expect(svc.services([ServiceVertical.CLEANING])).resolves.toHaveLength(1);
  });

  it('finds an area’s centre on the map when it is added', async () => {
    const created = await svc.createLocation({
      area: 'Kakkanad',
      district: 'Ernakulam',
      pincode: '682030',
      radiusKm: 6,
    });
    expect(places.search).toHaveBeenCalledWith('Kakkanad, Ernakulam 682030, India');
    expect(created.mapped).toBe(true);
  });

  it('still saves an area it cannot find on the map, matching by pincode alone', async () => {
    places.search.mockRejectedValue(new Error('no key'));
    const created = await svc.createLocation({
      area: 'Kakkanad',
      district: 'Ernakulam',
      pincode: '682030',
      radiusKm: 6,
    });
    expect(created.mapped).toBe(false);
  });

  it('stores promo codes in capitals and refuses a duplicate', async () => {
    const dto = {
      code: 'onam20',
      percent: 20,
      maxDiscount: 500,
      minOrder: 999,
      validTill: '2099-01-01',
    };
    await expect(svc.createPromoCode(dto)).resolves.toMatchObject({
      code: 'ONAM20',
      state: 'ACTIVE',
    });

    repo.promoCodeByCode.mockResolvedValue({ id: 'x' } as never);
    await expect(svc.createPromoCode(dto)).rejects.toBeInstanceOf(DuplicateResourceException);
  });

  it('refuses a promo code that expires in the past', async () => {
    await expect(
      svc.createPromoCode({
        code: 'OLD10',
        percent: 10,
        maxDiscount: 0,
        minOrder: 0,
        validTill: '2000-01-01',
      }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
  });

  it('will not remove a professional who still has jobs', async () => {
    repo.hasActiveAssignments.mockResolvedValue(true);
    await expect(svc.deleteProfessional('pr-1')).rejects.toBeInstanceOf(DomainException);
    expect(repo.deleteProfessional).not.toHaveBeenCalled();
  });
});
