/** Shapes match the Flutter models in lib/data/models/{service,booking}_models.dart. */

export class ServiceSubItemDto {
  id!: string;
  name!: string;
  icon!: string;
}

export class ServiceGroupDto {
  title!: string;
  icon!: string;
  items!: ServiceSubItemDto[];
}

export class ServiceDetailDto {
  id!: string;
  title!: string;
  badge!: string;
  providerName!: string;
  providerInitials!: string;
  providerExperience!: string;
  rating!: number;
  reviewCount!: number;
  duration!: string;
  teamSize!: string;
  category!: string;
  bookings!: string;
  included!: string[];
  description!: string;
  price!: number;
  priceUnit!: string;
}

export class DateSlotDto {
  day!: number;
  weekday!: string;
}

export class TimeSlotDto {
  time!: string;
  available!: boolean;
}

export class PriceBreakdownDto {
  serviceFee!: number;
  promoCode!: string | null;
  promoDiscount!: number;
  total!: number;
}

export class BookingOptionsDto {
  serviceId!: string;
  serviceName!: string;
  dates!: DateSlotDto[];
  timeSlots!: TimeSlotDto[];
  /** The user's default saved address, or '' if they have none yet. */
  address!: string;
  pricing!: PriceBreakdownDto;
}
