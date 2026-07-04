import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, RefreshSession, User } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export type SessionWithUser = RefreshSession & { user: User };

@Injectable()
export class RefreshSessionRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async create(data: Prisma.RefreshSessionUncheckedCreateInput): Promise<RefreshSession> {
    return this.db.refreshSession.create({ data });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    return this.db.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  /**
   * Atomically claims a session for rotation: succeeds only if the session
   * is still unrevoked. Two concurrent refreshes with the same token can
   * never both succeed — the loser is treated as token reuse.
   */
  async claim(id: string, replacedByTokenHash: string): Promise<boolean> {
    const result = await this.db.refreshSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), replacedByTokenHash },
    });
    return result.count === 1;
  }

  async revoke(id: string): Promise<void> {
    await this.db.refreshSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes an entire rotation chain — the reuse-detection response. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.db.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
