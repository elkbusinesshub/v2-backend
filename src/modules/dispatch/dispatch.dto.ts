import { DriverService } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RegisterDriverDto {
  @IsEnum(DriverService)
  service!: DriverService;

  /** `RideType.slug` or `PorterVehicle.slug`, depending on `service`. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  vehicleSlug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  vehicleLabel!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plateNumber!: string;
}

export class SetOnlineDto {
  @IsEnum(DriverService)
  service!: DriverService;

  @IsBoolean()
  isOnline!: boolean;

  /**
   * Where the partner is as they go online. Optional only so a toggle can be
   * flipped off without a fix; going *online* without one leaves them
   * undispatchable until the first heartbeat lands.
   */
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;
}

export class DriverLocationDto {
  @IsEnum(DriverService)
  service!: DriverService;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;
}

export class NearbyQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  /** Narrow to one class, e.g. only autos. Omitted means every class. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  vehicleSlug?: string;
}

/** One vehicle pin on the rider's map. */
export class NearbyVehicleDto {
  /** Which class it is, so the map can draw the right emoji. */
  vehicleSlug!: string;
  emoji!: string;
  lat!: number;
  lng!: number;
  distanceKm!: number;
  /** Straight-line minutes, the same estimate the class advertises. */
  etaMinutes!: number;
}
