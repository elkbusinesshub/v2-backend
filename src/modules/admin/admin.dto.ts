import { PartialType } from '@nestjs/swagger';
import { ServiceBookingStatus, ServiceVertical } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
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
  ValidateIf,
} from 'class-validator';
import { MAX_HOURS } from '@/modules/home-services/home-services.rules';

// ── services ────────────────────────────────────────────────────────────────

export class CreateServiceDto {
  @IsEnum(ServiceVertical)
  vertical!: ServiceVertical;

  /** App tile slug; checked against the vertical in the service. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_HOURS)
  minHours!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  hourlyRate!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  extraProRate!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  materialsFee!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  online?: boolean;
}

export class UpdateServiceDto extends PartialType(CreateServiceDto) {}

export class AdminServiceDto {
  id!: string;
  vertical!: ServiceVertical;
  category!: string;
  name!: string;
  description!: string;
  minHours!: number;
  hourlyRate!: number;
  extraProRate!: number;
  materialsFee!: number;
  fromPrice!: number;
  active!: boolean;
  online!: boolean;
  /** Active and online: what the app shows. */
  live!: boolean;
  openBookings!: number;
  updatedAt!: string;
}

// ── locations ───────────────────────────────────────────────────────────────

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  area!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  district!: string;

  @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' })
  pincode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  radiusKm!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateLocationDto extends PartialType(CreateLocationDto) {}

export class AdminLocationDto {
  id!: string;
  area!: string;
  district!: string;
  pincode!: string;
  radiusKm!: number;
  /** Whether the area's centre was found on the map; without it only the pincode matches. */
  mapped!: boolean;
  active!: boolean;
  professionals!: number;
  pendingBookings!: number;
}

// ── professionals ───────────────────────────────────────────────────────────

export class CreateProfessionalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @Matches(/^\+?[0-9 ]{10,16}$/, { message: 'phone must be a mobile number' })
  phone!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears!: number;

  @IsString()
  @MaxLength(160)
  skills!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  locationId?: string | null;

  @IsOptional()
  @IsBoolean()
  onDuty?: boolean;
}

export class UpdateProfessionalDto extends PartialType(CreateProfessionalDto) {}

export type ProfessionalStatus = 'AVAILABLE' | 'ON_JOB' | 'OFF_DUTY';

export class AdminProfessionalDto {
  id!: string;
  name!: string;
  phone!: string;
  experienceYears!: number;
  skills!: string;
  location!: { id: string; area: string; district: string } | null;
  onDuty!: boolean;
  status!: ProfessionalStatus;
  jobsToday!: number;
}

// ── promo codes ─────────────────────────────────────────────────────────────

export class CreatePromoCodeDto {
  @Matches(/^[A-Za-z0-9]{4,15}$/, { message: 'code must be 4 to 15 letters or numbers' })
  code!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  percent!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrder!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'validTill must be YYYY-MM-DD' })
  validTill!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;
}

export class UpdatePromoCodeDto extends PartialType(CreatePromoCodeDto) {}

export type PromoState = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';

export class AdminPromoCodeDto {
  id!: string;
  code!: string;
  percent!: number;
  maxDiscount!: number;
  minOrder!: number;
  validTill!: string;
  active!: boolean;
  state!: PromoState;
  description!: string;
}

// ── bookings ────────────────────────────────────────────────────────────────

export class AdminBookingsQueryDto {
  @IsOptional()
  @IsEnum(ServiceBookingStatus)
  status?: ServiceBookingStatus;
}

export class AssignProfessionalDto {
  @IsUUID()
  professionalId!: string;
}

export class SetBookingStatusDto {
  @IsEnum(ServiceBookingStatus)
  status!: ServiceBookingStatus;
}
