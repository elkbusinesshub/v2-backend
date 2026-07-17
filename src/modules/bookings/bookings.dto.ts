import { BookingStatus } from '@prisma/client';
import {
  IsInt,
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
  reference!: string;
  serviceName!: string;
  serviceIcon!: string;
  providerName!: string;
  status!: BookingStatus;
  scheduledAt!: string;
  addressText!: string;
  total!: number;
}
