import { Injectable } from '@nestjs/common';
import { AdOrderStatus } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { AdOrdersService } from '@/modules/marketplace/ad-orders.service';
import { OrdersRepository } from './orders.repository';
import { toAdOrderTrackingJson } from './orders.mapper';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly adOrders: AdOrdersService,
  ) {}

  async getTracking(user: AuthUser, orderId: string): Promise<Record<string, unknown>> {
    const order = await this.orders.findTrackableAdOrder(orderId, user.id);
    if (!order) {
      throw new ResourceNotFoundException('Order');
    }
    return toAdOrderTrackingJson(order, user.id);
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
