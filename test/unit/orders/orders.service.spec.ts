import { Test } from '@nestjs/testing';
import { BookingStatus, Prisma, Role } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingsRepository } from '@/modules/bookings/bookings.repository';
import { ChatGateway } from '@/modules/orders/chat.gateway';
import { ChatRepository } from '@/modules/orders/chat.repository';
import { OrdersService } from '@/modules/orders/orders.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const service = {
  id: 'svc-1',
  name: 'Deep Cleaning',
  icon: '✨',
  providerName: 'Royal Shine Cleaning Co.',
} as unknown as import('@prisma/client').Service;

const booking = {
  id: 'b-1',
  reference: 'ELK-2026-04921',
  userId: 'u-1',
  serviceId: 'svc-1',
  status: BookingStatus.CONFIRMED,
  scheduledAt: new Date(),
  addressText: 'Home',
  lat: null,
  lng: null,
  serviceFee: new Prisma.Decimal(149),
  total: new Prisma.Decimal(149),
  cancelledAt: null,
  createdAt: new Date('2026-05-19T05:15:00.000Z'),
  updatedAt: new Date('2026-05-19T05:15:00.000Z'),
  service,
};

const providerMessage = {
  id: 'm-1',
  bookingId: 'b-1',
  fromProvider: true,
  text: 'On my way',
  createdAt: new Date('2026-05-19T05:16:00.000Z'),
  updatedAt: new Date(),
};

describe('OrdersService', () => {
  let orders: OrdersService;
  let chat: jest.Mocked<ChatRepository>;
  let bookings: jest.Mocked<BookingsRepository>;
  let gateway: jest.Mocked<ChatGateway>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: ChatRepository,
          useValue: {
            findBookingForUser: jest.fn().mockResolvedValue(booking),
            // Null by default: these specs describe the booking path, and an
            // id that is not an ad order falls through to it.
            findTrackableAdOrder: jest.fn().mockResolvedValue(null),
            findThreadOwner: jest.fn().mockResolvedValue({
              id: booking.id,
              parent: 'booking',
              contactName: booking.service.providerName,
              createdAt: booking.createdAt,
            }),
            listMessages: jest.fn().mockResolvedValue([providerMessage]),
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
          provide: BookingsRepository,
          useValue: { cancel: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: ChatGateway,
          useValue: { emitMessage: jest.fn() },
        },
      ],
    }).compile();

    orders = moduleRef.get(OrdersService);
    chat = moduleRef.get(ChatRepository);
    bookings = moduleRef.get(BookingsRepository);
    gateway = moduleRef.get(ChatGateway);
  });

  describe('getThread', () => {
    it('returns the thread with provider contact metadata and rendered messages', async () => {
      const thread = await orders.getThread(user, 'b-1');
      expect(thread).toMatchObject({
        contactName: 'Royal Shine Cleaning Co.',
        contactInitials: 'RS',
        contactStatus: '● Online · Service Provider',
      });
      const messages = thread.messages as Record<string, unknown>[];
      // provider message → incoming, initials set
      expect(messages[0]).toMatchObject({ isOutgoing: false, senderInitials: 'RS' });
    });

    it('reads a thread that hangs off an order against a listing', async () => {
      // Four verticals write ad orders now, so a thread has two possible
      // parents and the message must be filed under the right one.
      chat.findThreadOwner.mockResolvedValue({
        id: 'ao-1',
        parent: 'adOrder',
        contactName: 'Bright Spark',
        createdAt: new Date('2026-06-12T09:00:00.000Z'),
      });

      const thread = await orders.getThread(user, 'ao-1');

      expect(chat.listMessages).toHaveBeenCalledWith(
        expect.objectContaining({ parent: 'adOrder', id: 'ao-1' }),
      );
      expect(thread.contactName).toBe('Bright Spark');
      expect(thread.contactInitials).toBe('BS');
    });

    it('404s an order that is not the caller’s', async () => {
      chat.findThreadOwner.mockResolvedValue(null);
      await expect(orders.getThread(user, 'b-x')).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('sendMessage', () => {
    it('persists an outgoing message and broadcasts it', async () => {
      const message = await orders.sendMessage(user, 'b-1', { text: 'Ring the bell' });
      expect(chat.create).toHaveBeenCalledWith({
        bookingId: 'b-1',
        fromProvider: false,
        text: 'Ring the bell',
      });
      expect(message).toMatchObject({ isOutgoing: true, senderInitials: null });
      expect(gateway.emitMessage).toHaveBeenCalledWith('b-1', message);
    });
  });

  describe('getTracking', () => {
    it('derives a CONFIRMED timeline: two done, one active, two pending', async () => {
      const tracking = await orders.getTracking(user, 'b-1');
      expect(tracking).toMatchObject({
        orderId: 'ELK-2026-04921',
        serviceName: 'Deep Cleaning',
        statusLabel: 'Arriving soon',
      });
      const steps = tracking.steps as { name: string; status: string }[];
      expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
    });

    it('derives a COMPLETED timeline: all done', async () => {
      chat.findBookingForUser.mockResolvedValue({ ...booking, status: BookingStatus.COMPLETED });
      const tracking = await orders.getTracking(user, 'b-1');
      const steps = tracking.steps as { status: string }[];
      expect(steps.every((s) => s.status === 'done')).toBe(true);
    });
  });

  describe('tracking an order against a listing', () => {
    const adOrder = (overrides: Record<string, unknown> = {}) => ({
      id: 'ao-1',
      code: 'ELK-A-4T29K',
      status: 'NEW',
      serviceName: 'Sofa Shampoo',
      addressText: '12, 5th Block',
      createdAt: new Date('2026-06-12T09:00:00.000Z'),
      acceptedAt: null,
      completedAt: null,
      ad: { icon: '🛋️' },
      seller: { name: 'Bright Spark' },
      ...overrides,
    });

    it('shows four steps, not the booking flow’s five', async () => {
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
          status: 'IN_PROGRESS',
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
      chat.findTrackableAdOrder.mockResolvedValue(adOrder({ status: 'CANCELLED' }) as never);

      const tracking = await orders.getTracking(user, 'ao-1');

      expect(tracking.statusLabel).toBe('Order cancelled');
      expect((tracking.steps as Record<string, unknown>[]).map((s) => s.status)).toEqual([
        'done',
        'pending',
        'pending',
        'pending',
      ]);
    });

    it('omits the map, since an order carries no pin', async () => {
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
    it('cancels via the bookings repository', async () => {
      await orders.cancelOrder(user, 'b-1');
      expect(bookings.cancel).toHaveBeenCalledWith('b-1');
    });

    it('409s when the order is not cancellable', async () => {
      bookings.cancel.mockResolvedValue(false);
      await expect(orders.cancelOrder(user, 'b-1')).rejects.toBeInstanceOf(DomainException);
    });
  });
});
