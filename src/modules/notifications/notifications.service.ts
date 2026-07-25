import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import type { CreateNotificationDto } from './notifications.dto';
import { toNotificationJson } from './notifications.mapper';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationsRepository) {}

  async list(user: AuthUser): Promise<Record<string, unknown>[]> {
    return (await this.notifications.findAllByUser(user.id)).map(toNotificationJson);
  }

  async markAllRead(user: AuthUser): Promise<void> {
    await this.notifications.markAllRead(user.id);
  }

  /** Ops/other services raise a notification for a user (not user-facing). */
  async create(dto: CreateNotificationDto): Promise<Record<string, unknown>> {
    const notification = await this.notifications.create({
      userId: dto.userId,
      icon: dto.icon,
      colorHex: dto.colorHex,
      title: dto.title,
      message: dto.message,
    });
    return toNotificationJson(notification);
  }
}
