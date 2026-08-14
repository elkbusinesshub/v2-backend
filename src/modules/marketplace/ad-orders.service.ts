import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AdOrderStatus, Role } from '@prisma/client';
import {
  DomainException,
  ForbiddenResourceException,
  ResourceNotFoundException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { displayDate } from '@/common/utils/display-date';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AdOrdersRepository, type AdOrderRow } from './ad-orders.repository';
import type { AdOrderDto, CreateAdOrderDto } from './marketplace.dto';
import { MarketplaceRepository } from './marketplace.repository';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 5;

/** Tile colour for the notification a new order raises. */
const ORDER_NOTIFICATION_COLOR = 0xffe0f7f5;

/**
 * Which transitions each side may make, and from where.
 *
 * A seller works an order forward; a buyer may only walk away, and only before
 * the seller has started. Anything else is a 409 rather than a silent no-op, so
 * a stale screen tapping "Complete" twice is told why.
 */
const SELLER_TRANSITIONS: Record<AdOrderStatus, AdOrderStatus[]> = {
  [AdOrderStatus.NEW]: [AdOrderStatus.IN_PROGRESS, AdOrderStatus.CANCELLED],
  [AdOrderStatus.IN_PROGRESS]: [AdOrderStatus.COMPLETED, AdOrderStatus.CANCELLED],
  [AdOrderStatus.COMPLETED]: [],
  [AdOrderStatus.CANCELLED]: [],
};

const BUYER_TRANSITIONS: Record<AdOrderStatus, AdOrderStatus[]> = {
  [AdOrderStatus.NEW]: [AdOrderStatus.CANCELLED],
  [AdOrderStatus.IN_PROGRESS]: [],
  [AdOrderStatus.COMPLETED]: [],
  [AdOrderStatus.CANCELLED]: [],
};

@Injectable()
export class AdOrdersService {
  private readonly logger = new Logger(AdOrdersService.name);

  constructor(
    private readonly orders: AdOrdersRepository,
    private readonly ads: MarketplaceRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /** A buyer orders a listing. */
  async place(user: AuthUser, adId: string, dto: CreateAdOrderDto): Promise<AdOrderDto> {
    const ad = await this.ads.findById(adId);
    // findById is scoped to ACTIVE, so a draft or paused listing reads as
    // missing — which is what it is, as far as a buyer is concerned.
    if (!ad) {
      throw new ResourceNotFoundException('Ad');
    }
    if (ad.sellerId === user.id) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'CANNOT_ORDER_OWN_LISTING',
        'You cannot order your own listing',
      );
    }

    const quantity = dto.quantity ?? 1;
    const order = await this.orders.create({
      code: `ELK-A-${this.randomCode()}`,
      adId: ad.id,
      buyerId: user.id,
      // Snapshotted, not joined: a listing that changes hands or is repriced
      // must not rewrite who was owed what for work already ordered.
      sellerId: ad.sellerId,
      // Computed here, never taken from the client — the buyer's device does
      // not get to say what it owes. An enquiry costs nothing: asking to view
      // a room is not the same as taking it for a month.
      amount: dto.isEnquiry ? 0 : Number(ad.price) * quantity,
      quantity,
      serviceName: ad.title,
      addressText: dto.addressText,
      contactPhone: dto.contactPhone,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      durationMonths: dto.durationMonths ?? null,
      depositAmount: dto.depositAmount ?? null,
      feesAmount: dto.feesAmount ?? 0,
      taxAmount: dto.taxAmount ?? 0,
      note: dto.note ?? null,
    });

    // The seller has no live connection to the panel, so this is the only way
    // they learn an order arrived. Failure must not fail the order.
    try {
      await this.notifications.create({
        userId: ad.sellerId,
        icon: ad.icon,
        colorHex: ORDER_NOTIFICATION_COLOR,
        title: 'New order',
        message: `${order.buyer.name ?? 'A customer'} ordered ${ad.title}.`,
      });
    } catch (err) {
      this.logger.warn({ err, orderId: order.id }, 'could not notify seller of new order');
    }

    return this.toJson(order);
  }

  async listForSeller(user: AuthUser, status?: AdOrderStatus): Promise<AdOrderDto[]> {
    return (await this.orders.findForSeller(user.id, status)).map((o) => this.toJson(o));
  }

  async listForBuyer(user: AuthUser, status?: AdOrderStatus): Promise<AdOrderDto[]> {
    return (await this.orders.findForBuyer(user.id, status)).map((o) => this.toJson(o));
  }

  async countsForSeller(user: AuthUser): Promise<Record<string, number>> {
    return this.orders.countsForSeller(user.id);
  }

  async setStatus(user: AuthUser, id: string, next: AdOrderStatus): Promise<AdOrderDto> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw new ResourceNotFoundException('Order');
    }

    const isAdmin = user.roles.includes(Role.ADMIN);
    const isSeller = order.sellerId === user.id;
    const isBuyer = order.buyerId === user.id;
    if (!isAdmin && !isSeller && !isBuyer) {
      throw new ForbiddenResourceException('This is not your order');
    }

    const allowed =
      isSeller || isAdmin ? SELLER_TRANSITIONS[order.status] : BUYER_TRANSITIONS[order.status];
    if (!allowed.includes(next)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        `An order that is ${order.status.toLowerCase()} cannot become ${next.toLowerCase()}`,
      );
    }

    const now = new Date();
    const updated = await this.orders.updateStatus(id, next, {
      ...(next === AdOrderStatus.IN_PROGRESS ? { acceptedAt: now } : {}),
      ...(next === AdOrderStatus.COMPLETED ? { completedAt: now } : {}),
      ...(next === AdOrderStatus.CANCELLED ? { cancelledAt: now } : {}),
    });

    // The other party is the one who needs telling; whoever made the change
    // already knows.
    const recipient = isBuyer ? order.sellerId : order.buyerId;
    try {
      await this.notifications.create({
        userId: recipient,
        icon: order.ad.icon,
        colorHex: ORDER_NOTIFICATION_COLOR,
        title: `Order ${next.toLowerCase().replace('_', ' ')}`,
        message: `${order.serviceName} · ${order.code}`,
      });
    } catch (err) {
      this.logger.warn({ err, orderId: id }, 'could not notify the other party');
    }

    return this.toJson(updated);
  }

  private toJson(order: AdOrderRow): AdOrderDto {
    return {
      id: order.id,
      code: order.code,
      adId: order.adId,
      status: order.status,
      amount: Number(order.amount),
      quantity: order.quantity,
      feesAmount: Number(order.feesAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.amount) + Number(order.feesAmount) + Number(order.taxAmount),
      serviceName: order.serviceName,
      icon: order.ad.icon,
      customerName: order.buyer.name ?? 'ELK customer',
      customerPhone: order.buyer.phone ?? order.contactPhone,
      addressText: order.addressText,
      note: order.note,
      // A label the panel shows verbatim; the raw instant is alongside it for
      // any caller that wants to format it differently.
      whenLabel: order.scheduledAt ? displayDate(order.scheduledAt) : 'As soon as possible',
      scheduledAt: order.scheduledAt?.toISOString() ?? null,
      endAt: order.endAt?.toISOString() ?? null,
      durationMonths: order.durationMonths,
      depositAmount: order.depositAmount === null ? null : Number(order.depositAmount),
      createdAt: order.createdAt.toISOString(),
    };
  }

  private randomCode(): string {
    return Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('');
  }
}
