import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQuery } from '@/common/http/pagination';
import {
  CAR_CATEGORY_ID_TO_ENUM,
  RENTAL_PAYMENT_METHODS,
  RENTAL_TYPE_IDS,
} from './rentals.constants';

const CATEGORY_IDS = ['all', ...Object.keys(CAR_CATEGORY_ID_TO_ENUM)];
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

// ─── queries ─────────────────────────────────────────────────────────────────

export class ListCarsQuery extends PaginationQuery {
  /** Filter chip: all | sedan | suv | luxury (case-insensitive) */
  @ApiPropertyOptional({ enum: CATEGORY_IDS })
  @Transform(lower)
  @IsIn(CATEGORY_IDS)
  @IsOptional()
  category?: string;

  /** Accepted for the period selector; affects display only, not the data */
  @Transform(lower)
  @IsIn([...RENTAL_TYPE_IDS])
  @IsOptional()
  period?: string;

  /** Listing shows "Sort: Price" — price ascending is the only sort today */
  @Transform(lower)
  @IsIn(['price'])
  @IsOptional()
  sort?: string;
}

export class AvailabilityQuery {
  @ApiProperty({ example: '2026-08-01T10:00:00+04:00' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-08-04T10:00:00+04:00' })
  @IsISO8601()
  to!: string;
}

// ─── quote & booking ─────────────────────────────────────────────────────────

/** Everything needed to price a rental — shared by /quote and /bookings. */
export class RentalQuoteDto {
  @IsUUID()
  carId!: string;

  @ApiProperty({ enum: RENTAL_TYPE_IDS })
  @Transform(lower)
  @IsIn([...RENTAL_TYPE_IDS])
  rentalType!: string;

  @ApiProperty({ example: '2026-08-01T10:00:00+04:00' })
  @IsISO8601()
  pickupAt!: string;

  @ApiProperty({ example: '2026-08-04T10:00:00+04:00' })
  @IsISO8601()
  returnAt!: string;

  @ApiProperty({ enum: ['pickup', 'delivery'] })
  @Transform(lower)
  @IsIn(['pickup', 'delivery'])
  fulfilment!: string;

  /** Required for self-pickup */
  @ValidateIf((o: RentalQuoteDto) => o.fulfilment === 'pickup')
  @IsUUID()
  branchId?: string;

  /** Required for delivery */
  @ValidateIf((o: RentalQuoteDto) => o.fulfilment === 'delivery')
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  deliveryAddress?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  deliveryBuilding?: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  deliveryNotes?: string;

  /** Extra keys, e.g. ["protection", "wifi"] */
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  extras?: string[];

  @IsString()
  @MaxLength(20)
  @IsOptional()
  promoCode?: string;
}

export class CreateRentalBookingDto extends RentalQuoteDto {
  @ApiProperty({ enum: RENTAL_PAYMENT_METHODS })
  @Transform(lower)
  @IsIn([...RENTAL_PAYMENT_METHODS])
  paymentMethod!: string;

  /** The review step's mandatory terms checkbox — enforced server-side too */
  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: 'You must agree to the rental terms' })
  agreedToTerms!: boolean;
}

// ─── management (provider/admin) ─────────────────────────────────────────────

export class CreateRentalCarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: Object.keys(CAR_CATEGORY_ID_TO_ENUM) })
  @Transform(lower)
  @IsIn(Object.keys(CAR_CATEGORY_ID_TO_ENUM))
  category!: string;

  /** SVG asset key, e.g. "rental_sedan" — defaults per category if omitted */
  @IsString()
  @MaxLength(40)
  @IsOptional()
  iconKey?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  seats!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  transmission!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  fuel!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  pricePerDay!: number;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  badge?: string;
}

export class UpdateRentalCarDto extends PartialType(CreateRentalCarDto) {}
