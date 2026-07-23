import type { WalletTransaction } from '@prisma/client';
import { displayDate } from '@/common/utils/display-date';

export function toTransactionJson(txn: WalletTransaction): Record<string, unknown> {
  return {
    icon: txn.icon,
    title: txn.title,
    date: displayDate(txn.createdAt),
    amount: Number(txn.amount),
    isCredit: txn.isCredit,
    colorHex: txn.colorHex,
  };
}
