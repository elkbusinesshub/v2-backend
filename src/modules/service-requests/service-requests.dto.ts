import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CLEANING_SERVICE_TYPES,
  DISTRICT_SLUGS,
  FULFILMENTS,
  OTP_LENGTH,
  VEHICLE_TYPES,
} from './service-requests.constants';

const E164_PHONE = /^\+[1-9]\d{7,14}$/;

/** Where the buyer is, picked on the map. */
abstract class LocatedRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  addressText!: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateCleaningRequestDto extends LocatedRequestDto {
  @IsIn(DISTRICT_SLUGS)
  district!: string;

  @IsIn([...CLEANING_SERVICE_TYPES])
  serviceType!: string;

  /** The slot's start, ISO-8601. */
  @IsDateString()
  scheduledAt!: string;
}

export class CreateRentalRequestDto extends LocatedRequestDto {
  @IsIn([...VEHICLE_TYPES])
  vehicleType!: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsIn([...FULFILMENTS])
  fulfilment!: string;
}

export class RequestListQueryDto {
  /** `open` — pending, accepted, in progress; `done` — everything else. */
  @IsOptional()
  @IsIn(['open', 'done'])
  scope?: 'open' | 'done';

  @IsOptional()
  @IsIn(['CLEANING', 'RENTAL'])
  kind?: 'CLEANING' | 'RENTAL';
}

export class AcceptRequestDto {
  /** A staff record id (from GET /partner-setup/staff) to put on the job. */
  @IsOptional()
  @IsUUID()
  staffId?: string;
}

export class VerifyOtpDto {
  @Matches(new RegExp(`^\\d{${OTP_LENGTH}}$`), { message: `otpCode must be ${OTP_LENGTH} digits` })
  otpCode!: string;
}

export class CleaningServicePriceDto {
  @IsIn([...CLEANING_SERVICE_TYPES])
  serviceType!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  price!: number;
}

export class UpdateCleaningSetupDto {
  @IsArray()
  @ArrayMaxSize(DISTRICT_SLUGS.length)
  @IsIn(DISTRICT_SLUGS, { each: true })
  districts!: string[];

  @IsArray()
  @ArrayMaxSize(CLEANING_SERVICE_TYPES.length)
  @ValidateNested({ each: true })
  @Type(() => CleaningServicePriceDto)
  services!: CleaningServicePriceDto[];
}

export class RentalVehicleDto {
  @IsIn([...VEHICLE_TYPES])
  vehicleType!: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  pricePerDay!: number;
}

export class UpdateRentalSetupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address!: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  deliveryFee!: number;

  @IsArray()
  @ArrayMaxSize(VEHICLE_TYPES.length)
  @ValidateNested({ each: true })
  @Type(() => RentalVehicleDto)
  vehicles!: RentalVehicleDto[];
}

export class AddStaffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @Matches(E164_PHONE, { message: 'phone must be in E.164 format, e.g. +919876543210' })
  phone!: string;
}
