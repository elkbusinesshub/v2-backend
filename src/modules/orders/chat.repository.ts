import { Inject, Injectable } from '@nestjs/common';
import type { Booking, ChatMessage, Prisma, Service } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export type BookingWithService = Booking & { service: Service };

@Injectable()
export class ChatRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** Scoped to [userId] so a mismatched owner behaves exactly like "not found". */
  async findBookingForUser(id: string, userId: string): Promise<BookingWithService | null> {
    return this.db.booking.findFirst({ where: { id, userId }, include: { service: true } });
  }

  async listMessages(bookingId: string): Promise<ChatMessage[]> {
    return this.db.chatMessage.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(data: Prisma.ChatMessageUncheckedCreateInput): Promise<ChatMessage> {
    return this.db.chatMessage.create({ data });
  }
}
