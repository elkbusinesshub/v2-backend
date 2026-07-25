/** Wire ids the app's payment sheets select by (card/porter/elkclean/repair all reuse these). */
export const PAYMENT_METHOD_IDS = ['wallet', 'card', 'upi', 'cash'] as const;

/** Static catalog entries — only the wallet method's subLabel is computed live from the real balance. */
export const PAYMENT_METHOD_CATALOG: Record<
  string,
  { icon: string; label: string; subLabel: string; colorHex: number }
> = {
  wallet: { icon: '💳', label: 'ELK Wallet', subLabel: '', colorHex: 0xffe0f7f5 },
  card: {
    icon: '💳',
    label: 'Credit/Debit Card',
    subLabel: 'Visa, Mastercard, Amex',
    colorHex: 0xffdbeafe,
  },
  upi: {
    icon: '📱',
    label: 'UPI / Digital Wallet',
    subLabel: 'GPay, PhonePe, Paytm',
    colorHex: 0xffd1fae5,
  },
  cash: {
    icon: '💵',
    label: 'Cash on Delivery',
    subLabel: 'Pay at service completion',
    colorHex: 0xfffef3c7,
  },
};

/** Transaction-log presentation for wallet/payment activity. */
export const WALLET_TXN_TOPUP = { icon: '💳', title: 'Wallet Top-up', colorHex: 0xffd1fae5 };
export const WALLET_TXN_WITHDRAW = { icon: '💸', title: 'Wallet Withdrawal', colorHex: 0xfffee2e2 };
export const WALLET_TXN_PAYMENT = { icon: '💳', title: 'Payment', colorHex: 0xffe0f7f5 };

/** Generic charge reference: ELK-YYYY-##### (matches the app's static fixture shape). */
export const PAYMENT_REFERENCE_SPAN = 100000;
