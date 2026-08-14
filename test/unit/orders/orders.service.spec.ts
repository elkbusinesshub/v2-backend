import { Test } from '@nestjs/testing';
import { AdOrderStatus, Role } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { AdOrdersService } from '@/modules/marketplace/ad-orders.service';
import { ChatGateway } from '@/modules/orders/chat.gateway';
import { ChatRepository } from '@/modules/orders/chat.repository';
import { OrdersService } from '@/modules/orders/orders.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const sellerMessage = {
  id: 'm-1',
  adOrderId: 'ao-1',
  fromProvider: true,
  text: 'On my way',
  createdAt: new Date('2026-05-19T05:16:00.000Z'),
  updatedAt: new Date(),
};

describe('OrdersService', () => {
  let orders: OrdersService;
  let chat: jest.Mocked<ChatRepository>;
  let adOrders: jest.Mocked<AdOrdersService>;
  let gateway: jest.Mocked<ChatGateway>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: ChatRepository,
          useValue: {
            findTrackableAdOrder: jest.fn().mockResolvedValue(null),
            findThreadOwner: jest.fn().mockResolvedValue({
              id: 'ao-1',
              contactName: 'Bright Spark',
              createdAt: new Date('2026-05-19T05:15:00.000Z'),
            }),
            listMessages: jest.fn().mockResolvedValue([sellerMessage]),
            create: jest.fn().mockImplementation((data) =>
              Promise.resolve({
                ...data,
                id: 'm-2',
                createdAt: new Date('2026-05-19T05:20:00.000Z'),
                updatedAt: new Date(),
              }),
            ),
          },
        },
        {
          provide: AdOrdersService,
          useValue: { setStatus: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: ChatGateway,
          useValue: { emitMessage: jest.fn() },
        },
      ],
    }).compile();

    orders = moduleRef.get(OrdersService);
    chat = moduleRef.get(ChatRepository);
    adOrders = moduleRef.get(AdOrdersService);
    gateway = moduleRef.get(ChatGateway);
  });

  describe('getThread', () => {
    it('returns the thread with contact metadata and rendered messages', async () => {
      const thread = await orders.getThread(user, 'ao-1');

      expect(thread).toMatchObject({
        contactName: 'Bright Spark',
        contactInitials: 'BS',
        contactStatus: '● Online · Service Provider',
      });
      const messages = thread.messages as Record<string, unknown>[];
      // seller message → incoming, initials set
      expect(messages[0]).toMatchObject({ isOutgoing: false, senderInitials: 'BS' });
    });

    it('404s an order that is not the caller’s', async () => {
      chat.findThreadOwner.mockResolvedValue(null);
      await expect(orders.getThread(user, 'ao-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe('sendMessage', () => {
    it('persists an outgoing message and broadcasts it', async () => {
      const message = await orders.sendMessage(user, 'ao-1', { text: 'Ring the bell' });

      expect(chat.create).toHaveBeenCalledWith({
        adOrderId: 'ao-1',
        fromProvider: false,
        text: 'Ring the bell',
      });
      expect(message).toMatchObject({ isOutgoing: true, senderInitials: null });
      expect(gateway.emitMessage).toHaveBeenCalledWith('ao-1', message);
    });
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
      seller: { name: 'Bright Spark' },
      ...overrides,
    });

    it('404s an order that is not the caller’s', async () => {
      chat.findTrackableAdOrder.mockResolvedValue(null);
      await expect(orders.getTracking(user, 'ao-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it('shows four steps, not the old booking flow’s five', async () => {
      // An ad order has no dispatch, so there is no moment at which someone
      // is "on the way".
      chat.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await orders.getTracking(user, 'ao-1');

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
      chat.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await orders.getTracking(user, 'ao-1');

      expect(tracking.statusLabel).toBe('Waiting for the seller');
      expect((tracking.steps as Record<string, unknown>[]).map((s) => s.status)).toEqual([
        'done',
        'active',
        'pending',
        'pending',
      ]);
    });

    it('an accepted order shows the accept time rather than a placeholder', async () => {
      chat.findTrackableAdOrder.mockResolvedValue(
        adOrder({
          status: AdOrderStatus.IN_PROGRESS,
          acceptedAt: new Date('2026-06-12T10:30:00.000Z'),
        }) as never,
      );

      const tracking = await orders.getTracking(user, 'ao-1');

      const steps = tracking.steps as Record<string, unknown>[];
      expect(steps[1]!.status).toBe('done');
      expect(steps[1]!.time).not.toBe('—');
      expect(steps[2]!.status).toBe('active');
    });

    it('a cancelled order freezes where it stopped', async () => {
      // The label says it was cancelled; no step pretends to be complete.
      chat.findTrackableAdOrder.mockResolvedValue(
        adOrder({ status: AdOrderStatus.CANCELLED }) as never,
      );

      const tracking = await orders.getTracking(user, 'ao-1');

      expect(tracking.statusLabel).toBe('Order cancelled');
      expect((tracking.steps as Record<string, unknown>[]).map((s) => s.status)).toEqual([
        'done',
        'pending',
        'pending',
        'pending',
      ]);
    });

    it('maps the pin the buyer dropped', async () => {
      chat.findTrackableAdOrder.mockResolvedValue(
        adOrder({ lat: '12.9352000', lng: '77.6245000' }) as never,
      );

      const tracking = await orders.getTracking(user, 'ao-1');

      // Decimal columns arrive as strings; the screen needs numbers.
      expect(tracking.lat).toBe(12.9352);
      expect(tracking.lng).toBe(77.6245);
    });

    it('omits the map when the address was typed rather than picked', async () => {
      chat.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await orders.getTracking(user, 'ao-1');

      expect(tracking.lat).toBeNull();
      expect(tracking.lng).toBeNull();
      expect(tracking.addressText).toBe('12, 5th Block');
    });

    it('labels it with the seller and the listing', async () => {
      chat.findTrackableAdOrder.mockResolvedValue(adOrder() as never);

      const tracking = await orders.getTracking(user, 'ao-1');

      expect(tracking.orderId).toBe('ELK-A-4T29K');
      expect(tracking.providerName).toBe('Bright Spark');
      expect(tracking.serviceIcon).toBe('🛋️');
    });
  });

  describe('cancelOrder', () => {
    it('delegates to the marketplace transition rules rather than its own', async () => {
      // Sharing the rules is what stops this endpoint letting a buyer cancel
      // work the seller has already started.
      await orders.cancelOrder(user, 'ao-1');

      expect(adOrders.setStatus).toHaveBeenCalledWith(user, 'ao-1', AdOrderStatus.CANCELLED);
    });
  });
});
