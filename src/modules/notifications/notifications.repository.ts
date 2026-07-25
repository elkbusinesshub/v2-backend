import { Inject, Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findAllByUser(userId: string): Promise<Notification[]> {
    return this.db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async create(data: Prisma.NotificationUncheckedCreateInput): Promise<Notification> {
    return this.db.notification.create({ data });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
