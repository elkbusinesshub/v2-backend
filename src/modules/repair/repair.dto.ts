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
  REPAIR_MAX_CART_LINES,
  REPAIR_MAX_LINE_QTY,
  REPAIR_PAYMENT_METHODS,
  REPAIR_TIME_SLOTS,
} from './repair.constants';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

// ─── quote & booking ─────────────────────────────────────────────────────────

export class RepairCartLineDto {
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REPAIR_MAX_LINE_QTY)
  quantity!: number;
}

/** Everything needed to price a cart — shared by /quote and /bookings. */
export class RepairQuoteDto {
  @ApiProperty({ type: [RepairCartLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REPAIR_MAX_CART_LINES)
  @ArrayUnique((line: RepairCartLineDto) => line.serviceId)
  @ValidateNested({ each: true })
  @Type(() => RepairCartLineDto)
  items!: RepairCartLineDto[];

  @ApiPropertyOptional({ example: 'AC60' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  promoCode?: string;
}

export class CreateRepairBookingDto extends RepairQuoteDto {
  @ApiProperty({ example: '2026-07-22', description: 'Within the 6-day window' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be YYYY-MM-DD' })
  scheduledDate!: string;

  @ApiProperty({ enum: REPAIR_TIME_SLOTS })
  @IsIn([...REPAIR_TIME_SLOTS])
  timeSlot!: string;

  /** A saved address from /locations — snapshotted onto the booking */
  @IsUUID()
  addressId!: string;

  @ApiProperty({ enum: REPAIR_PAYMENT_METHODS })
  @Transform(lower)
  @IsIn([...REPAIR_PAYMENT_METHODS])
  paymentMethod!: string;
}

// ─── management (admin) ──────────────────────────────────────────────────────

export class CreateRepairServiceDto {
  /** Category wire id, e.g. "ac" */
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
}

export class UpdateRepairServiceDto extends PartialType(CreateRepairServiceDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
