import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WalletTransaction } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export interface WalletSummary {
  balance: number;
  rewardPoints: number;
  transactions: WalletTransaction[];
}

type TxnEntry = Omit<Prisma.WalletTransactionUncheckedCreateInput, 'userId'>;

@Injectable()
export class WalletRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async getBalance(userId: string): Promise<number | null> {
    const user = await this.db.user.findFirst({
      where: { id: userId },
      select: { walletBalance: true },
    });
    return user ? Number(user.walletBalance) : null;
  }

  async getSummary(userId: string): Promise<WalletSummary | null> {
    const user = await this.db.user.findFirst({
      where: { id: userId },
      select: { walletBalance: true, rewardPoints: true },
    });
    if (!user) return null;
    const transactions = await this.db.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { balance: Number(user.walletBalance), rewardPoints: user.rewardPoints, transactions };
  }

  /** Credits the balance and logs the transaction atomically. Returns the new balance. */
  async credit(userId: string, amount: number, entry: TxnEntry): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { walletBalance: { increment: amount } },
      });
      await tx.walletTransaction.create({ data: { ...entry, userId } });
      return Number(user.walletBalance);
    });
  }

  /**
   * Debits the balance only if sufficient, logging the transaction in the
   * same atomic step. Returns null when the balance is insufficient — the
   * `gte` guard on the update means a concurrent debit can never overdraw it.
   */
  async debitIfSufficient(userId: string, amount: number, entry: TxnEntry): Promise<number | null> {
    return this.db.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: userId, walletBalance: { gte: amount } },
        data: { walletBalance: { decrement: amount } },
      });
      if (result.count !== 1) {
        return null;
      }
      await tx.walletTransaction.create({ data: { ...entry, userId } });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { walletBalance: true },
      });
      return Number(user.walletBalance);
    });
  }

  /** Records payment activity without touching the balance (non-wallet methods). */
  async logActivity(userId: string, entry: TxnEntry): Promise<void> {
    await this.db.walletTransaction.create({ data: { ...entry, userId } });
  }
}
