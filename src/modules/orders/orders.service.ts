import { HttpStatus, Injectable } from '@nestjs/common';
import { initialsOf } from '@/common/utils/initials';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingsRepository } from '@/modules/bookings/bookings.repository';
import { ChatGateway } from './chat.gateway';
import { ChatRepository } from './chat.repository';
import type { SendMessageDto } from './orders.dto';
import {
  toAdOrderTrackingJson,
  toMessageJson,
  toThreadJson,
  toTrackingJson,
} from './orders.mapper';

@Injectable()
export class OrdersService {
  constructor(
    private readonly chat: ChatRepository,
    private readonly bookings: BookingsRepository,
    private readonly gateway: ChatGateway,
  ) {}

  // ─── chat ────────────────────────────────────────────────────────────────

  async getThread(user: AuthUser, orderId: string): Promise<Record<string, unknown>> {
    const owner = await this.assertThread(user, orderId);
    return toThreadJson(owner, await this.chat.listMessages(owner));
  }

  /** Persists a customer message, then fans it out over the /chat gateway. */
  async sendMessage(
    user: AuthUser,
    orderId: string,
    dto: SendMessageDto,
  ): Promise<Record<string, unknown>> {
    const owner = await this.assertThread(user, orderId);
    const message = await this.chat.create({
      // Exactly one parent is set; the other column stays null.
      ...(owner.parent === 'booking' ? { bookingId: owner.id } : { adOrderId: owner.id }),
      fromProvider: false,
      text: dto.text,
    });
    const json = toMessageJson(message, initialsOf(owner.contactName));
    this.gateway.emitMessage(orderId, json);
    return json;
  }

  /**
   * The thread [orderId] names, or a 404 when the caller does not own it.
   *
   * A thread now hangs off either a catalogue booking or an order placed
   * against a listing, so this resolves both rather than assuming the former.
   */
  private async assertThread(user: AuthUser, orderId: string) {
    const owner = await this.chat.findThreadOwner(orderId, user.id);
    if (!owner) {
      throw new ResourceNotFoundException('Order');
    }
    return owner;
  }

  // ─── tracking ──────────────────────────────────────────────────────────────

  async getTracking(user: AuthUser, orderId: string): Promise<Record<string, unknown>> {
    // Most things being tracked are ad orders now; a booking id only resolves
    // for the catalogue bookings that predate the migration.
    const order = await this.chat.findTrackableAdOrder(orderId, user.id);
    if (order) {
      return toAdOrderTrackingJson(order);
    }
    return toTrackingJson(await this.assertOrder(user, orderId));
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
