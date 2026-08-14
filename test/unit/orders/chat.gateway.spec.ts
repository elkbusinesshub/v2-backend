import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import type { Socket } from 'socket.io';
import type { AuthUser } from '@/common/types/auth.types';
import { ChatGateway, orderRoom } from '@/modules/orders/chat.gateway';
import { ChatRepository } from '@/modules/orders/chat.repository';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const threadOwner = {
  id: 'b-1',
  contactName: 'Royal Shine Cleaning Co.',
  createdAt: new Date('2026-05-19T05:15:00.000Z'),
} as unknown as Awaited<ReturnType<ChatRepository['findThreadOwner']>>;

/** A socket that has already cleared the JWT handshake middleware. */
function socketFor(principal: AuthUser | undefined) {
  return {
    data: { user: principal },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  } as unknown as jest.Mocked<Socket>;
}

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chat: jest.Mocked<ChatRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        {
          provide: ChatRepository,
          useValue: { findThreadOwner: jest.fn().mockResolvedValue(threadOwner) },
        },
      ],
    }).compile();

    gateway = moduleRef.get(ChatGateway);
    chat = moduleRef.get(ChatRepository);
  });

  describe('order:join', () => {
    it('joins the room when the caller owns the order', async () => {
      const client = socketFor(user);

      await gateway.joinOrder(client, 'b-1');

      expect(chat.findThreadOwner).toHaveBeenCalledWith('b-1', 'u-1');
      expect(client.join).toHaveBeenCalledWith(orderRoom('b-1'));
      expect(client.emit).toHaveBeenCalledWith('order:joined', { bookingId: 'b-1' });
    });

    it('refuses an order belonging to someone else', async () => {
      // The whole point of the check: a valid token is not permission to read
      // another customer's conversation.
      chat.findThreadOwner.mockResolvedValue(null);
      const client = socketFor(user);

      await gateway.joinOrder(client, 'b-someone-elses');

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('order:join:denied', {
        bookingId: 'b-someone-elses',
      });
    });

    it('refuses a socket with no principal without hitting the database', async () => {
      const client = socketFor(undefined);

      await gateway.joinOrder(client, 'b-1');

      expect(chat.findThreadOwner).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('refuses a malformed booking id', async () => {
      const client = socketFor(user);

      await gateway.joinOrder(client, 42);

      expect(chat.findThreadOwner).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('order:leave', () => {
    it('leaves the room without an ownership check', () => {
      // Leaving a room you were never in is a no-op, so there is nothing to guard.
      const client = socketFor(user);

      gateway.leaveOrder(client, 'b-1');

      expect(client.leave).toHaveBeenCalledWith(orderRoom('b-1'));
      expect(chat.findThreadOwner).not.toHaveBeenCalled();
    });
  });
});
