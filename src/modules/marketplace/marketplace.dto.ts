import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

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

  /** Presigned image URLs, oldest first. Empty until the seller uploads one. */
  imageUrls!: string[];
}
