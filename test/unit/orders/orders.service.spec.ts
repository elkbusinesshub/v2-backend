import { Test } from '@nestjs/testing';
import { AdOrderStatus, Role } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { AdOrdersService } from '@/modules/marketplace/ad-orders.service';
import { OrdersRepository } from '@/modules/orders/orders.repository';
import { OrdersService } from '@/modules/orders/orders.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

describe('OrdersService', () => {
  let service: OrdersService;
  let orders: jest.Mocked<OrdersRepository>;
  let adOrders: jest.Mocked<AdOrdersService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: OrdersRepository,
          useValue: { findTrackableAdOrder: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: AdOrdersService,
          useValue: { setStatus: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = moduleRef.get(OrdersService);
    orders = moduleRef.get(OrdersRepository);
    adOrders = moduleRef.get(AdOrdersService);
  });

  describe('getTracking', () => {
    const adOrder = (overrides: Record<string, unknown> = {}) => ({
      id: 'ao-1',
      code: 'ELK-A-4T29K',
      status: AdOrderStatus.NEW,
      serviceName: 'Sofa Shampoo',
      addressText: '12, 5th Block',
      lat: null,
      lng: null,
      createdAt: new Date('2026-06-12T09:00:00.000Z'),
      acceptedAt: null,
      completedAt: null,
      ad: { icon: '🛋️' },
      sellerId: 'u-seller',
      buyerId: 'u-1',
      seller: { id: 'u-seller', name: 'Bright Spark' },
      ...overrides,
    });

    it('404s an order that is not the caller’s', async () => {
      orders.findTrackableAdOrder.mockResolvedValue(null);
      await expect(service.getTracking(user, 'ao-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it('shows four steps, not the old booking flow’s five', async () => {
      // An ad order has no dispatch, so there is no moment at which someone
      // is "on the way".
      orders.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await service.getTracking(user, 'ao-1');

      const steps = tracking.steps as Record<string, unknown>[];
      expect(steps).toHaveLength(4);
      expect(steps.map((s) => s.name)).toEqual([
        'Order Placed',
        'Seller Accepted',
        'Work In Progress',
        'Completed',
      ]);
    });

    it('a new order is waiting on the seller', async () => {
      orders.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await service.getTracking(user, 'ao-1');

      expect(tracking.statusLabel).toBe('Waiting for the seller');
      expect((tracking.steps as Record<string, unknown>[]).map((s) => s.status)).toEqual([
        'done',
        'active',
        'pending',
        'pending',
      ]);
    });

    it('an accepted order shows the accept time rather than a placeholder', async () => {
      orders.findTrackableAdOrder.mockResolvedValue(
        adOrder({
          status: AdOrderStatus.IN_PROGRESS,
          acceptedAt: new Date('2026-06-12T10:30:00.000Z'),
        }) as never,
      );

      const tracking = await service.getTracking(user, 'ao-1');

      const steps = tracking.steps as Record<string, unknown>[];
      expect(steps[1]!.status).toBe('done');
      expect(steps[1]!.time).not.toBe('—');
      expect(steps[2]!.status).toBe('active');
    });

    it('a cancelled order freezes where it stopped', async () => {
      // The label says it was cancelled; no step pretends to be complete.
      orders.findTrackableAdOrder.mockResolvedValue(
        adOrder({ status: AdOrderStatus.CANCELLED }) as never,
      );

      const tracking = await service.getTracking(user, 'ao-1');

      expect(tracking.statusLabel).toBe('Order cancelled');
      expect((tracking.steps as Record<string, unknown>[]).map((s) => s.status)).toEqual([
        'done',
        'pending',
        'pending',
        'pending',
      ]);
    });

    it('maps the pin the buyer dropped', async () => {
      orders.findTrackableAdOrder.mockResolvedValue(
        adOrder({ lat: '12.9352000', lng: '77.6245000' }) as never,
      );

      const tracking = await service.getTracking(user, 'ao-1');

      // Decimal columns arrive as strings; the screen needs numbers.
      expect(tracking.lat).toBe(12.9352);
      expect(tracking.lng).toBe(77.6245);
    });

    it('omits the map when the address was typed rather than picked', async () => {
      orders.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await service.getTracking(user, 'ao-1');

      expect(tracking.lat).toBeNull();
      expect(tracking.lng).toBeNull();
      expect(tracking.addressText).toBe('12, 5th Block');
    });

    it('labels it with the seller and the listing', async () => {
      orders.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await service.getTracking(user, 'ao-1');

      expect(tracking.orderId).toBe('ELK-A-4T29K');
      expect(tracking.providerName).toBe('Bright Spark');
      expect(tracking.serviceIcon).toBe('🛋️');
    });
  });

  describe('cancelOrder', () => {
    it('delegates to the marketplace transition rules rather than its own', async () => {
      // Sharing the rules is what stops this endpoint letting a buyer cancel
      // work the seller has already started.
      await service.cancelOrder(user, 'ao-1');

      expect(adOrders.setStatus).toHaveBeenCalledWith(user, 'ao-1', AdOrderStatus.CANCELLED);
    });
  });
});
