import type { AdOrder } from '@prisma/client';
import {
  AD_ORDER_STATUS_LABEL,
  AD_ORDER_STEP_NAMES,
  AD_ORDER_STEP_STATES,
  ORDERS_DISPLAY_TIMEZONE,
} from './orders.constants';

/** An ad order with the two joins the tracking screen labels it by. */
export type AdOrderTrackable = AdOrder & {
  ad: { icon: string };
  seller: { id: string; name: string | null };
};

/** One order against a listing, as the tracking screen's timeline. */
export function toAdOrderTrackingJson(
  order: AdOrderTrackable,
  viewerId: string,
): Record<string, unknown> {
  const states = AD_ORDER_STEP_STATES[order.status];
  // The instant each milestone actually happened, index-aligned with the step
  // names. A step with no stamp has not been reached.
  const stamps = [order.createdAt, order.acceptedAt, order.acceptedAt, order.completedAt];

  return {
    orderId: order.code,
    serviceName: order.serviceName,
    serviceIcon: order.ad.icon,
    providerName: order.seller.name ?? 'ELK Seller',
    // Who to open a conversation with from this screen. Chat is between
    // accounts, so the screen needs a person, not an order.
    contactId: order.sellerId === viewerId ? order.buyerId : order.sellerId,
    statusLabel: AD_ORDER_STATUS_LABEL[order.status],
    addressText: order.addressText,
    // Null when the buyer typed the address instead of picking it; the screen
    // then omits the map rather than centring on a guess.
    lat: order.lat === null ? null : Number(order.lat),
    lng: order.lng === null ? null : Number(order.lng),
    steps: AD_ORDER_STEP_NAMES.map((name, i) => ({
      name,
      time: adStepTime(stamps[i] ?? null, states[i]!),
      status: states[i]!,
    })),
  };
}

/** "Today, 9:15 AM" — the label a completed step carries. */
function dateHeader(date: Date): string {
  const time = date.toLocaleString('en-US', {
    timeZone: ORDERS_DISPLAY_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  if (new Date().toDateString() === date.toDateString()) return `Today, ${time}`;
  const day = date.toLocaleString('en-US', {
    timeZone: ORDERS_DISPLAY_TIMEZONE,
    day: 'numeric',
    month: 'short',
  });
  return `${day}, ${time}`;
}

/** Real times for reached steps; "—" for pending, "ETA: soon" for the active one. */
function adStepTime(at: Date | null, status: string): string {
  if (status === 'pending') return '—';
  if (status === 'active') return 'ETA: soon';
  return at ? dateHeader(at) : '—';
}
