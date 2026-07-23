import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PORTER_PAYMENT_METHODS, PORTER_PICKUP_WINDOWS } from './porter.constants';

const WINDOW_LABELS = PORTER_PICKUP_WINDOWS.map((w) => w.label);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

/** Everything needed to price a delivery — shared by /quote and /bookings. */
export class PorterQuoteDto {
  /** Vehicle wire id, e.g. "bike" */
  @ApiProperty({ example: 'bike' })
  @Transform(lower)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  vehicleId!: string;

  /** Add-on keys, e.g. ["helper", "insure"] */
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  addons?: string[];
}

export class CreatePorterBookingDto extends PorterQuoteDto {
  /** A saved address from /locations — takes priority over pickupAddress if both are sent. */
  @IsUUID()
  @IsOptional()
  pickupAddressId?: string;

  /** Required unless pickupAddressId is given (map pick / current-location text). */
  @ValidateIf((o: CreatePorterBookingDto) => !o.pickupAddressId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  pickupAddress?: string;

  /** A saved address from /locations — takes priority over dropAddress if both are sent. */
  @IsUUID()
  @IsOptional()
  dropAddressId?: string;

  /** Required unless dropAddressId is given (map pick / current-location text). */
  @ValidateIf((o: CreatePorterBookingDto) => !o.dropAddressId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  dropAddress?: string;

  @ApiPropertyOptional({ example: 'Electronics' })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  packageType?: string;

  @ApiPropertyOptional({ example: '2.5 kg' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  weightLabel?: string;

  /** Omit both schedule fields for "pick up now". */
  @ApiPropertyOptional({ example: '2026-07-25' })
  @ValidateIf(
    (o: CreatePorterBookingDto) => o.scheduledDate !== undefined || o.pickupWindow !== undefined,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be YYYY-MM-DD' })
  scheduledDate?: string;

  @ApiPropertyOptional({ enum: WINDOW_LABELS })
  @ValidateIf(
    (o: CreatePorterBookingDto) => o.scheduledDate !== undefined || o.pickupWindow !== undefined,
  )
  @IsIn(WINDOW_LABELS)
  pickupWindow?: string;

  @ApiProperty({ enum: PORTER_PAYMENT_METHODS })
  @Transform(lower)
  @IsIn([...PORTER_PAYMENT_METHODS])
  paymentMethod!: string;
}
