import { ServiceRequestStatus } from '@prisma/client';
import { MAX_OTP_ATTEMPTS, SERVICE_DISTRICTS } from './service-requests.constants';
import type { ServiceRequestRow } from './service-requests.repository';

/** Who is looking decides what they see — above all, only the buyer sees the OTP. */
export type RequestViewer = 'buyer' | 'seller' | 'staff';

const CONTACT_STATUSES: ServiceRequestStatus[] = [
  ServiceRequestStatus.ACCEPTED,
  ServiceRequestStatus.IN_PROGRESS,
];

export function districtName(slug: string | null): string | null {
  if (!slug) return null;
  return SERVICE_DISTRICTS.find((d) => d.slug === slug)?.name ?? slug;
}

export function toServiceRequestJson(
  row: ServiceRequestRow,
  viewer: RequestViewer,
): Record<string, unknown> {
  const amount = Number(row.amount);
  const fees = Number(row.feesAmount);
  // Phone numbers are exchanged only while the job is live: a partner who
  // declined, or a buyer whose request is finished, has no reason to call.
  const shareContacts = CONTACT_STATUSES.includes(row.status);
  const sellerName = row.seller.providerProfile?.businessName ?? row.seller.name ?? 'ELK partner';
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    status: row.status,
    serviceType: row.serviceType,
    district: row.district,
    districtName: districtName(row.district),
    scheduledAt: row.scheduledAt.toISOString(),
    endAt: row.endAt?.toISOString() ?? null,
    fulfilment: row.fulfilment,
    addressText: row.addressText,
    lat: Number(row.lat),
    lng: Number(row.lng),
    shopAddress: row.shopAddress,
    shopLat: row.shopLat === null ? null : Number(row.shopLat),
    shopLng: row.shopLng === null ? null : Number(row.shopLng),
    note: row.note,
    amount,
    feesAmount: fees,
    totalAmount: amount + fees,
    isPaid: row.paidAt !== null,
    paymentReference: row.paymentReference,
    otpCode:
      viewer === 'buyer' && row.status === ServiceRequestStatus.ACCEPTED ? row.otpCode : null,
    otpAttemptsLeft:
      row.status === ServiceRequestStatus.ACCEPTED
        ? Math.max(0, MAX_OTP_ATTEMPTS - row.otpAttempts)
        : null,
    sellerName,
    sellerPhone:
      viewer === 'buyer' && shareContacts
        ? row.seller.providerProfile?.contactNumber || row.seller.phone
        : null,
    buyerName: row.buyer.name ?? 'ELK customer',
    buyerPhone: viewer !== 'buyer' && shareContacts ? row.buyer.phone : null,
    staffName: row.staff?.name ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
