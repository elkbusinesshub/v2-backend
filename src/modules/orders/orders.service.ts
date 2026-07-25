import { HttpStatus, Injectable } from '@nestjs/common';
import { initialsOf } from '@/common/utils/initials';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingsRepository } from '@/modules/bookings/bookings.repository';
import { ChatGateway } from './chat.gateway';
import { ChatRepository } from './chat.repository';
import type { SendMessageDto } from './orders.dto';
import { toMessageJson, toThreadJson, toTrackingJson } from './orders.mapper';

@Injectable()
export class OrdersService {
  constructor(
    private readonly chat: ChatRepository,
    private readonly bookings: BookingsRepository,
    private readonly gateway: ChatGateway,
  ) {}

  // ─── chat ────────────────────────────────────────────────────────────────

  async getThread(user: AuthUser, bookingId: string): Promise<Record<string, unknown>> {
    const booking = await this.assertOrder(user, bookingId);
    const messages = await this.chat.listMessages(bookingId);
    return toThreadJson(booking, messages);
  }

  /** Persists a customer message, then fans it out over the /chat gateway. */
  async sendMessage(
    user: AuthUser,
    bookingId: string,
    dto: SendMessageDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.assertOrder(user, bookingId);
    const message = await this.chat.create({
      bookingId,
      fromProvider: false,
      text: dto.text,
    });
    const json = toMessageJson(message, initialsOf(booking.service.providerName));
    this.gateway.emitMessage(bookingId, json);
    return json;
  }

  // ─── tracking ──────────────────────────────────────────────────────────────

  async getTracking(user: AuthUser, bookingId: string): Promise<Record<string, unknown>> {
    const booking = await this.assertOrder(user, bookingId);
    return toTrackingJson(booking);
  }

  async cancelOrder(user: AuthUser, bookingId: string): Promise<void> {
    await this.assertOrder(user, bookingId);
    const cancelled = await this.bookings.cancel(bookingId);
    if (!cancelled) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'ORDER_NOT_CANCELLABLE',
        'Only upcoming confirmed orders can be cancelled',
      );
    }
  }

  private async assertOrder(user: AuthUser, bookingId: string) {
    const booking = await this.chat.findBookingForUser(bookingId, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Order');
    }
    return booking;
  }
}
