import type { HomeService } from '@prisma/client';
import type { HomeServiceDto, ServiceBookingDto } from './home-services.dto';
import type { ServiceBookingRow } from './home-services.repository';

export function toServiceJson(s: HomeService): HomeServiceDto {
  const hourlyRate = Number(s.hourlyRate);
  return {
    id: s.id,
    vertical: s.vertical,
    category: s.category,
    name: s.name,
    description: s.description,
    minHours: s.minHours,
    hourlyRate,
    extraProRate: Number(s.extraProRate),
    materialsFee: Number(s.materialsFee),
    fromPrice: hourlyRate * s.minHours,
  };
}

/** A Date column holding a calendar day → YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toBookingJson(b: ServiceBookingRow): ServiceBookingDto {
  return {
    id: b.id,
    code: b.code,
    status: b.status,
    serviceId: b.serviceId,
    serviceName: b.serviceName,
    vertical: b.vertical,
    category: b.category,
    hours: b.hours,
    professionals: b.professionals,
    withMaterials: b.withMaterials,
    date: isoDay(b.scheduledDate),
    timeSlot: b.timeSlot,
    addressLabel: b.addressLabel,
    addressText: b.addressText,
    lat: b.lat,
    lng: b.lng,
    directions: b.directions,
    contactPhone: b.contactPhone,
    customerName: b.user.name ?? 'ELK customer',
    location: b.location,
    professional: b.professional,
    baseAmount: Number(b.baseAmount),
    materialsAmount: Number(b.materialsAmount),
    discountAmount: Number(b.discountAmount),
    totalAmount: Number(b.totalAmount),
    promoCode: b.promoCode,
    createdAt: b.createdAt.toISOString(),
  };
}
