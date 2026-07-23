import { Inject, Injectable } from '@nestjs/common';
import {
  ProviderRequestStatus,
  type Prisma,
  type ProviderProfile,
  type ProviderRequest,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class ProviderRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ─── profile ───────────────────────────────────────────────────────────────

  async findProfileByUser(userId: string): Promise<ProviderProfile | null> {
    return this.db.providerProfile.findUnique({ where: { userId } });
  }

  async createProfile(data: Prisma.ProviderProfileUncheckedCreateInput): Promise<ProviderProfile> {
    return this.db.providerProfile.create({ data });
  }

  async updateProfile(
    id: string,
    data: Prisma.ProviderProfileUncheckedUpdateInput,
  ): Promise<ProviderProfile> {
    return this.db.providerProfile.update({ where: { id }, data });
  }

  /** Verifies (or rejects) a provider and, on verify, grants the PROVIDER role — atomically. */
  async setStatusAndRole(
    profileId: string,
    userId: string,
    status: 'VERIFIED' | 'REJECTED',
    roles: string[],
  ): Promise<ProviderProfile> {
    return this.db.$transaction(async (tx) => {
      if (status === 'VERIFIED') {
        await tx.user.update({ where: { id: userId }, data: { roles } });
      }
      return tx.providerProfile.update({ where: { id: profileId }, data: { status } });
    });
  }

  // ─── requests ────────────────────────────────────────────────────────────────

  async listRequests(providerId: string): Promise<ProviderRequest[]> {
    return this.db.providerRequest.findMany({
      where: { providerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findRequestForProvider(id: string, providerId: string): Promise<ProviderRequest | null> {
    return this.db.providerRequest.findFirst({ where: { id, providerId } });
  }

  /** Accept/decline transition — succeeds only from PENDING (idempotency + races). */
  async respondToRequest(id: string, accept: boolean): Promise<boolean> {
    const result = await this.db.providerRequest.updateMany({
      where: { id, status: ProviderRequestStatus.PENDING },
      data: {
        status: accept ? ProviderRequestStatus.ACCEPTED : ProviderRequestStatus.DECLINED,
      },
    });
    return result.count === 1;
  }
}
