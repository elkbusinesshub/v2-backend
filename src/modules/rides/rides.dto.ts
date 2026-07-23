import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { RIDE_MAX_TIP, RIDE_PAYMENT_METHODS } from './rides.constants';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class CreateRideBookingDto {
  /** Ride type wire id, e.g. "auto" */
  @ApiProperty({ example: 'auto' })
  @Transform(lower)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  rideTypeId!: string;

  /** A saved address from /locations — takes priority over pickupAddress if both are sent. */
  @IsUUID()
  @IsOptional()
  pickupAddressId?: string;

  /** Required unless pickupAddressId is given (map pick / current-location text). */
  @ValidateIf((o: CreateRideBookingDto) => !o.pickupAddressId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  pickupAddress?: string;

  /** A saved address from /locations — takes priority over dropAddress if both are sent. */
  @IsUUID()
  @IsOptional()
  dropAddressId?: string;

  /** Required unless dropAddressId is given (map pick / current-location text). */
  @ValidateIf((o: CreateRideBookingDto) => !o.dropAddressId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  dropAddress?: string;

  @ApiProperty({ enum: RIDE_PAYMENT_METHODS })
  @Transform(lower)
  @IsIn([...RIDE_PAYMENT_METHODS])
  paymentMethod!: string;
}

/** "Driver Arrived · Start Trip" — the rider confirms the OTP shown to the driver. */
export class StartRideDto {
  @ApiProperty({ example: '8264' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  otpCode!: string;
}

/** Post-trip rating + optional tip, set once after COMPLETED. */
export class RateRideDto {
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(RIDE_MAX_TIP)
  @IsOptional()
  tip?: number;
}

/** Legacy /rides/request body — a driver-match preview, no booking created. */
export class RideRequestPreviewDto {
  @ApiProperty({ example: 'auto' })
  @Transform(lower)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  rideTypeId!: string;
}
