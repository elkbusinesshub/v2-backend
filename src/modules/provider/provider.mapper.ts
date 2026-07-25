import { ProviderRequestStatus, type ProviderProfile, type ProviderRequest } from '@prisma/client';
import {
  DASHBOARD_TREND,
  EARNINGS_TREND,
  PROVIDER_MODE_LABEL,
  SCHEDULE_DAY_LABELS,
  SCHEDULE_SLOTS,
} from './provider.constants';

/** AED with thousands separators, e.g. "AED 2,840". */
function aed(value: number): string {
  return `AED ${Math.round(value).toLocaleString('en-US')}`;
}

export function toRequestJson(request: ProviderRequest): Record<string, unknown> {
  return {
    id: request.id,
    serviceName: request.serviceName,
    customerName: request.customerName,
    location: request.location,
    time: request.timeLabel,
    amount: Number(request.amount),
    status: request.status.toLowerCase(),
  };
}

export function toDashboardJson(
  profile: ProviderProfile,
  requests: ProviderRequest[],
): Record<string, unknown> {
  const activeOrders = requests.filter((r) => r.status === ProviderRequestStatus.ACCEPTED).length;
  return {
    businessName: profile.businessName,
    modeLabel: PROVIDER_MODE_LABEL[profile.status],
    isAvailable: profile.isAvailable,
    stats: [
      { label: 'Active Orders', value: String(activeOrders), trend: DASHBOARD_TREND.activeOrders },
      {
        label: 'This Month',
        value: aed(Number(profile.totalEarnings)),
        trend: DASHBOARD_TREND.thisMonth,
      },
      {
        label: 'Rating',
        value: `${Number(profile.rating)}★`,
        trend: `${profile.reviewCount} reviews`,
      },
    ],
    requests: requests.map(toRequestJson),
  };
}

export function toScheduleJson(
  profile: ProviderProfile,
  requests: ProviderRequest[],
): Record<string, unknown> {
  const days = normalizeDays(profile.scheduleDays);
  const todayIdx = (new Date().getDay() + 6) % 7; // JS Sun=0 → Mon=0 index
  const accepted = requests.filter((r) => r.status === ProviderRequestStatus.ACCEPTED).length;
  const pending = requests.filter((r) => r.status === ProviderRequestStatus.PENDING).length;

  return {
    todaysBookingsCount: accepted + pending,
    days: SCHEDULE_DAY_LABELS.map((label, i) => ({
      label,
      available: days[i] ?? false,
      isToday: i === todayIdx,
    })),
    slots: SCHEDULE_SLOTS.map((timeRange, i) => ({
      timeRange,
      // first slots fill with accepted load, then pending, rest available
      status: i < accepted ? 'active' : i < accepted + pending ? 'pending' : 'available',
    })),
  };
}

export function toEarningsJson(
  profile: ProviderProfile,
  requests: ProviderRequest[],
): Record<string, unknown> {
  const now = new Date();
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const transactions = requests
    .filter((r) => r.status === ProviderRequestStatus.ACCEPTED)
    .map((r) => ({
      icon: r.icon,
      title: `${r.serviceName} · ${r.customerName}`,
      date: r.timeLabel,
      amount: Number(r.amount),
      isCredit: true,
      colorHex: r.colorHex,
    }));

  return {
    totalEarnings: Number(profile.totalEarnings),
    monthLabel,
    trendLabel: EARNINGS_TREND.month,
    completedJobs: profile.completedJobs,
    completedJobsTrend: EARNINGS_TREND.completedJobs,
    avgPerJob: Number(profile.avgPerJob),
    avgPerJobTrend: EARNINGS_TREND.avgPerJob,
    transactions,
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
