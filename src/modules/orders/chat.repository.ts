import { Inject, Injectable } from '@nestjs/common';
import type { Booking, ChatMessage, Prisma, Service } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export type BookingWithService = Booking & { service: Service };

/**
 * A chat thread's owner, whichever kind of job it belongs to.
 *
 * Chat used to hang off `bookings` alone. Four verticals now write ad orders
 * instead, so a thread has two possible parents and this is the shape both
 * collapse to — enough to render a header and to prove the caller owns it.
 */
export interface ChatThreadOwner {
  id: string;
  /** Which column on `chat_messages` points at it. */
  parent: 'booking' | 'adOrder';
  /** Whoever the customer is talking to. */
  contactName: string;
  createdAt: Date;
}

@Injectable()
export class ChatRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** Scoped to [userId] so a mismatched owner behaves exactly like "not found". */
  async findBookingForUser(id: string, userId: string): Promise<BookingWithService | null> {
    return this.db.booking.findFirst({ where: { id, userId }, include: { service: true } });
  }

  /**
   * The thread [id] belongs to, or null when the caller does not own it.
   *
   * A booking is looked up first because that is what most existing threads
   * are; an id that is neither reads as missing, which is what it is as far
   * as this caller is concerned.
   */
  async findThreadOwner(id: string, userId: string): Promise<ChatThreadOwner | null> {
    const booking = await this.findBookingForUser(id, userId);
    if (booking) {
      return {
        id: booking.id,
        parent: 'booking',
        contactName: booking.service.providerName,
        createdAt: booking.createdAt,
      };
    }

    // Either side of an order can open its thread — the buyer to ask, the
    // seller to answer — so this is not scoped to the buyer alone.
    const order = await this.db.adOrder.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: { seller: { select: { name: true } }, buyer: { select: { name: true } } },
    });
    if (!order) return null;

    return {
      id: order.id,
      parent: 'adOrder',
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
      where: owner.parent === 'booking' ? { bookingId: owner.id } : { adOrderId: owner.id },
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
