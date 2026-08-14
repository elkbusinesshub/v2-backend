import { Injectable } from '@nestjs/common';
import { AdOrderStatus } from '@prisma/client';
import { initialsOf } from '@/common/utils/initials';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { AdOrdersService } from '@/modules/marketplace/ad-orders.service';
import { ChatGateway } from './chat.gateway';
import { ChatRepository } from './chat.repository';
import type { SendMessageDto } from './orders.dto';
import { toAdOrderTrackingJson, toMessageJson, toThreadJson } from './orders.mapper';

@Injectable()
export class OrdersService {
  constructor(
    private readonly chat: ChatRepository,
    private readonly adOrders: AdOrdersService,
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
      adOrderId: owner.id,
      fromProvider: false,
      text: dto.text,
    });
    const json = toMessageJson(message, initialsOf(owner.contactName));
    this.gateway.emitMessage(orderId, json);
    return json;
  }

  /** The thread [orderId] names, or a 404 when the caller is not on it. */
  private async assertThread(user: AuthUser, orderId: string) {
    const owner = await this.chat.findThreadOwner(orderId, user.id);
    if (!owner) {
      throw new ResourceNotFoundException('Order');
    }
    return owner;
  }

  // ─── tracking ──────────────────────────────────────────────────────────────

  async getTracking(user: AuthUser, orderId: string): Promise<Record<string, unknown>> {
    const order = await this.chat.findTrackableAdOrder(orderId, user.id);
    if (!order) {
      throw new ResourceNotFoundException('Order');
    }
    return toAdOrderTrackingJson(order);
  }

  /**
   * Cancels from the tracking screen.
   *
   * Delegated rather than reimplemented, so this endpoint enforces the same
   * rule as the marketplace one: a buyer may walk away only before the seller
   * has started work.
   */
  async cancelOrder(user: AuthUser, orderId: string): Promise<void> {
    await this.adOrders.setStatus(user, orderId, AdOrderStatus.CANCELLED);
  }
}
