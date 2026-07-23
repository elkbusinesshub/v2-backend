import type { Booking, ChatMessage, Service } from '@prisma/client';
import { initialsOf } from '@/common/utils/initials';
import {
  CHAT_CONTACT_STATUS,
  ORDERS_DISPLAY_TIMEZONE,
  TRACKING_STATUS_LABEL,
  TRACKING_STEP_NAMES,
  TRACKING_STEP_STATES,
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
  booking: Booking & { service: Service },
  messages: ChatMessage[],
): Record<string, unknown> {
  const providerInitials = initialsOf(booking.service.providerName);
  return {
    contactName: booking.service.providerName,
    contactInitials: providerInitials,
    contactStatus: CHAT_CONTACT_STATUS,
    dateLabel: dateHeader(messages[0]?.createdAt ?? booking.createdAt),
    messages: messages.map((m) => toMessageJson(m, providerInitials)),
  };
}

export function toTrackingJson(booking: Booking & { service: Service }): Record<string, unknown> {
  const states = TRACKING_STEP_STATES[booking.status];
  return {
    orderId: booking.reference,
    serviceName: booking.service.name,
    serviceIcon: booking.service.icon,
    providerName: booking.service.providerName,
    statusLabel: TRACKING_STATUS_LABEL[booking.status],
    steps: TRACKING_STEP_NAMES.map((name, i) => ({
      name,
      time: stepTime(booking, i, states[i]!),
      status: states[i]!,
    })),
  };
}

/** Concrete times for reached steps; "—" for pending, "ETA: soon" for the active one. */
function stepTime(booking: Booking, index: number, status: string): string {
  if (status === 'pending') return '—';
  if (status === 'active') return 'ETA: soon';
  // done step 0/1 → booking creation; the completed step → cancelledAt/updatedAt
  if (index <= 1) return dateHeader(booking.createdAt);
  return dateHeader(booking.updatedAt);
}
