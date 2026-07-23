import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import {
  PAYMENT_METHOD_CATALOG,
  PAYMENT_METHOD_IDS,
  PAYMENT_REFERENCE_SPAN,
  WALLET_TXN_PAYMENT,
  WALLET_TXN_TOPUP,
  WALLET_TXN_WITHDRAW,
} from './wallet.constants';
import type { ChargeDto, WalletAmountDto } from './wallet.dto';
import { toTransactionJson } from './wallet.mapper';
import { WalletRepository } from './wallet.repository';

@Injectable()
export class WalletService {
  constructor(private readonly wallet: WalletRepository) {}

  // ─── payments ──────────────────────────────────────────────────────────────

  async listPaymentMethods(user: AuthUser): Promise<Record<string, unknown>[]> {
    const balance = await this.wallet.getBalance(user.id);
    if (balance === null) {
      throw new ResourceNotFoundException('User');
    }
    return PAYMENT_METHOD_IDS.map((id) => {
      const entry = PAYMENT_METHOD_CATALOG[id]!;
      return {
        id,
        icon: entry.icon,
        label: entry.label,
        subLabel: id === 'wallet' ? `Balance: AED ${balance.toFixed(0)}` : entry.subLabel,
        colorHex: entry.colorHex,
      };
    });
  }

  /**
   * Charges [dto.amount] via [dto.methodId]. The wallet method actually
   * debits the real balance (402 if insufficient); other methods are mock
   * charges — no real gateway exists yet — but are still logged as payment
   * activity so the wallet history reads the same either way.
   */
  async charge(user: AuthUser, dto: ChargeDto): Promise<{ reference: string }> {
    const reference = generateReference();
    const entry = { ...WALLET_TXN_PAYMENT, amount: dto.amount, isCredit: false };

    if (dto.methodId === 'wallet') {
      const newBalance = await this.wallet.debitIfSufficient(user.id, dto.amount, entry);
      if (newBalance === null) {
        throw new DomainException(
          HttpStatus.PAYMENT_REQUIRED,
          'INSUFFICIENT_BALANCE',
          'Insufficient wallet balance',
        );
      }
    } else {
      await this.wallet.logActivity(user.id, entry);
    }
    return { reference };
  }

  // ─── wallet ────────────────────────────────────────────────────────────────

  async getSummary(user: AuthUser): Promise<Record<string, unknown>> {
    const summary = await this.wallet.getSummary(user.id);
    if (!summary) {
      throw new ResourceNotFoundException('User');
    }
    return {
      balance: summary.balance,
      rewardPoints: summary.rewardPoints,
      transactions: summary.transactions.map(toTransactionJson),
    };
  }

  async topUp(user: AuthUser, dto: WalletAmountDto): Promise<{ balance: number }> {
    const balance = await this.wallet.credit(user.id, dto.amount, {
      ...WALLET_TXN_TOPUP,
      amount: dto.amount,
      isCredit: true,
    });
    return { balance };
  }

  async withdraw(user: AuthUser, dto: WalletAmountDto): Promise<{ balance: number }> {
    const balance = await this.wallet.debitIfSufficient(user.id, dto.amount, {
      ...WALLET_TXN_WITHDRAW,
      amount: dto.amount,
      isCredit: false,
    });
    if (balance === null) {
      throw new DomainException(
        HttpStatus.PAYMENT_REQUIRED,
        'INSUFFICIENT_BALANCE',
        'Insufficient wallet balance',
      );
    }
    return { balance };
  }
}

/** e.g. #ELK-2026-04921 */
function generateReference(): string {
  return `#ELK-${new Date().getFullYear()}-${randomInt(PAYMENT_REFERENCE_SPAN).toString().padStart(5, '0')}`;
}
