import { Inject, Injectable } from '@nestjs/common';
import type { ChatMessage, ChatThread, Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/** A thread with both participants joined, which is all any caller needs. */
export type ChatThreadRow = ChatThread & {
  userA: { id: string; name: string | null };
  userB: { id: string; name: string | null };
};

const withParticipants = {
  userA: { select: { id: true, name: true } },
  userB: { select: { id: true, name: true } },
} satisfies Prisma.ChatThreadInclude;

/**
 * The pair, sorted.
 *
 * Storing it in a fixed order is what lets one row be found from either side
 * with a single lookup, and lets the unique constraint make a duplicate
 * conversation impossible rather than merely unlikely.
 */
export function sortedPair(one: string, other: string): [string, string] {
  return one < other ? [one, other] : [other, one];
}

@Injectable()
export class ChatRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** The conversation between two accounts, if they have ever had one. */
  async findThread(one: string, other: string): Promise<ChatThreadRow | null> {
    const [userAId, userBId] = sortedPair(one, other);
    return this.db.chatThread.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      include: withParticipants,
    });
  }

  /**
   * The conversation between two accounts, creating it if this is the first
   * message. Racing callers both get the same row — the unique key decides,
   * and `upsert` turns the loser's collision into a read.
   */
  async ensureThread(one: string, other: string): Promise<ChatThreadRow> {
    const [userAId, userBId] = sortedPair(one, other);
    return this.db.chatThread.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId },
      update: {},
      include: withParticipants,
    });
  }

  /** Every conversation [userId] is part of, most recently active first. */
  async listThreads(userId: string): Promise<ChatThreadRow[]> {
    return this.db.chatThread.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { lastMessageAt: 'desc' },
      include: withParticipants,
    });
  }

  async listMessages(threadId: string): Promise<ChatMessage[]> {
    return this.db.chatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The newest message in each of [threadIds], for the inbox previews. */
  async latestPerThread(threadIds: string[]): Promise<ChatMessage[]> {
    if (threadIds.length === 0) return [];
    // One query for every thread's newest row. Distinct-on-threadId with a
    // descending order is a single index scan; N queries would not be.
    return this.db.chatMessage.findMany({
      where: { threadId: { in: threadIds } },
      orderBy: [{ threadId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['threadId'],
    });
  }

  /**
   * How many messages in each thread [userId] has not read.
   *
   * Only the *other* side's messages count — your own are read by definition.
   */
  async unreadCounts(threadIds: string[], userId: string): Promise<Map<string, number>> {
    if (threadIds.length === 0) return new Map();
    const rows = await this.db.chatMessage.groupBy({
      by: ['threadId'],
      where: { threadId: { in: threadIds }, senderId: { not: userId }, readAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.threadId, row._count._all]));
  }

  async unreadTotal(userId: string): Promise<number> {
    return this.db.chatMessage.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        thread: { OR: [{ userAId: userId }, { userBId: userId }] },
      },
    });
  }

  /** Stamps the other side's messages as seen. Returns how many were. */
  async markRead(threadId: string, readerId: string): Promise<number> {
    const { count } = await this.db.chatMessage.updateMany({
      where: { threadId, senderId: { not: readerId }, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }

  /**
   * Persists a message and bumps its thread, together.
   *
   * In one transaction because an inbox sorted by `lastMessageAt` would
   * otherwise be able to miss a message that had already been delivered.
   */
  async createMessage(threadId: string, senderId: string, text: string): Promise<ChatMessage> {
    const [message] = await this.db.$transaction([
      this.db.chatMessage.create({ data: { threadId, senderId, text } }),
      this.db.chatThread.update({
        where: { id: threadId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
  }

  /** Both sides of an ad order, so an order screen can open its conversation. */
  async findOrderParties(
    orderId: string,
    userId: string,
  ): Promise<{ buyerId: string; sellerId: string } | null> {
    return this.db.adOrder.findFirst({
      where: { id: orderId, OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: { buyerId: true, sellerId: true },
    });
  }

  async findUser(id: string): Promise<{ id: string; name: string | null } | null> {
    return this.db.user.findUnique({ where: { id }, select: { id: true, name: true } });
  }
}
