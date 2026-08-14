import type { AdOrder, ChatMessage } from '@prisma/client';

/** An ad order with the two joins the tracking screen labels it by. */
export type AdOrderTrackable = AdOrder & {
  ad: { icon: string };
  seller: { name: string | null };
};
import { initialsOf } from '@/common/utils/initials';
import type { ChatThreadOwner } from './chat.repository';
import {
  AD_ORDER_STATUS_LABEL,
  AD_ORDER_STEP_NAMES,
  AD_ORDER_STEP_STATES,
  CHAT_CONTACT_STATUS,
  ORDERS_DISPLAY_TIMEZONE,
} from './orders.constants';

/** "9:16 AM" in the display timezone — the chat/tracking time label format. */
function clockTime(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: ORDERS_DISPLAY_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** "Today, 9:15 AM" — the chat thread's date header. */
function dateHeader(date: Date): string {
  const time = clockTime(date);
  const today = new Date().toDateString() === date.toDateString();
  if (today) return `Today, ${time}`;
  const day = date.toLocaleString('en-US', {
    timeZone: ORDERS_DISPLAY_TIMEZONE,
    day: 'numeric',
    month: 'short',
  });
  return `${day}, ${time}`;
}

export function toMessageJson(
  message: ChatMessage,
  providerInitials: string,
): Record<string, unknown> {
  return {
    id: message.id,
    text: message.text,
    time: clockTime(message.createdAt),
    isOutgoing: !message.fromProvider,
    senderInitials: message.fromProvider ? providerInitials : null,
  };
}

export function toThreadJson(
  owner: ChatThreadOwner,
  messages: ChatMessage[],
): Record<string, unknown> {
  const contactInitials = initialsOf(owner.contactName);
  return {
    contactName: owner.contactName,
    contactInitials,
    contactStatus: CHAT_CONTACT_STATUS,
    dateLabel: dateHeader(messages[0]?.createdAt ?? owner.createdAt),
    messages: messages.map((m) => toMessageJson(m, contactInitials)),
  };
}

/** One order against a listing, as the tracking screen's timeline. */
export function toAdOrderTrackingJson(order: AdOrderTrackable): Record<string, unknown> {
  const states = AD_ORDER_STEP_STATES[order.status];
  // The instant each milestone actually happened, index-aligned with the step
  // names. A step with no stamp has not been reached.
  const stamps = [order.createdAt, order.acceptedAt, order.acceptedAt, order.completedAt];

  return {
    orderId: order.code,
    serviceName: order.serviceName,
    serviceIcon: order.ad.icon,
    providerName: order.seller.name ?? 'ELK Seller',
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

/** Real times for reached steps; "—" for pending, "ETA: soon" for the active one. */
function adStepTime(at: Date | null, status: string): string {
  if (status === 'pending') return '—';
  if (status === 'active') return 'ETA: soon';
  return at ? dateHeader(at) : '—';
}
