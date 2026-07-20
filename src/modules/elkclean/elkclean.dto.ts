import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CLEAN_MAX_CART_LINES,
  CLEAN_MAX_LINE_QTY,
  CLEAN_PAYMENT_METHODS,
  CLEAN_TIME_SLOTS,
} from './elkclean.constants';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

// ─── quote & booking ─────────────────────────────────────────────────────────

export class CleanCartLineDto {
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CLEAN_MAX_LINE_QTY)
  quantity!: number;
}

/** Everything needed to price a cart — shared by /quote and /bookings. */
export class CleanQuoteDto {
  @ApiProperty({ type: [CleanCartLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CLEAN_MAX_CART_LINES)
  @ArrayUnique((line: CleanCartLineDto) => line.serviceId)
  @ValidateNested({ each: true })
  @Type(() => CleanCartLineDto)
  items!: CleanCartLineDto[];

  @ApiPropertyOptional({ example: 'TANK60' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  promoCode?: string;
}

export class CreateCleanBookingDto extends CleanQuoteDto {
  @ApiProperty({ example: '2026-07-22', description: 'Within the 6-day window' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be YYYY-MM-DD' })
  scheduledDate!: string;

  @ApiProperty({ enum: CLEAN_TIME_SLOTS })
  @IsIn([...CLEAN_TIME_SLOTS])
  timeSlot!: string;

  /** A saved address from /locations — snapshotted onto the booking */
  @IsUUID()
  addressId!: string;

  @ApiProperty({ enum: CLEAN_PAYMENT_METHODS })
  @Transform(lower)
  @IsIn([...CLEAN_PAYMENT_METHODS])
  paymentMethod!: string;
}

// ─── management (admin) ──────────────────────────────────────────────────────

export class CreateCleanServiceDto {
  /** Category wire id, e.g. "tnk" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  categorySlug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  price!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  durationLabel!: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  tag?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  checklist!: string[];

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @IsOptional()
  steps?: string[];
}

export class UpdateCleanServiceDto extends PartialType(CreateCleanServiceDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
