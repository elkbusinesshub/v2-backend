import { ProviderStatus } from '@prisma/client';

/** Dashboard verification badge per profile status. */
export const PROVIDER_MODE_LABEL: Record<ProviderStatus, string> = {
  [ProviderStatus.PENDING]: '⏳ PENDING REVIEW',
  [ProviderStatus.VERIFIED]: '✓ VERIFIED',
  [ProviderStatus.REJECTED]: '✕ REJECTED',
};

/** Weekday column labels on the schedule strip (Mon→Sun). */
export const SCHEDULE_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** Fixed daily work slots. Statuses are derived from accepted-request load. */
export const SCHEDULE_SLOTS = ['09:00 – 12:00', '13:00 – 16:00', '17:00 – 20:00'] as const;

/**
 * Trend captions on the dashboard/earnings cards — pure display strings until
 * a real time-series exists (mirrors the seeded `trend` fixtures).
 */
export const EARNINGS_TREND = {
  month: '▲ 12% vs last month',
  completedJobs: '▲ 6 this week',
  avgPerJob: '▲ AED 8',
} as const;

export const DASHBOARD_TREND = {
  activeOrders: '▲ 2 new',
  thisMonth: '▲ 12%',
} as const;
