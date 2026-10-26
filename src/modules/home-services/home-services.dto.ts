import { ServiceBookingStatus, ServiceVertical } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
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
import type { RazorpayCheckoutDto } from '@/modules/razorpay/razorpay.dto';
import { MAX_HOURS, MAX_PROFESSIONALS } from './home-services.rules';

/** How the cleaning and repair checkout takes payment: Razorpay (UPI, card or netbanking, chosen inside its checkout). */
export const SERVICE_PAYMENT_METHODS = ['razorpay'] as const;

export class ServicesQueryDto {
  @IsOptional()
  @IsEnum(ServiceVertical)
  vertical?: ServiceVertical;
}

/** A service as the app shows it. */
export class HomeServiceDto {
  id!: string;
  vertical!: ServiceVertical;
  category!: string;
  name!: string;
  description!: string;
  minHours!: number;
  hourlyRate!: number;
  extraProRate!: number;
  materialsFee!: number;
  /** hourlyRate × minHours — one professional for the shortest visit. */
  fromPrice!: number;
}

export class CheckPromoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  subtotal!: number;
}

export class PromoCheckDto {
  ok!: boolean;
  discount!: number;
  message!: string;
}

export class CreateServiceBookingDto {
  @IsUUID()
  serviceId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_HOURS)
  hours!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PROFESSIONALS)
  professionals!: number;

  @IsOptional()
  @IsBoolean()
  withMaterials?: boolean;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'timeSlot must be HH:MM' })
  timeSlot!: string;

  /** One of the customer's saved addresses. */
  @IsUUID()
  addressId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;

  /** razorpay: the booking waits for the checkout to be paid. The default. */
  @IsOptional()
  @IsIn(SERVICE_PAYMENT_METHODS)
  paymentMethod?: (typeof SERVICE_PAYMENT_METHODS)[number];
}

/** A booking, as both the customer and the admin see it. */
export class ServiceBookingDto {
  id!: string;
  code!: string;
  status!: ServiceBookingStatus;
  serviceId!: string | null;
  serviceName!: string;
  vertical!: ServiceVertical;
  category!: string;
  hours!: number;
  professionals!: number;
  withMaterials!: boolean;
  date!: string;
  timeSlot!: string;
  addressLabel!: string;
  addressText!: string;
  lat!: number | null;
  lng!: number | null;
  directions!: string | null;
  contactPhone!: string;
  customerName!: string;
  location!: { id: string; area: string; district: string; pincode: string } | null;
  /** id is null when the professional has since been removed; name and phone stay. */
  professional!: { id: string | null; name: string; phone: string } | null;
  baseAmount!: number;
  materialsAmount!: number;
  discountAmount!: number;
  totalAmount!: number;
  promoCode!: string | null;
  paymentMethod!: string;
  /** Kept from the refund when the customer cancelled late. */
  cancellationFee!: number;
  /**
   * Only on the response to a Razorpay booking: open the checkout with this,
   * then send its result to POST /service-bookings/:id/payment/verify.
   */
  checkout!: RazorpayCheckoutDto | null;
  createdAt!: string;
}
