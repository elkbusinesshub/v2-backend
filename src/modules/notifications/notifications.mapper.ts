import type { Notification } from '@prisma/client';
import { relativeTime } from '@/common/utils/relative-time';

/** Matches the Flutter `NotificationModel.fromJson` contract field-for-field. */
export function toNotificationJson(notification: Notification): Record<string, unknown> {
  return {
    id: notification.id,
    icon: notification.icon,
    colorHex: notification.colorHex,
    title: notification.title,
    message: notification.message,
    time: relativeTime(notification.createdAt),
    isUnread: !notification.isRead,
  };
}
