import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '@/common/http/pagination';
import { CATEGORY_ID_TO_ENUM, PAYMENT_METHODS } from './elkstay.constants';

const CATEGORY_IDS = Object.keys(CATEGORY_ID_TO_ENUM);
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

// ─── queries ─────────────────────────────────────────────────────────────────

export class ListStaysQuery extends PaginationQuery {
  /** Category wire id as the app sends it, e.g. "pg_stay" */
  @ApiPropertyOptional({ enum: CATEGORY_IDS })
  @IsIn(CATEGORY_IDS)
  @IsOptional()
  category?: string;

  /** "Verified" filter chip */
  @Transform(toBool)
  @IsBoolean()
  @IsOptional()
  verified?: boolean;

  /** "Under ₹12k" chip → the app sends maxPrice=12000 */
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  maxPrice?: number;

  /** "Single room" chip → roomType=single (contains-match on roomType) */
  @IsString()
  @MaxLength(50)
  @IsOptional()
  roomType?: string;

  /** "Meals" chip → stays having a meals amenity */
  @Transform(toBool)
  @IsBoolean()
  @IsOptional()
  meals?: boolean;

  /** free-text: name / area / address */
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;
}

// ─── customer bodies ─────────────────────────────────────────────────────────

export class CreateStayBookingDto {
  @IsUUID()
  stayId!: string;

  @IsUUID()
  roomOptionId!: string;

  /** Calendar date, e.g. "2026-07-01" — must not be in the past */
  @ApiProperty({ example: '2026-07-01' })
  @IsISO8601({ strict: true })
  moveInDate!: string;

  @IsInt()
  @Min(1)
  @Max(24)
  durationMonths!: number;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  couponCode?: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn([...PAYMENT_METHODS])
  paymentMethod!: string;
}

export class ScheduleVisitDto {
  @IsUUID()
  stayId!: string;

  /** Visit date-time, ISO 8601 — must be in the future */
  @ApiProperty({ example: '2026-07-10T17:00:00+04:00' })
  @IsISO8601()
  visitAt!: string;
}

// ─── management bodies (provider/admin) ──────────────────────────────────────

export class StayAmenityInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  iconKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;
}

export class StayRoomOptionInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  kind!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  subtitle!: string;

  @IsInt()
  @IsPositive()
  pricePerMonth!: number;
}

export class CreateStayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: CATEGORY_IDS })
  @IsIn(CATEGORY_IDS)
  categoryType!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  badge!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  roomType!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  location!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullAddress!: string;

  @Type(() => Number)
  @Min(0)
  @Max(1000)
  distanceKm!: number;

  @IsLatitude()
  @IsOptional()
  latitude?: number;

  @IsLongitude()
  @IsOptional()
  longitude?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  /** ARGB color int, e.g. 4280046660 (0xFF1C5044) */
  @IsInt()
  @Min(0)
  gradientStart!: number;

  @IsInt()
  @Min(0)
  gradientEnd!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => StayAmenityInput)
  amenities!: StayAmenityInput[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => StayRoomOptionInput)
  roomOptions!: StayRoomOptionInput[];
}

export class UpdateStayDto extends PartialType(CreateStayDto) {}

export class VerifyStayDto {
  @IsBoolean()
  isVerified!: boolean;
}
