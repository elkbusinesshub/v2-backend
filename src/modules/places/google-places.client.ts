import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamServiceException } from '@/common/errors/domain.exceptions';
import type { AppConfig } from '@/config/configuration';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const STATIC_MAP_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const PLACES_BASE_URL = 'https://places.googleapis.com/v1';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const REQUEST_TIMEOUT_MS = 8_000;

/** Only the fields we map — asking for fewer fields is also cheaper per call. */
const DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location,addressComponents';
const AUTOCOMPLETE_FIELD_MASK =
  'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat';

/** Geocoding API (v1) address component. */
export interface GeocodeComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GeocodeResult {
  place_id?: string;
  formatted_address: string;
  types: string[];
  address_components: GeocodeComponent[];
  geometry: { location: { lat: number; lng: number } };
}

/** Places API (New) uses camelCase and a different component shape. */
export interface PlaceComponent {
  longText: string;
  shortText: string;
  types: string[];
}

export interface PlaceDetailsResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location: { latitude: number; longitude: number };
  addressComponents?: PlaceComponent[];
}

/** One driving route, as Routes API returns it under our field mask. */
export interface ComputedRoute {
  distanceMeters?: number;
  /** ISO-8601-ish seconds string, e.g. "907s". */
  duration?: string;
  polyline?: { encodedPolyline?: string };
}

export interface AutocompleteSuggestion {
  placePrediction?: {
    placeId: string;
    text?: { text: string };
    structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
  };
}

/**
 * Thin transport over the two Google APIs the app needs, ported from the
 * legacy backend (`backend-elk/modules/place/v1/controller/place.controller.js`).
 *
 * It does HTTP and error translation only — no caching and no mapping, so
 * {@link PlacesService} owns every decision that is ours rather than Google's.
 *
 * Note the two APIs are genuinely different products: reverse geocoding is the
 * old Geocoding API (snake_case, `status` field), while search and details are
 * Places API (New) (camelCase, HTTP status only). The legacy backend mixed
 * both the same way.
 */
@Injectable()
export class GooglePlacesClient {
  private readonly logger = new Logger(GooglePlacesClient.name);
  private readonly apiKey: string;
  private readonly regionCode: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.apiKey = config.get('places.googleMapsApiKey', { infer: true });
    this.regionCode = config.get('places.regionCode', { infer: true });
  }

  /** False when no API key is configured — the module is then inert rather than proxying broken requests. */
  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Reverse geocode a coordinate. Empty array means Google found nothing there. */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodeResult[]> {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('language', 'en');
    url.searchParams.set('key', this.apiKey);

    const body = await this.getJson<{ status: string; results?: GeocodeResult[] }>(
      url.toString(),
      'reverse geocode',
    );

    // The Geocoding API returns HTTP 200 for its own failures; `status` is the
    // real result. ZERO_RESULTS is a legitimate empty answer, not an error.
    if (body.status === 'ZERO_RESULTS') return [];
    if (body.status !== 'OK') {
      this.logger.error({ status: body.status, lat, lng }, 'geocoding API returned a failure');
      throw new UpstreamServiceException('Could not resolve that location');
    }
    return body.results ?? [];
  }

  /** Autocomplete predictions for a partial address, biased to the configured region. */
  async autocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const response = await this.request(`${PLACES_BASE_URL}/places:autocomplete`, 'place search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify({ input: query, includedRegionCodes: [this.regionCode] }),
    });

    const body = (await this.parse(response, 'place search')) as {
      suggestions?: AutocompleteSuggestion[];
    };
    return body.suggestions ?? [];
  }

  /** Full details for a place id. Null when Google no longer knows the id. */
  async placeDetails(placeId: string): Promise<PlaceDetailsResult | null> {
    const response = await this.request(
      `${PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}`,
      'place details',
      {
        headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
      },
    );

    // A stale or malformed place id is a client mistake, not an outage.
    if (response.status === 404 || response.status === 400) return null;
    return (await this.parse(response, 'place details')) as PlaceDetailsResult;
  }

  /**
   * Driving route between two points, for the polyline drawn on ride and
   * porter maps. Null when Google can find no road route between them.
   *
   * `TRAFFIC_AWARE` is the cheaper of the two live-traffic modes and is what a
   * ride ETA needs; the alternative recomputes the whole route per request.
   */
  async computeRoute(params: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
  }): Promise<ComputedRoute | null> {
    const response = await this.request(ROUTES_URL, 'compute route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: {
          location: { latLng: { latitude: params.originLat, longitude: params.originLng } },
        },
        destination: {
          location: { latLng: { latitude: params.destLat, longitude: params.destLng } },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        polylineEncoding: 'ENCODED_POLYLINE',
      }),
    });

    const body = (await this.parse(response, 'compute route')) as { routes?: ComputedRoute[] };
    // An empty `routes` array is Google saying "no road route", e.g. across
    // water — a legitimate answer, not an outage.
    return body.routes?.[0] ?? null;
  }

  private async getJson<T>(url: string, operation: string): Promise<T> {
    return (await this.parse(await this.request(url, operation), operation)) as T;
  }

  private async request(url: string, operation: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      // Network failure or timeout — Google was never reached.
      this.logger.error({ err, operation }, 'Google Maps request failed');
      throw new UpstreamServiceException('Location service is unavailable — please try again');
    }
  }

  private async parse(response: Response, operation: string): Promise<unknown> {
    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      // Logged in full because Google's rejections (bad key, API not enabled,
      // billing disabled) are only diagnosable from the body.
      this.logger.error({ status: response.status, body, operation }, 'Google Maps rejected');
      throw new UpstreamServiceException('Location service is unavailable — please try again');
    }
    try {
      return await response.json();
    } catch (err) {
      this.logger.error({ err, operation }, 'Google Maps returned unparseable JSON');
      throw new UpstreamServiceException('Location service is unavailable — please try again');
    }
  }

  /**
   * Fetches a Static Maps image. Returned as bytes rather than a URL so the
   * API key stays on the server, the same reason geocoding is proxied.
   *
   * `scale=2` renders at 2x for retina screens; `size` is the logical size.
   */
  async staticMap(params: {
    lat: number;
    lng: number;
    zoom: number;
    width: number;
    height: number;
  }): Promise<{ body: Buffer; contentType: string }> {
    const url = new URL(STATIC_MAP_URL);
    url.searchParams.set('center', `${params.lat},${params.lng}`);
    url.searchParams.set('zoom', String(params.zoom));
    url.searchParams.set('size', `${params.width}x${params.height}`);
    url.searchParams.set('scale', '2');
    url.searchParams.set('maptype', 'roadmap');
    url.searchParams.set('markers', `color:0x137A6D|${params.lat},${params.lng}`);
    url.searchParams.set('region', this.regionCode);
    url.searchParams.set('key', this.apiKey);

    const response = await this.request(url.toString(), 'staticMap');
    const contentType = response.headers.get('content-type') ?? '';
    // A disabled or unbilled API answers 403 with a text/plain explanation,
    // which would otherwise be cached and rendered as a broken image.
    if (!response.ok || !contentType.startsWith('image/')) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(`Static Maps rejected the request: ${detail.slice(0, 200)}`);
      throw new UpstreamServiceException('Map imagery is unavailable');
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType,
    };
  }
}
