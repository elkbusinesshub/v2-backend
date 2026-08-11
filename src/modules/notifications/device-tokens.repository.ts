import { Inject, Injectable } from '@nestjs/common';
import type { DevicePlatform, DeviceToken } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class DeviceTokensRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /**
   * Claims [token] for [userId].
   *
   * Upserting on the token (not on user+token) is what moves a re-sold or
   * shared handset to its new owner — otherwise the previous user would keep
   * receiving that device's notifications.
   */
  async register(userId: string, token: string, platform: DevicePlatform): Promise<DeviceToken> {
    return this.db.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  async findTokensByUser(userId: string): Promise<string[]> {
    const rows = await this.db.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  /** Signing out on one device must not silence the user's other devices. */
  async remove(userId: string, token: string): Promise<void> {
    await this.db.deviceToken.deleteMany({ where: { userId, token } });
  }

  /** Drops tokens FCM has rejected as dead. Not scoped to a user — a dead token is dead for everyone. */
  async removeMany(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.deviceToken.deleteMany({ where: { token: { in: tokens } } });
  }
}
