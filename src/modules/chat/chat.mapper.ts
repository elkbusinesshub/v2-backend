import type { ChatMessage } from '@prisma/client';
import { initialsOf } from '@/common/utils/initials';
import type { ChatThreadRow } from './chat.repository';
import {
  CHAT_CONTACT_SUBTITLE,
  CHAT_DISPLAY_TIMEZONE,
  CHAT_PREVIEW_LENGTH,
} from './chat.constants';

/** "9:16 AM" in the display timezone. */
function clockTime(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: CHAT_DISPLAY_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** "Today, 9:15 AM" — the thread's date header. */
function dateHeader(date: Date): string {
  const time = clockTime(date);
  if (new Date().toDateString() === date.toDateString()) return `Today, ${time}`;
  const day = date.toLocaleString('en-US', {
    timeZone: CHAT_DISPLAY_TIMEZONE,
    day: 'numeric',
    month: 'short',
  });
  return `${day}, ${time}`;
}

/** "9:16 AM" today, "12 Aug" before that — an inbox wants the coarser label. */
function inboxTime(date: Date): string {
  if (new Date().toDateString() === date.toDateString()) return clockTime(date);
  return date.toLocaleString('en-US', {
    timeZone: CHAT_DISPLAY_TIMEZONE,
    day: 'numeric',
    month: 'short',
  });
}

/** The account on the other side of [thread] from [viewerId]. */
export function counterpartOf(
  thread: ChatThreadRow,
  viewerId: string,
): { id: string; name: string } {
  const other = thread.userAId === viewerId ? thread.userB : thread.userA;
  return { id: other.id, name: other.name ?? 'ELK user' };
}

/**
 * One message, as the side reading it sees it.
 *
 * "Mine" or "theirs" is a fact about the reader, never about the message —
 * getting that backwards is what made both parties see an entire conversation
 * as their own.
 */
export function toMessageJson(
  message: ChatMessage,
  viewerId: string,
  contactInitials: string,
): Record<string, unknown> {
  const isOutgoing = message.senderId === viewerId;
  return {
    id: message.id,
    text: message.text,
    time: clockTime(message.createdAt),
    isOutgoing,
    senderInitials: isOutgoing ? null : contactInitials,
    readAt: message.readAt?.toISOString() ?? null,
  };
}

export function toThreadJson(
  thread: ChatThreadRow,
  messages: ChatMessage[],
  viewerId: string,
): Record<string, unknown> {
  const contact = counterpartOf(thread, viewerId);
  const contactInitials = initialsOf(contact.name);
  return {
    threadId: thread.id,
    // The client addresses a conversation by *who* it is with, so this is the
    // id it navigates to and the one it sends against.
    contactId: contact.id,
    contactName: contact.name,
    contactInitials,
    contactStatus: CHAT_CONTACT_SUBTITLE,
    dateLabel: dateHeader(messages[0]?.createdAt ?? thread.createdAt),
    messages: messages.map((m) => toMessageJson(m, viewerId, contactInitials)),
  };
}

/** One row of the conversations list. */
export function toInboxRowJson(
  thread: ChatThreadRow,
  viewerId: string,
  latest: ChatMessage | undefined,
  unreadCount: number,
): Record<string, unknown> {
  const contact = counterpartOf(thread, viewerId);
  const preview = latest?.text ?? '';
  return {
    threadId: thread.id,
    contactId: contact.id,
    contactName: contact.name,
    contactInitials: initialsOf(contact.name),
    // "You: " so a list of replies is not mistaken for a list of questions.
    preview:
      preview.length > CHAT_PREVIEW_LENGTH
        ? `${preview.slice(0, CHAT_PREVIEW_LENGTH - 1)}…`
        : preview,
    isPreviewMine: latest ? latest.senderId === viewerId : false,
    timeLabel: inboxTime(latest?.createdAt ?? thread.lastMessageAt),
    lastMessageAt: thread.lastMessageAt.toISOString(),
    unreadCount,
  };
}
