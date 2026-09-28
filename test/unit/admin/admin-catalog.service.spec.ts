import { Test } from '@nestjs/testing';
import { ServiceVertical } from '@prisma/client';
import {
  DomainException,
  DuplicateResourceException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { AdminCatalogService } from '@/modules/admin/admin-catalog.service';
import { AdminRepository } from '@/modules/admin/admin.repository';
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

describe('AdminCatalogService', () => {
  let svc: AdminCatalogService;
  let repo: jest.Mocked<AdminRepository>;
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
    places = moduleRef.get(PlacesService);
  });

  it('puts a new service live, with its From price', async () => {
    const created = await svc.createService(newService);
    expect(created).toMatchObject({ live: true, fromPrice: 698 });
  });

  it('keeps an inactive service offline, whatever was asked', async () => {
    const created = await svc.createService({ ...newService, active: false, online: true });
    expect(created).toMatchObject({ active: false, online: false, live: false });
  });

  it('refuses a tile the vertical does not have', async () => {
    await expect(
      svc.createService({ ...newService, vertical: ServiceVertical.REPAIR }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
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
