import { Injectable } from '@nestjs/common';
import { CacheService } from '@/cache/cache.service';
import {
  ResourceNotFoundException,
  UpstreamServiceException,
} from '@/common/errors/domain.exceptions';
import {
  GooglePlacesClient,
  type GeocodeResult,
  type PlaceDetailsResult,
} from './google-places.client';
import type { PlaceSuggestionDto, PlaceType, ResolvedPlaceDto } from './places.dto';

/**
 * Google's terms allow caching place content for up to 30 days. Resolved
 * places barely change, and every cache hit is a call we are not billed for.
 */
const RESOLVED_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * ~11 m. Coarse enough that a stationary phone's GPS jitter keeps hitting the
 * same cache entry, fine enough that neighbouring streets stay distinct.
 */
const COORD_PRECISION = 4;

/** Component shape shared by the two Google APIs after normalisation. */
interface Component {
  text: string;
  types: string[];
}

@Injectable()
export class PlacesService {
  constructor(
    private readonly google: GooglePlacesClient,
    private readonly cache: CacheService,
  ) {}

  /** Autocomplete predictions. Deliberately uncached — the user is still typing. */
  async search(query: string): Promise<PlaceSuggestionDto[]> {
    this.assertConfigured();

    const suggestions = await this.google.autocomplete(query.trim());
    return suggestions.flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      if (!prediction?.placeId) return [];
      return [
        {
          placeId: prediction.placeId,
          text: prediction.text?.text ?? '',
          mainText: prediction.structuredFormat?.mainText?.text ?? '',
          secondaryText: prediction.structuredFormat?.secondaryText?.text ?? '',
        },
      ];
    });
  }

  /** Full detail for a suggestion the user tapped. */
  async details(placeId: string): Promise<ResolvedPlaceDto> {
    this.assertConfigured();

    const cached = await this.cache.get<ResolvedPlaceDto>(`places:id:${placeId}`);
    if (cached) return cached;

    const place = await this.google.placeDetails(placeId);
    if (!place) {
      throw new ResourceNotFoundException('Place');
    }

    const resolved = this.fromPlaceDetails(place);
    await this.cache.set(`places:id:${placeId}`, resolved, RESOLVED_TTL_SECONDS);
    return resolved;
  }

  /** Reverse geocode — "where am I", for the GPS button in the location picker. */
  async reverse(lat: number, lng: number): Promise<ResolvedPlaceDto> {
    this.assertConfigured();

    const key = `places:rev:${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
    const cached = await this.cache.get<ResolvedPlaceDto>(key);
    if (cached) return cached;

    const results = await this.google.reverseGeocode(lat, lng);
    if (results.length === 0) {
      throw new ResourceNotFoundException('Location');
    }

    // Google orders results finest-first, so the first is the most specific
    // address for the point — the same one the legacy backend returned.
    const resolved = this.fromGeocode(results[0]!);
    await this.cache.set(key, resolved, RESOLVED_TTL_SECONDS);
    return resolved;
  }

  private assertConfigured(): void {
    if (!this.google.isConfigured) {
      throw new UpstreamServiceException('Location search is not configured');
    }
  }

  private fromGeocode(result: GeocodeResult): ResolvedPlaceDto {
    const components: Component[] = result.address_components.map((c) => ({
      text: c.long_name,
      types: c.types,
    }));
    const levels = this.levels(components);

    return {
      placeId: result.place_id ?? null,
      // Google's own classification wins when the result *is* an administrative
      // area; a street address or business has no such type, so fall back to
      // the finest level its components named.
      type: this.resolveType(result.types) ?? this.finestLevel(levels),
      name: levels.locality ?? levels.city ?? result.formatted_address,
      formattedAddress: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      ...levels,
    };
  }

  private fromPlaceDetails(place: PlaceDetailsResult): ResolvedPlaceDto {
    const components: Component[] = (place.addressComponents ?? []).map((c) => ({
      text: c.longText,
      types: c.types,
    }));
    const levels = this.levels(components);
    const formattedAddress = place.formattedAddress ?? place.displayName?.text ?? '';

    return {
      placeId: place.id,
      // The details endpoint has no top-level `types` in our field mask, so the
      // level is inferred from the finest component that came back.
      type: this.finestLevel(levels),
      name: place.displayName?.text ?? levels.locality ?? levels.city ?? formattedAddress,
      formattedAddress,
      lat: place.location.latitude,
      lng: place.location.longitude,
      ...levels,
    };
  }

  /**
   * Maps Google's component types onto our five levels. The fallback chains
   * are the legacy backend's: Indian addresses inconsistently use
   * `sublocality_level_1`, `sublocality` or `neighborhood` for the same thing,
   * and skip `administrative_area_level_2` in some states.
   */
  private levels(components: Component[]): {
    locality: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    country: string | null;
  } {
    const pick = (...types: string[]): string | null => {
      for (const type of types) {
        const match = components.find((c) => c.types.includes(type));
        if (match) return match.text;
      }
      return null;
    };

    return {
      locality: pick('sublocality_level_1', 'sublocality', 'neighborhood'),
      city: pick('locality'),
      district: pick('administrative_area_level_3', 'administrative_area_level_2'),
      state: pick('administrative_area_level_1'),
      country: pick('country'),
    };
  }

  /** Null when the result is not an administrative area at all (street address, premise, business). */
  private resolveType(types: string[]): PlaceType | null {
    if (types.some((t) => ['sublocality', 'sublocality_level_1', 'neighborhood'].includes(t))) {
      return 'locality';
    }
    if (types.includes('locality')) return 'city';
    if (
      types.some((t) => ['administrative_area_level_2', 'administrative_area_level_3'].includes(t))
    ) {
      return 'district';
    }
    if (types.includes('administrative_area_level_1')) return 'state';
    if (types.includes('country')) return 'country';
    return null;
  }

  private finestLevel(levels: Record<PlaceType, string | null>): PlaceType {
    if (levels.locality) return 'locality';
    if (levels.city) return 'city';
    if (levels.district) return 'district';
    if (levels.state) return 'state';
    return 'country';
  }
}
