import { type ProviderProfile } from '@prisma/client';
import { displayDate } from '@/common/utils/display-date';
import {
  EARNINGS_TILE_COLOR,
  PROVIDER_MODE_LABEL,
  SCHEDULE_DAY_LABELS,
  SCHEDULE_SLOTS,
} from './provider.constants';
import type { SellerActivity } from './provider.repository';

/** Rupees with Indian thousands separators, e.g. "₹2,840". */
function aed(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function toDashboardJson(
  profile: ProviderProfile,
  activity: SellerActivity,
): Record<string, unknown> {
  return {
    businessName: profile.businessName,
    modeLabel: PROVIDER_MODE_LABEL[profile.status],
    isAvailable: profile.isAvailable,
    stats: [
      {
        label: 'Active Orders',
        value: String(activity.activeOrders),
        trend:
          activity.activeOrders === 1 ? '1 in progress' : `${activity.activeOrders} in progress`,
      },
      {
        label: 'This Month',
        value: aed(activity.monthEarnings),
        trend: `${activity.completedJobs} completed all time`,
      },
      {
        label: 'Rating',
        // A seller with no ratings yet gets "New" rather than a bare 0★, which
        // reads as a bad score rather than an absent one.
        value: activity.reviewCount === 0 ? 'New' : `${activity.rating}★`,
        trend: activity.reviewCount === 1 ? '1 review' : `${activity.reviewCount} reviews`,
      },
    ],
  };
}

export function toScheduleJson(
  profile: ProviderProfile,
  activity: SellerActivity,
): Record<string, unknown> {
  const days = normalizeDays(profile.scheduleDays);
  const todayIdx = (new Date().getDay() + 6) % 7; // JS Sun=0 → Mon=0 index

  return {
    todaysBookingsCount: activity.todaysBookings,
    days: SCHEDULE_DAY_LABELS.map((label, i) => ({
      label,
      available: days[i] ?? false,
      isToday: i === todayIdx,
    })),
    slots: SCHEDULE_SLOTS.map((timeRange, i) => ({
      timeRange,
      // Slots fill in order with today's load; the rest stay open. There is no
      // per-slot assignment yet, so this shows how full the day is, not when.
      status: i < activity.todaysBookings ? 'active' : 'available',
    })),
  };
}

export function toEarningsJson(
  profile: ProviderProfile,
  activity: SellerActivity,
): Record<string, unknown> {
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const avgPerJob =
    activity.completedJobs === 0 ? 0 : activity.totalEarnings / activity.completedJobs;

  return {
    totalEarnings: activity.totalEarnings,
    monthLabel,
    trendLabel: aed(activity.monthEarnings) + ' this month',
    completedJobs: activity.completedJobs,
    completedJobsTrend: activity.completedJobs === 1 ? '1 job' : `${activity.completedJobs} jobs`,
    avgPerJob: Math.round(avgPerJob * 100) / 100,
    avgPerJobTrend: activity.completedJobs === 0 ? 'No jobs yet' : 'Across completed jobs',
    transactions: activity.transactions.map((t) => ({
      icon: t.icon,
      title: `${t.serviceName} · ${t.customerName}`,
      date: displayDate(t.at),
      amount: t.amount,
      isCredit: true,
      colorHex: EARNINGS_TILE_COLOR,
    })),
  };
}

export function toProfileJson(profile: ProviderProfile): Record<string, unknown> {
  return {
    id: profile.id,
    businessName: profile.businessName,
    serviceCategory: profile.serviceCategory,
    contactNumber: profile.contactNumber,
    serviceArea: profile.serviceArea,
    tradeLicenseUploaded: profile.tradeLicenseUploaded,
    idDocumentUploaded: profile.idDocumentUploaded,
    status: profile.status.toLowerCase(),
    isAvailable: profile.isAvailable,
  };
}

/** Coerces the JSON scheduleDays column to a 7-element boolean array. */
function normalizeDays(value: unknown): boolean[] {
  if (Array.isArray(value)) {
    return Array.from({ length: 7 }, (_, i) => Boolean(value[i]));
  }
  return [true, true, true, true, true, false, false];
}
