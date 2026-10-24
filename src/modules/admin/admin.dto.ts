import { PartialType } from '@nestjs/swagger';
import {
  AdminModule,
  ProfessionalStatus,
  ServiceBookingStatus,
  ServiceChangeKind,
  ServiceChangeStatus,
  ServiceVertical,
  UserType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
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
} from 'class-validator';
import { PaginationQuery } from '@/common/http/pagination';
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
  /** False for a new service the super admin has not approved yet. */
  approved!: boolean;
  /** Approved, active and online: what the app shows. */
  live!: boolean;
  /** The change waiting for the super admin; the app keeps the values above until then. */
  pendingChange!: PendingChangeDto | null;
  openBookings!: number;
  updatedAt!: string;
}

export class PendingChangeDto {
  id!: string;
  kind!: ServiceChangeKind;
  minHours!: number;
  hourlyRate!: number;
  extraProRate!: number;
  materialsFee!: number;
  startingPrice!: number;
  requestedAt!: string;
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
  pendingBookings!: number;
}

// ── professionals ───────────────────────────────────────────────────────────

export class CreateProfessionalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  /** A mobile number; 10 digits are read as Indian (+91). WhatsApp goes here. */
  @Matches(/^\+?[0-9 ]{10,16}$/, { message: 'phone must be a mobile number' })
  phone!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(190)
  email!: string;

  /** Service tiles they do, e.g. ["bth", "kit"]. At least one. */
  @IsArray()
  @ArrayMinSize(1, { message: 'choose at least one category' })
  @ArrayUnique()
  @IsString({ each: true })
  categories!: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears?: number;
}

export class UpdateProfessionalDto extends PartialType(CreateProfessionalDto) {}

/** What a company's professional is doing now (APPROVED ones only). */
export type ProfessionalActivity = 'AVAILABLE' | 'ON_JOB';

export class AdminProfessionalDto {
  id!: string;
  name!: string;
  phone!: string;
  email!: string;
  experienceYears!: number;
  categories!: string[];
  /** PENDING until the super admin approves; only APPROVED can be assigned. */
  status!: ProfessionalStatus;
  /** The super admin's reason when REJECTED. */
  note!: string;
  activity!: ProfessionalActivity;
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

// ── users ───────────────────────────────────────────────────────────────────

export class AdminUsersQueryDto extends PaginationQuery {
  /** Part of a name, or digits of a phone number. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;
}

export class SetUserRoleDto {
  @IsEnum(UserType)
  role!: UserType;

  /** Required, with at least one, when role is ADMIN; ignored otherwise. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(AdminModule, { each: true })
  modules?: AdminModule[];
}

export class AdminUserDto {
  id!: string;
  name!: string | null;
  phone!: string | null;
  role!: UserType;
  /** What an ADMIN runs: CLEAN, REPAIR, RENTAL. Empty for every other role. */
  modules!: AdminModule[];
  joinedAt!: string;
}

/** The super admin's dashboard counts. Deleted accounts and listings are left out. */
export class AdminStatsDto {
  /** `total` includes admins and super admins; `customers` is role USER only. */
  users!: { customers: number; admins: number; superAdmins: number; total: number };
  /** Sellers' marketplace listings (`Ad`), every category. */
  listings!: { active: number; paused: number; draft: number; total: number };
  /**
   * ELK's own services that admins run (`HomeService`), including ones still
   * waiting for approval. Rental has no admin-run catalogue, so it is absent.
   */
  providerListings!: { cleaning: number; repair: number; total: number };
}

// ── approvals ───────────────────────────────────────────────────────────────

export const APPROVAL_VIEWS = ['pending', 'decided'] as const;
export type ApprovalView = (typeof APPROVAL_VIEWS)[number];

export class ApprovalsQueryDto extends PaginationQuery {
  /** pending: waiting for review, oldest first. decided: history, newest first. */
  @IsOptional()
  @IsIn(APPROVAL_VIEWS)
  view: ApprovalView = 'pending';
}

export class RejectChangeDto {
  /** Why, shown to the admin in the history. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ServiceTermsDto {
  name!: string;
  vertical!: ServiceVertical;
  category!: string;
  minHours!: number;
  hourlyRate!: number;
  extraProRate!: number;
  materialsFee!: number;
  /** hourlyRate × minHours: the "From" price in the app. */
  startingPrice!: number;
}

export class PersonDto {
  id!: string;
  name!: string | null;
  phone!: string | null;
}

export class ServiceChangeDto {
  id!: string;
  kind!: ServiceChangeKind;
  status!: ServiceChangeStatus;
  /** Null once the service has been deleted. */
  serviceId!: string | null;
  /** In the app now (when decided: at that moment). Null for a new service. */
  current!: ServiceTermsDto | null;
  requested!: ServiceTermsDto;
  /** The fields that differ between current and requested. */
  changed!: string[];
  requestedBy!: PersonDto;
  requestedAt!: string;
  decidedBy!: PersonDto | null;
  decidedAt!: string | null;
  note!: string;
}

export class ApprovalsSummaryDto {
  waiting!: number;
  newServices!: number;
  priceChanges!: number;
  professionals!: number;
}

/** A company's professional, as the super admin reviews them. */
export class ProfessionalApprovalDto {
  id!: string;
  name!: string;
  phone!: string;
  email!: string;
  experienceYears!: number;
  categories!: string[];
  status!: ProfessionalStatus;
  /** The company (ADMIN account) that added them. */
  company!: PersonDto;
  /** When they were added, or last sent back for approval. */
  submittedAt!: string;
  decidedBy!: PersonDto | null;
  decidedAt!: string | null;
  note!: string;
}
