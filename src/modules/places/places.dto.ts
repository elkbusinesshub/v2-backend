import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** The administrative level a resolved place sits at, coarsest last. */
export const PLACE_TYPES = ['locality', 'city', 'district', 'state', 'country'] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

export class ReverseGeocodeQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class PlaceSearchQueryDto {
  /**
   * Two characters is the shortest input worth spending a Google call on —
   * a single letter matches most of the country and bills the same.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  query!: string;
}

/** One autocomplete prediction. `placeId` is what /places/:placeId takes. */
export class PlaceSuggestionDto {
  placeId!: string;
  /** Full prediction text, e.g. "Kochi, Kerala, India". */
  text!: string;
  /** Bold part of the prediction, e.g. "Kochi". */
  mainText!: string;
  /** Grey part of the prediction, e.g. "Kerala, India". */
  secondaryText!: string;
}

/**
 * A coordinate resolved to named administrative levels.
 *
 * Field names follow the legacy backend's mapping, with one rename: legacy
 * called the city `place`, which is ambiguous inside an object that is itself
 * a place. Every level is nullable — Google does not return all of them
 * everywhere (a rural coordinate often has no `locality`).
 */
export class ResolvedPlaceDto {
  @ApiProperty({ nullable: true, description: 'Google place id; null for reverse-geocoded points' })
  placeId!: string | null;

  @ApiProperty({ enum: PLACE_TYPES, description: 'Finest level this result names' })
  type!: PlaceType;

  /** Best single label for a header, e.g. "Kakkanad". */
  name!: string;

  formattedAddress!: string;
  lat!: number;
  lng!: number;

  @ApiProperty({ nullable: true, description: 'Neighbourhood / sub-locality' })
  locality!: string | null;

  @ApiProperty({ nullable: true, description: 'City or town' })
  city!: string | null;

  @ApiProperty({ nullable: true })
  district!: string | null;

  @ApiProperty({ nullable: true })
  state!: string | null;

  @ApiProperty({ nullable: true })
  country!: string | null;
}

export class RouteQueryDto {
  @ApiProperty({ example: 12.9716 })
  @Type(() => Number)
  @IsLatitude()
  originLat!: number;

  @ApiProperty({ example: 77.5946 })
  @Type(() => Number)
  @IsLongitude()
  originLng!: number;

  @ApiProperty({ example: 12.9352 })
  @Type(() => Number)
  @IsLatitude()
  destLat!: number;

  @ApiProperty({ example: 77.6245 })
  @Type(() => Number)
  @IsLongitude()
  destLng!: number;
}

/**
 * A driving route between two points.
 *
 * `points` is decoded server-side rather than shipping Google's encoded
 * polyline, so the app does not carry a decoder for a format only this one
 * endpoint speaks.
 */
export class RouteDto {
  @ApiProperty({
    description: 'Route shape, origin first',
    type: 'array',
    items: { type: 'array' },
  })
  points!: [number, number][];

  distanceMeters!: number;
  durationSeconds!: number;
}

/**
 * Static map request. Bounded on every axis: the endpoint proxies a metered
 * Google account, so an unbounded size or zoom is a way to run up the bill.
 */
export class StaticMapQueryDto {
  @ApiProperty({ example: 12.9352 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 77.6245 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  zoom: number = 15;

  @ApiPropertyOptional({ minimum: 80, maximum: 640, default: 400 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(80)
  @Max(640)
  width: number = 400;

  @ApiPropertyOptional({ minimum: 80, maximum: 640, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(80)
  @Max(640)
  height: number = 200;
}
