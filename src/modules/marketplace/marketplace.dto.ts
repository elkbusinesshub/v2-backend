import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AdOrderStatus, AdStatus } from '@prisma/client';
import { PartialType } from '@nestjs/swagger';

export class TopSellersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}

export class AdListQueryDto extends TopSellersQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  q?: string;
}

/** One card in the best-sellers rail / marketplace list. */
export class AdDto {
  id!: string;
  title!: string;
  description!: string;
  sellerName!: string;
  categorySlug!: string;
  icon!: string;
  price!: number;
  priceUnit!: string;

  /** "Koramangala, Bengaluru", or empty when the seller gave no location. */
  location!: string;

  /** Centre of `location`, for the coverage map. Null when we have no coordinate. */
  lat!: number | null;
  lng!: number | null;

  /** Engagement, shown on the card and the basis of the ranking. */
  viewCount!: number;
  wishlistCount!: number;

  /** Whether the caller has saved this ad. */
  isWishlisted!: boolean;

  /**
   * DRAFT / ACTIVE / PAUSED. Always ACTIVE on the public reads, which filter
   * to it; it carries information only on `my-ads`, where the seller's own
   * drafts and paused listings appear alongside their live ones.
   */
  status!: AdStatus;

  /** Presigned image URLs, oldest first. Empty until the seller uploads one. */
  imageUrls!: string[];
}

/** Photos a seller may attach, as keys returned by `POST /uploads/image`. */
const MAX_AD_IMAGES = 6;

/** Creating a listing from the seller panel's "Post a new ad" sheet. */
export class CreateAdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  categorySlug!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price!: number;

  /** Display only — "/ visit", "/ day", "starting". */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  priceUnit?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  icon?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  locality?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  /**
   * DRAFT for "Save draft", ACTIVE for "Publish ad". PAUSED is not a valid
   * starting state — an ad has to exist before it can be paused.
   */
  @IsOptional()
  @IsEnum(AdStatus)
  status?: AdStatus;

  /** Storage keys from `POST /uploads/image`, in display order. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_AD_IMAGES)
  imageKeys?: string[];
}

/** Every field optional: the seller panel edits one thing at a time. */
export class UpdateAdDto extends PartialType(CreateAdDto) {}

/** The seller's own listings, including the ones buyers cannot see. */
export class MyAdsQueryDto {
  @IsOptional()
  @IsEnum(AdStatus)
  status?: AdStatus;
}

/** Placing an order against a listing, from the ad detail screen. */
export class CreateAdOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  addressText!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  contactPhone!: string;

  /** When the buyer wants it. Absent means "as soon as possible". */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdOrdersQueryDto {
  @IsOptional()
  @IsEnum(AdOrderStatus)
  status?: AdOrderStatus;
}

/**
 * Seller-driven transitions. The legal moves are enforced in the service, not
 * here: which ones are allowed depends on the order's current state and on
 * whether the caller is the buyer or the seller.
 */
export class UpdateAdOrderStatusDto {
  @IsEnum(AdOrderStatus)
  status!: AdOrderStatus;
}

/** One row in the seller's Orders tab, or the buyer's own order list. */
export class AdOrderDto {
  id!: string;
  code!: string;
  adId!: string;
  status!: AdOrderStatus;
  amount!: number;
  serviceName!: string;
  icon!: string;
  customerName!: string;
  customerPhone!: string;
  addressText!: string;
  note!: string | null;
  /** "Today 12:00 PM" style label, or "As soon as possible". */
  whenLabel!: string;
  scheduledAt!: string | null;
  createdAt!: string;
}
