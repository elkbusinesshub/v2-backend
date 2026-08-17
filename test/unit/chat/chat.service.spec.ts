import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { ChatGateway } from '@/modules/chat/chat.gateway';
import { ChatRepository } from '@/modules/chat/chat.repository';
import { ChatService } from '@/modules/chat/chat.service';

const asha: AuthUser = { id: 'u-asha', roles: [Role.USER], jti: 'j', exp: 9999999999 };

/** userA/userB are stored sorted, so 'u-asha' lands in A and 'u-bright' in B. */
const thread = {
  id: 't-1',
  userAId: 'u-asha',
  userBId: 'u-bright',
  userA: { id: 'u-asha', name: 'Asha Menon' },
  userB: { id: 'u-bright', name: 'Bright Spark' },
  lastMessageAt: new Date('2026-05-19T05:20:00.000Z'),
  createdAt: new Date('2026-05-19T05:15:00.000Z'),
  updatedAt: new Date(),
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    threadId: 't-1',
    senderId: 'u-bright',
    text: 'On my way',
    readAt: null,
    adOrderId: null,
    fromProvider: null,
    createdAt: new Date('2026-05-19T05:16:00.000Z'),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ChatService', () => {
  let service: ChatService;
  let chat: jest.Mocked<ChatRepository>;
  let gateway: jest.Mocked<ChatGateway>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: ChatRepository,
          useValue: {
            findThread: jest.fn().mockResolvedValue(thread),
            ensureThread: jest.fn().mockResolvedValue(thread),
            listThreads: jest.fn().mockResolvedValue([thread]),
            listMessages: jest.fn().mockResolvedValue([message()]),
            latestPerThread: jest.fn().mockResolvedValue([message()]),
            unreadCounts: jest.fn().mockResolvedValue(new Map([['t-1', 2]])),
            unreadTotal: jest.fn().mockResolvedValue(5),
            markRead: jest.fn().mockResolvedValue(0),
            createMessage: jest
              .fn()
              .mockImplementation((threadId, senderId, text) =>
                Promise.resolve(message({ id: 'm-new', threadId, senderId, text })),
              ),
            findOrderParties: jest
              .fn()
              .mockResolvedValue({ buyerId: 'u-asha', sellerId: 'u-bright' }),
            findUser: jest.fn().mockResolvedValue({ id: 'u-bright', name: 'Bright Spark' }),
          },
        },
        {
          provide: ChatGateway,
          useValue: { emitMessage: jest.fn(), emitRead: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
    chat = moduleRef.get(ChatRepository);
    gateway = moduleRef.get(ChatGateway);
  });

  describe('getThread', () => {
    it('is addressed by who it is with, not by an order', async () => {
      const result = await service.getThread(asha, 'u-bright');

      expect(chat.findThread).toHaveBeenCalledWith('u-asha', 'u-bright');
      expect(result).toMatchObject({ contactId: 'u-bright', contactName: 'Bright Spark' });
    });

    it('shows the other side’s message as incoming, with their initials', async () => {
      const result = await service.getThread(asha, 'u-bright');

      const messages = result.messages as Record<string, unknown>[];
      expect(messages[0]).toMatchObject({ isOutgoing: false, senderInitials: 'BS' });
    });

    it('shows the same message as outgoing to whoever wrote it', async () => {
      // "Mine" is a fact about the reader. Getting this backwards is what made
      // both parties see an entire conversation as their own.
      const bright: AuthUser = { ...asha, id: 'u-bright' };

      const result = await service.getThread(bright, 'u-asha');

      const messages = result.messages as Record<string, unknown>[];
      expect(messages[0]).toMatchObject({ isOutgoing: true, senderInitials: null });
      expect(result.contactName).toBe('Asha Menon');
    });

    it('opens an empty conversation rather than 404ing', async () => {
      // Two people who have never spoken still have a screen to speak on.
      chat.findThread.mockResolvedValue(null);

      const result = await service.getThread(asha, 'u-bright');

      expect(result).toMatchObject({ threadId: null, contactId: 'u-bright', messages: [] });
    });

    it('404s a contact who does not exist', async () => {
      chat.findThread.mockResolvedValue(null);
      chat.findUser.mockResolvedValue(null);

      await expect(service.getThread(asha, 'u-ghost')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it('refuses a conversation with yourself', async () => {
      await expect(service.getThread(asha, 'u-asha')).rejects.toBeInstanceOf(DomainException);
    });

    it('marks what was unread as read, and tells the other side', async () => {
      chat.markRead.mockResolvedValue(2);

      await service.getThread(asha, 'u-bright');

      expect(chat.markRead).toHaveBeenCalledWith('t-1', 'u-asha');
      expect(gateway.emitRead).toHaveBeenCalledWith(
        'u-bright',
        expect.objectContaining({ contactId: 'u-asha' }),
      );
    });

    it('stays quiet when there was nothing unread', async () => {
      chat.markRead.mockResolvedValue(0);

      await service.getThread(asha, 'u-bright');

      expect(gateway.emitRead).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('creates the conversation if this is the first word', async () => {
      await service.sendMessage(asha, 'u-bright', { text: 'Is this available?' });

      expect(chat.ensureThread).toHaveBeenCalledWith('u-asha', 'u-bright');
      expect(chat.createMessage).toHaveBeenCalledWith('t-1', 'u-asha', 'Is this available?');
    });

    it('delivers the recipient’s view to them, and returns the sender’s', async () => {
      // One message, two renderings. Broadcasting the sender's copy is what
      // made an arriving message look like your own.
      const mine = await service.sendMessage(asha, 'u-bright', { text: 'Hello' });

      expect(mine).toMatchObject({ isOutgoing: true, senderInitials: null });
      const [recipientId, payload] = gateway.emitMessage.mock.calls[0]!;
      expect(recipientId).toBe('u-bright');
      expect(payload).toMatchObject({
        isOutgoing: false,
        senderInitials: 'AM',
        contactId: 'u-asha',
      });
    });

    it('404s an account that does not exist', async () => {
      chat.findUser.mockResolvedValue(null);

      await expect(service.sendMessage(asha, 'u-ghost', { text: 'Hi' })).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
      expect(chat.createMessage).not.toHaveBeenCalled();
    });

    it('refuses to message yourself', async () => {
      await expect(service.sendMessage(asha, 'u-asha', { text: 'Hi' })).rejects.toBeInstanceOf(
        DomainException,
      );
    });
  });

  describe('listThreads', () => {
    it('is one row per contact, carrying the preview and what is unread', async () => {
      const rows = await service.listThreads(asha);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        contactId: 'u-bright',
        contactName: 'Bright Spark',
        preview: 'On my way',
        isPreviewMine: false,
        unreadCount: 2,
      });
    });

    it('marks a preview as mine when I sent it last', async () => {
      chat.latestPerThread.mockResolvedValue([message({ senderId: 'u-asha', text: 'Thanks!' })]);

      const rows = await service.listThreads(asha);

      expect(rows[0]).toMatchObject({ preview: 'Thanks!', isPreviewMine: true });
    });

    it('does not query messages when there are no conversations', async () => {
      chat.listThreads.mockResolvedValue([]);

      const rows = await service.listThreads(asha);

      expect(rows).toEqual([]);
      expect(chat.latestPerThread).toHaveBeenCalledWith([]);
    });
  });

  describe('contactForOrder', () => {
    it('gives the buyer the seller', async () => {
      // The tracking screen knows an order; chat needs a person.
      expect(await service.contactForOrder(asha, 'ao-1')).toEqual({ contactId: 'u-bright' });
    });

    it('gives the seller the buyer', async () => {
      const bright: AuthUser = { ...asha, id: 'u-bright' };

      expect(await service.contactForOrder(bright, 'ao-1')).toEqual({ contactId: 'u-asha' });
    });

    it('404s an order that is not the caller’s', async () => {
      chat.findOrderParties.mockResolvedValue(null);

      await expect(service.contactForOrder(asha, 'ao-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });
});
