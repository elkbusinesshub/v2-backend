import { Test } from '@nestjs/testing';
import { AdOrderStatus, AdStatus, Role } from '@prisma/client';
import {
  DomainException,
  ForbiddenResourceException,
  ResourceNotFoundException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AdOrdersRepository, type AdOrderRow } from '@/modules/marketplace/ad-orders.repository';
import { AdOrdersService } from '@/modules/marketplace/ad-orders.service';
import {
  MarketplaceRepository,
  type AdWithSeller,
} from '@/modules/marketplace/marketplace.repository';

const seller: AuthUser = { id: 'u-seller', roles: [Role.USER], jti: 'j', exp: 9999999999 };
const buyer: AuthUser = { id: 'u-buyer', roles: [Role.USER], jti: 'j', exp: 9999999999 };

function ad(overrides: Partial<AdWithSeller> = {}): AdWithSeller {
  return {
    id: 'ad-1',
    sellerId: 'u-seller',
    title: 'Sofa Shampoo',
    description: '',
    categorySlug: 'cleaning',
    icon: '🛋️',
    price: 899 as never,
    priceUnit: '/ visit',
    locality: 'Koramangala',
    city: 'Bengaluru',
    lat: null,
    lng: null,
    attributes: null,
    status: AdStatus.ACTIVE,
    viewCount: 0,
    wishlistCount: 0,
    ratingAverage: 0 as never,
    ratingCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    seller: { name: 'Ravi K', providerProfile: null },
    images: [],
    ...overrides,
  };
}

function order(overrides: Partial<AdOrderRow> = {}): AdOrderRow {
  return {
    id: 'o-1',
    code: 'ELK-A-4T29K',
    adId: 'ad-1',
    buyerId: 'u-buyer',
    sellerId: 'u-seller',
    status: AdOrderStatus.NEW,
    amount: 899 as never,
    quantity: 1,
    feesAmount: 0 as never,
    taxAmount: 0 as never,
    serviceName: 'Sofa Shampoo',
    lat: null,
    lng: null,
    scheduledAt: null,
    endAt: null,
    durationMonths: null,
    depositAmount: null,
    addressText: '12, 5th Block',
    contactPhone: '+919000000001',
    note: null,
    acceptedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-06-12T09:00:00.000Z'),
    updatedAt: new Date(),
    buyer: { name: 'Aarav Menon', phone: '+919000000001' },
    ad: { icon: '🛋️', title: 'Sofa Shampoo' },
    ...overrides,
  };
}

