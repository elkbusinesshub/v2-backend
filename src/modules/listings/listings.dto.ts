import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DEFAULT_LISTINGS_PAGE,
  LISTING_CATEGORIES,
  MAX_LISTING_IMAGES,
  MAX_LISTINGS_PAGE,
} from './listings.constants';

/** Browse and filter — every filter optional, all of them combinable. */
export class ListingsQueryDto {
  @ApiPropertyOptional({ enum: LISTING_CATEGORIES })
  @IsOptional()
  @IsIn([...LISTING_CATEGORIES])
  category?: string;

  /** Title or seller name. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  /** Matched against the area and the city the seller typed. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  area?: string;

  @ApiPropertyOptional({ default: DEFAULT_LISTINGS_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LISTINGS_PAGE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * What the listing form sends: title, price and description, with optional
 * photos and area. No category attributes — a listing describes itself in its
 * description, and is always published straight to the marketplace.
 */
export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ enum: LISTING_CATEGORIES })
  @IsIn([...LISTING_CATEGORIES])
  categorySlug!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price!: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  locality?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  city?: string;

  /** Storage keys from `POST /uploads/image`, in display order. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_LISTING_IMAGES)
  imageKeys?: string[];
}
