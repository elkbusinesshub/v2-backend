import type { BookingVertical } from './unified-bookings.repository';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  serviceId!: string;

  /** Day of month, must fall inside the offered booking window */
  @IsInt()
  @Min(1)
  @Max(31)
  day!: number;

  /** One of the offered slots, e.g. "10:00" */
  @Matches(/^\d{2}:\d{2}$/, { message: 'time must be HH:MM' })
  time!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address!: string;

  /**
   * Coordinate of `address`, when the user picked it rather than typed it.
   * Optional so a hand-typed address still books; tracking then has no map.
   */
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  /** Accepted for wire-compat with the app, but ignored — the price is computed server-side. */
  @IsOptional()
  @IsNumber()
  total?: number;
}

/** Matches the Flutter BookingConfirmationModel. */
export class BookingConfirmationDto {
  bookingReference!: string;
  serviceName!: string;
  dateTimeLabel!: string;
  providerName!: string;
  amountPaid!: number;
}

export class BookingListItemDto {
  id!: string;
  /**
   * Which vertical the booking belongs to. The app needs it to route a cancel:
   * each vertical owns its own `POST .../bookings/:id/cancel`.
   */
  vertical!: BookingVertical;
  reference!: string;
  serviceName!: string;
  serviceIcon!: string;
  providerName!: string;
  /** Each vertical has its own status enum; they share CONFIRMED/COMPLETED/CANCELLED. */
  status!: string;
  /** Null for a booking with no date yet (an immediate porter pickup). */
  scheduledAt!: string | null;
  addressText!: string;
  total!: number;
}
