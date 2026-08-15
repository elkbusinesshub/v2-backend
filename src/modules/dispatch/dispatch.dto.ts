import { DriverService } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Signing up to drive or to deliver.
 *
 * Registration used to be a name and a plate, which proves nothing about the
 * person a rider is about to get into a car with. Everything here is required:
 * the licence holder's own details, and photographs of the licence and of the
 * document tying the vehicle to them.
 */
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

  /** As printed on the licence, which is not necessarily the account name. */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(80)
  fullName!: string;

  /**
   * `YYYY-MM-DD`. Checked against a minimum age in the service — a date alone
   * cannot express "old enough to hold a licence".
   */
  @IsDateString()
  dateOfBirth!: string;

  /**
   * Licence number. Formats differ by state and by country, so this checks a
   * plausible length and character set rather than pretending to know them
   * all — a wrong regex rejects real drivers.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9 -]+$/, {
    message: 'licenceNumber may contain only letters, numbers, spaces and hyphens',
  })
  licenceNumber!: string;

  /**
   * `YYYY-MM-DD`. Must still be in the future — an expired licence is not
   * proof of anything, which is the whole reason for asking. Checked in the
   * service, where "in the future" can actually be expressed.
   */
  @IsDateString()
  licenceExpiry!: string;

  /** Storage keys from `POST /uploads/image` with purpose `provider-docs`. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  licenceFrontKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  licenceBackKey!: string;

  /** Registration certificate, or whatever proves the vehicle is theirs. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  vehicleDocKey!: string;
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
