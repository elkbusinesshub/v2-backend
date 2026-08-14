import { ProviderStatus } from '@prisma/client';

/** Dashboard verification badge per profile status. */
export const PROVIDER_MODE_LABEL: Record<ProviderStatus, string> = {
  [ProviderStatus.PENDING]: '⏳ PENDING REVIEW',
  [ProviderStatus.VERIFIED]: '✓ VERIFIED',
  [ProviderStatus.REJECTED]: '✕ REJECTED',
};

/** Weekday column labels on the schedule strip (Mon→Sun). */
export const SCHEDULE_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** Fixed daily work slots. Statuses are derived from today's order load. */
export const SCHEDULE_SLOTS = ['09:00 – 12:00', '13:00 – 16:00', '17:00 – 20:00'] as const;

/** Tile colour behind an earnings row. */
export const EARNINGS_TILE_COLOR = 0xffe0f7f5;