describe('AdOrdersService', () => {
  let service: AdOrdersService;
  let orders: jest.Mocked<AdOrdersRepository>;
  let ads: jest.Mocked<MarketplaceRepository>;
  let notifications: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdOrdersService,
        {
          provide: AdOrdersRepository,
          useValue: {
            create: jest.fn().mockImplementation((data) => Promise.resolve(order(data))),
            findForSeller: jest.fn().mockResolvedValue([order()]),
            findForBuyer: jest.fn().mockResolvedValue([order()]),
            findById: jest.fn().mockResolvedValue(order()),
            updateStatus: jest
              .fn()
              .mockImplementation((id, status) => Promise.resolve(order({ id, status }))),
            countsForSeller: jest.fn().mockResolvedValue({ NEW: 1 }),
          },
        },
        {
          provide: MarketplaceRepository,
          useValue: { findById: jest.fn().mockResolvedValue(ad()) },
        },
        {
          provide: NotificationsService,
          useValue: { create: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = moduleRef.get(AdOrdersService);
    orders = moduleRef.get(AdOrdersRepository);
    ads = moduleRef.get(MarketplaceRepository);
    notifications = moduleRef.get(NotificationsService);
  });

  describe('placing an order', () => {
    it('snapshots the price, title and seller rather than joining through the ad', async () => {
      // A listing that is repriced or changes hands must not rewrite who was
      // owed what for work already ordered.
      await service.place(buyer, 'ad-1', {
        addressText: '12, 5th Block',
        contactPhone: '+919000000001',
      });

      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: 'u-seller',
          amount: 899,
          serviceName: 'Sofa Shampoo',
          buyerId: 'u-buyer',
        }),
      );
    });

    it('defaults to a single unit', async () => {
      await service.place(buyer, 'ad-1', {
        addressText: '12, 5th Block',
        contactPhone: '+919000000001',
      });

      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 1, amount: 899 }),
      );
    });

    it('multiplies the listing price by the quantity, server-side', async () => {
      // The buyer's device sends how many, never what it owes.
      await service.place(buyer, 'ad-1', {
        addressText: '12, 5th Block',
        contactPhone: '+919000000001',
        quantity: 3,
      });

      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 3, amount: 2697 }),
      );
    });

    it('places an enquiry at zero rather than charging the listing price', async () => {
      // Asking to view a room is not the same as taking it for a month.
      await service.place(buyer, 'ad-1', {
        addressText: '12, 5th Block',
        contactPhone: '+919000000001',
        isEnquiry: true,
      });

      expect(orders.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 0 }));
    });

    it('records the fees and tax the buyer was shown', async () => {
      // Without these the screen's total and the order's disagreed, and the
      // order was the one that was wrong.
      await service.place(buyer, 'ad-1', {
        addressText: '12, 5th Block',
        contactPhone: '+919000000001',
        feesAmount: 25,
        taxAmount: 46.2,
      });

      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ feesAmount: 25, taxAmount: 46.2 }),
      );
    });

    it('defaults fees and tax to nothing', async () => {
      await service.place(buyer, 'ad-1', {
        addressText: '12, 5th Block',
        contactPhone: '+919000000001',
      });

      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ feesAmount: 0, taxAmount: 0 }),
      );
    });

    it('gives the order a unique-looking reference', async () => {
      await service.place(buyer, 'ad-1', {
        addressText: 'x',
        contactPhone: '+919000000001',
      });

      const { code } = orders.create.mock.calls[0]![0];
      expect(code).toMatch(/^ELK-A-[A-Z0-9]{5}$/);
    });

    it('notifies the seller, since nothing else tells them', async () => {
      await service.place(buyer, 'ad-1', {
        addressText: 'x',
        contactPhone: '+919000000001',
      });

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-seller', title: 'New order' }),
      );
    });

    it('still places the order when notifying fails', async () => {
      // A push problem must not cost the buyer their order.
      notifications.create.mockRejectedValue(new Error('fcm down'));

      await expect(
        service.place(buyer, 'ad-1', { addressText: 'x', contactPhone: '+91' }),
      ).resolves.toMatchObject({ code: expect.any(String) });
    });

    it('404s a listing that is not active', async () => {
      // findById is ACTIVE-scoped, so a draft or paused ad reads as missing —
      // which is what it is, to a buyer.
      ads.findById.mockResolvedValue(null);

      await expect(
        service.place(buyer, 'ad-x', { addressText: 'x', contactPhone: '+91' }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('refuses to let a seller order their own listing', async () => {
      await expect(
        service.place(seller, 'ad-1', { addressText: 'x', contactPhone: '+91' }),
      ).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('status transitions', () => {
    it('lets the seller accept a new order', async () => {
      const updated = await service.setStatus(seller, 'o-1', AdOrderStatus.IN_PROGRESS);

      expect(updated.status).toBe(AdOrderStatus.IN_PROGRESS);
      expect(orders.updateStatus).toHaveBeenCalledWith(
        'o-1',
        AdOrderStatus.IN_PROGRESS,
        expect.objectContaining({ acceptedAt: expect.any(Date) }),
      );
    });

    it('stamps completion', async () => {
      orders.findById.mockResolvedValue(order({ status: AdOrderStatus.IN_PROGRESS }));

      await service.setStatus(seller, 'o-1', AdOrderStatus.COMPLETED);

      expect(orders.updateStatus).toHaveBeenCalledWith(
        'o-1',
        AdOrderStatus.COMPLETED,
        expect.objectContaining({ completedAt: expect.any(Date) }),
      );
    });

    it('refuses to complete an order the seller never started', async () => {
      // NEW → COMPLETED skips the state that says work began.
      await expect(
        service.setStatus(seller, 'o-1', AdOrderStatus.COMPLETED),
      ).rejects.toBeInstanceOf(DomainException);
    });

    it('refuses to move a completed order at all', async () => {
      orders.findById.mockResolvedValue(order({ status: AdOrderStatus.COMPLETED }));

      await expect(
        service.setStatus(seller, 'o-1', AdOrderStatus.IN_PROGRESS),
      ).rejects.toBeInstanceOf(DomainException);
    });

    it('lets the buyer cancel only before the seller starts', async () => {
      await service.setStatus(buyer, 'o-1', AdOrderStatus.CANCELLED);
      expect(orders.updateStatus).toHaveBeenCalled();

      orders.findById.mockResolvedValue(order({ status: AdOrderStatus.IN_PROGRESS }));
      await expect(service.setStatus(buyer, 'o-1', AdOrderStatus.CANCELLED)).rejects.toBeInstanceOf(
        DomainException,
      );
    });

    it('never lets the buyer drive the order forward', async () => {
      await expect(
        service.setStatus(buyer, 'o-1', AdOrderStatus.IN_PROGRESS),
      ).rejects.toBeInstanceOf(DomainException);
    });

    it('refuses a stranger outright', async () => {
      const stranger: AuthUser = { ...buyer, id: 'u-nobody' };

      await expect(
        service.setStatus(stranger, 'o-1', AdOrderStatus.CANCELLED),
      ).rejects.toBeInstanceOf(ForbiddenResourceException);
    });

    it('notifies the other party, not the one who made the change', async () => {
      await service.setStatus(seller, 'o-1', AdOrderStatus.IN_PROGRESS);

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-buyer' }),
      );
    });

    it('404s an order that does not exist', async () => {
      orders.findById.mockResolvedValue(null);

      await expect(
        service.setStatus(seller, 'o-x', AdOrderStatus.CANCELLED),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('listing', () => {
    it('scopes the seller list to the caller', async () => {
      await service.listForSeller(seller, AdOrderStatus.NEW);

      expect(orders.findForSeller).toHaveBeenCalledWith('u-seller', AdOrderStatus.NEW);
    });

    it('renders "As soon as possible" when no time was chosen', async () => {
      const [row] = await service.listForSeller(seller);

      expect(row!.whenLabel).toBe('As soon as possible');
    });

    it('falls back to the order contact when the buyer has no phone on file', async () => {
      orders.findForSeller.mockResolvedValue([order({ buyer: { name: 'Aarav', phone: null } })]);

      const [row] = await service.listForSeller(seller);

      expect(row!.customerPhone).toBe('+919000000001');
    });
  });
});
