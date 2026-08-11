import { Injectable, Logger } from '@nestjs/common';
import type { DevicePlatform } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PushService } from '@/push/push.service';
import { DeviceTokensRepository } from './device-tokens.repository';
import type { CreateNotificationDto } from './notifications.dto';
import { toNotificationJson } from './notifications.mapper';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly devices: DeviceTokensRepository,
    private readonly push: PushService,
  ) {}

  async list(user: AuthUser): Promise<Record<string, unknown>[]> {
    return (await this.notifications.findAllByUser(user.id)).map(toNotificationJson);
  }

  async markAllRead(user: AuthUser): Promise<void> {
    await this.notifications.markAllRead(user.id);
  }

  /**
   * Ops/other services raise a notification for a user (not user-facing).
   *
   * The row is written first and the push is best-effort on top: a device that
   * is unreachable, or push being switched off entirely, must not lose the
   * notification — it still appears in `GET /notifications`.
   */
  async create(dto: CreateNotificationDto): Promise<Record<string, unknown>> {
    const notification = await this.notifications.create({
      userId: dto.userId,
      icon: dto.icon,
      colorHex: dto.colorHex,
      title: dto.title,
      message: dto.message,
    });

    await this.deliver(dto.userId, notification.id, dto.title, dto.message);

    return toNotificationJson(notification);
  }

  async registerDevice(userId: string, token: string, platform: DevicePlatform): Promise<void> {
    await this.devices.register(userId, token, platform);
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.devices.remove(userId, token);
  }

  /** Pushes to every device the user has registered, pruning any FCM rejects. */
  private async deliver(
    userId: string,
    notificationId: string,
    title: string,
    body: string,
  ): Promise<void> {
    if (!this.push.isEnabled) return;

    try {
      const tokens = await this.devices.findTokensByUser(userId);
      if (tokens.length === 0) return;

      const result = await this.push.sendToTokens(tokens, {
        title,
        body,
        // The app opens the notifications list and highlights this row.
        data: { notificationId, type: 'notification' },
      });

      if (result.deadTokens.length > 0) {
        await this.devices.removeMany(result.deadTokens);
        this.logger.log(`pruned ${result.deadTokens.length} dead device token(s)`);
      }
    } catch (err) {
      // Delivery is best-effort — the stored notification is the contract.
      this.logger.error({ err, userId }, 'push delivery failed');
    }
  }
}
