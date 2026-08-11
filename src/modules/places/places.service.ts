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
import type { PlaceSuggestionDto, PlaceType, ResolvedPlaceDto, RouteDto } from './places.dto';

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

/**
 * Routes go stale as roads and traffic change, so they are cached far more
 * briefly than places. Long enough that redrawing the same trip across the
 * booking steps is one call, short enough that a route is never a day old.
 */
const ROUTE_TTL_SECONDS = 15 * 60;

/**
 * Decodes Google's encoded polyline into `[lat, lng]` pairs.
 *
 * The format stores each point as a signed offset from the previous one, in
 * chunks of five bits with a continuation flag — see
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * Done here rather than in the app so only one codebase speaks the format.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const nextDelta = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    // Odd values are negative — the sign is carried in the low bit.
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += nextDelta();
    lng += nextDelta();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

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

  /**
   * The driving route between two points, for the polyline on ride and porter
   * maps.
   *
   * Returns null when Google knows no road route; callers fall back to a
   * straight line rather than showing no route at all.
   */
  async route(params: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
  }): Promise<RouteDto | null> {
    this.assertConfigured();

    const p = COORD_PRECISION;
    const key =
      `places:route:${params.originLat.toFixed(p)},${params.originLng.toFixed(p)}` +
      `:${params.destLat.toFixed(p)},${params.destLng.toFixed(p)}`;
    const cached = await this.cache.get<RouteDto>(key);
    if (cached) return cached;

    const computed = await this.google.computeRoute(params);
    const encoded = computed?.polyline?.encodedPolyline;
    if (!computed || !encoded) return null;

    const route: RouteDto = {
      points: decodePolyline(encoded),
      distanceMeters: computed.distanceMeters ?? 0,
      // Routes API gives duration as a seconds string, e.g. "907s".
      durationSeconds: Number.parseInt(computed.duration ?? '0', 10) || 0,
    };
    await this.cache.set(key, route, ROUTE_TTL_SECONDS);
    return route;
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
  /**
   * Renders a map image for a coordinate.
   *
   * Cached for 30 days like the geocoding results: the same branch or service
   * area is drawn on every screen open, and each miss is a billed Google call.
   * The key is rounded to 4 dp (~11 m) so tiny GPS jitter still hits.
   */
  async staticMap(params: {
    lat: number;
    lng: number;
    zoom: number;
    width: number;
    height: number;
  }): Promise<{ body: Buffer; contentType: string }> {
    const key =
      `places:map:${params.lat.toFixed(4)},${params.lng.toFixed(4)}` +
      `:${params.zoom}:${params.width}x${params.height}`;

    // Base64 through CacheService rather than a raw Redis buffer, so this
    // stays on the same cache abstraction as the geocoding results.
    const cached = await this.cache.get<{ body: string; contentType: string }>(key);
    if (cached) {
      return {
        body: Buffer.from(cached.body, 'base64'),
        contentType: cached.contentType,
      };
    }

    const image = await this.google.staticMap(params);
    await this.cache.set(
      key,
      { body: image.body.toString('base64'), contentType: image.contentType },
      RESOLVED_TTL_SECONDS,
    );
    return image;
  }
}
