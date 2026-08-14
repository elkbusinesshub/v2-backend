import { Inject, Injectable } from '@nestjs/common';
import type { ChatMessage, Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/**
 * A chat thread's owner — always an order placed against a listing.
 *
 * This is the shape the thread header renders from, and the proof that the
 * caller is on it.
 */
export interface ChatThreadOwner {
  id: string;
  /** Whoever the customer is talking to. */
  contactName: string;
  createdAt: Date;
}

@Injectable()
export class ChatRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** The thread [id] belongs to, or null when the caller is not on it. */
  async findThreadOwner(id: string, userId: string): Promise<ChatThreadOwner | null> {
    // Either side of an order can open its thread — the buyer to ask, the
    // seller to answer — so this is not scoped to the buyer alone.
    const order = await this.db.adOrder.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: { seller: { select: { name: true } }, buyer: { select: { name: true } } },
    });
    if (!order) return null;

    return {
      id: order.id,
      // Each side sees the other, rather than the customer always seeing a
      // "provider" and the seller seeing themselves.
      contactName:
        order.sellerId === userId
          ? (order.buyer.name ?? 'ELK customer')
          : (order.seller.name ?? 'ELK Seller'),
      createdAt: order.createdAt,
    };
  }

  async listMessages(owner: ChatThreadOwner): Promise<ChatMessage[]> {
    return this.db.chatMessage.findMany({
      where: { adOrderId: owner.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * An order against a listing, for the tracking screen.
   *
   * Visible to both sides: the buyer watching progress, and the seller
   * checking what they agreed to.
   */
  async findTrackableAdOrder(id: string, userId: string) {
    return this.db.adOrder.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: { ad: { select: { icon: true } }, seller: { select: { name: true } } },
    });
  }

  async create(data: Prisma.ChatMessageUncheckedCreateInput): Promise<ChatMessage> {
    return this.db.chatMessage.create({ data });
  }
}
