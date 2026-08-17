import { HttpStatus, Injectable } from '@nestjs/common';
import { initialsOf } from '@/common/utils/initials';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { ChatGateway } from './chat.gateway';
import { ChatRepository } from './chat.repository';
import { counterpartOf, toInboxRowJson, toMessageJson, toThreadJson } from './chat.mapper';
import type { SendMessageDto } from './chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly chat: ChatRepository,
    private readonly gateway: ChatGateway,
  ) {}

  /** Every conversation the caller is part of, most recently active first. */
  async listThreads(user: AuthUser): Promise<Record<string, unknown>[]> {
    const threads = await this.chat.listThreads(user.id);
    const ids = threads.map((t) => t.id);
    const [latest, unread] = await Promise.all([
      this.chat.latestPerThread(ids),
      this.chat.unreadCounts(ids, user.id),
    ]);
    const latestByThread = new Map(latest.map((m) => [m.threadId, m]));
    return threads.map((thread) =>
      toInboxRowJson(thread, user.id, latestByThread.get(thread.id), unread.get(thread.id) ?? 0),
    );
  }

  async unreadTotal(user: AuthUser): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.chat.unreadTotal(user.id) };
  }

  /**
   * The conversation with [contactId], opened.
   *
   * Reading a thread marks it read: the badge is about messages you have not
   * seen, and you have just seen them. An empty conversation is a valid
   * answer — a thread that has never been written in does not exist as a row,
   * and the screen should still open rather than 404.
   */
  async getThread(user: AuthUser, contactId: string): Promise<Record<string, unknown>> {
    if (contactId === user.id) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        'CANNOT_CHAT_WITH_SELF',
        'You cannot message yourself',
      );
    }
    const thread = await this.chat.findThread(user.id, contactId);
    if (!thread) {
      return this.emptyThread(user, contactId);
    }
    const [messages, readCount] = await Promise.all([
      this.chat.listMessages(thread.id),
      this.chat.markRead(thread.id, user.id),
    ]);
    if (readCount > 0) {
      // Tell the other side their messages landed, so a delivered tick can
      // change without them reopening the screen.
      this.gateway.emitRead(counterpartOf(thread, user.id).id, {
        contactId: user.id,
        threadId: thread.id,
      });
    }
    return toThreadJson(thread, messages, user.id);
  }

  /** Sends to [contactId], creating the conversation if this is the first word. */
  async sendMessage(
    user: AuthUser,
    contactId: string,
    dto: SendMessageDto,
  ): Promise<Record<string, unknown>> {
    if (contactId === user.id) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        'CANNOT_CHAT_WITH_SELF',
        'You cannot message yourself',
      );
    }
    const recipient = await this.chat.findUser(contactId);
    if (!recipient) {
      throw new ResourceNotFoundException('User');
    }

    const thread = await this.chat.ensureThread(user.id, contactId);
    const message = await this.chat.createMessage(thread.id, user.id, dto.text);

    const senderName = user.id === thread.userAId ? thread.userA.name : thread.userB.name;
    // The same message renders differently for each side: outgoing to whoever
    // wrote it, incoming and attributed to the person receiving it.
    const mine = toMessageJson(message, user.id, initialsOf(recipient.name ?? 'ELK user'));
    const theirs = toMessageJson(message, contactId, initialsOf(senderName ?? 'ELK user'));
    this.gateway.emitMessage(contactId, {
      ...theirs,
      threadId: thread.id,
      contactId: user.id,
    });
    return mine;
  }

  /**
   * The conversation an order screen should open.
   *
   * An order still knows two accounts, so the tracking screen can hand over
   * an order id and get back the people. The thread itself is not the order's
   * — it is the same one the listing page opens.
   */
  async contactForOrder(user: AuthUser, orderId: string): Promise<{ contactId: string }> {
    const parties = await this.chat.findOrderParties(orderId, user.id);
    if (!parties) {
      throw new ResourceNotFoundException('Order');
    }
    return { contactId: parties.buyerId === user.id ? parties.sellerId : parties.buyerId };
  }

  /** A conversation nobody has written in yet, so the screen can still open. */
  private async emptyThread(user: AuthUser, contactId: string): Promise<Record<string, unknown>> {
    const contact = await this.chat.findUser(contactId);
    if (!contact) {
      throw new ResourceNotFoundException('User');
    }
    const name = contact.name ?? 'ELK user';
    return {
      threadId: null,
      contactId,
      contactName: name,
      contactInitials: initialsOf(name),
      contactStatus: 'Tap to view profile',
      dateLabel: '',
      messages: [],
    };
  }
}
