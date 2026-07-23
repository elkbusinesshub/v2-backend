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

    it('404s an order that is not the caller’s', async () => {
      chat.findBookingForUser.mockResolvedValue(null);
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
