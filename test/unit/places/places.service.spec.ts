import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CacheService } from '@/cache/cache.service';
import {
  ResourceNotFoundException,
  UpstreamServiceException,
} from '@/common/errors/domain.exceptions';
import { GooglePlacesClient } from '@/modules/places/google-places.client';
import { PlacesService } from '@/modules/places/places.service';

const settings: Record<string, unknown> = {
  'places.googleMapsApiKey': 'test-key',
  'places.regionCode': 'IN',
};

/** A Kakkanad, Kochi reverse-geocode result in the Geocoding API's shape. */
function geocodeResult(overrides: Record<string, unknown> = {}) {
  return {
    place_id: 'ChIJgeo',
    formatted_address: 'Kakkanad, Kochi, Kerala 682030, India',
    types: ['sublocality', 'sublocality_level_1', 'political'],
    address_components: [
      {
        long_name: 'Kakkanad',
        short_name: 'Kakkanad',
        types: ['sublocality_level_1', 'political'],
      },
      { long_name: 'Kochi', short_name: 'Kochi', types: ['locality', 'political'] },
      {
        long_name: 'Ernakulam',
        short_name: 'Ernakulam',
        types: ['administrative_area_level_3', 'political'],
      },
      {
        long_name: 'Kerala',
        short_name: 'KL',
        types: ['administrative_area_level_1', 'political'],
      },
      { long_name: 'India', short_name: 'IN', types: ['country', 'political'] },
    ],
    geometry: { location: { lat: 10.0159, lng: 76.3419 } },
    ...overrides,
  };
}

/** The same place in the Places API (New) shape — camelCase, different keys. */
function detailsResult() {
  return {
    id: 'ChIJdetails',
    displayName: { text: 'Kakkanad' },
    formattedAddress: 'Kakkanad, Kochi, Kerala, India',
    location: { latitude: 10.0159, longitude: 76.3419 },
    addressComponents: [
      { longText: 'Kakkanad', shortText: 'Kakkanad', types: ['sublocality_level_1'] },
      { longText: 'Kochi', shortText: 'Kochi', types: ['locality'] },
      { longText: 'Ernakulam', shortText: 'Ernakulam', types: ['administrative_area_level_2'] },
      { longText: 'Kerala', shortText: 'KL', types: ['administrative_area_level_1'] },
      { longText: 'India', shortText: 'IN', types: ['country'] },
    ],
  };
}

describe('PlacesService', () => {
  let google: jest.Mocked<GooglePlacesClient>;
  let cache: jest.Mocked<CacheService>;
  let service: PlacesService;
  let configured: boolean;

  async function build(): Promise<PlacesService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlacesService,
        { provide: GooglePlacesClient, useValue: google },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    return moduleRef.get(PlacesService);
  }

  beforeEach(async () => {
    configured = true;
    google = {
      autocomplete: jest.fn().mockResolvedValue([]),
      placeDetails: jest.fn().mockResolvedValue(detailsResult()),
      reverseGeocode: jest.fn().mockResolvedValue([geocodeResult()]),
      get isConfigured() {
        return configured;
      },
    } as unknown as jest.Mocked<GooglePlacesClient>;
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>;
    service = await build();
  });

  describe('reverse', () => {
    it('maps Google components onto the five administrative levels', async () => {
      const place = await service.reverse(10.0159, 76.3419);

      expect(place).toMatchObject({
        placeId: 'ChIJgeo',
        type: 'locality',
        name: 'Kakkanad',
        locality: 'Kakkanad',
        city: 'Kochi',
        district: 'Ernakulam',
        state: 'Kerala',
        country: 'India',
        lat: 10.0159,
        lng: 76.3419,
      });
    });

    it('falls back through the sub-locality aliases', async () => {
      google.reverseGeocode.mockResolvedValue([
        geocodeResult({
          types: ['neighborhood'],
          address_components: [
            { long_name: 'Palarivattom', short_name: 'Palarivattom', types: ['neighborhood'] },
            { long_name: 'Kochi', short_name: 'Kochi', types: ['locality'] },
          ],
        }),
      ]);

      const place = await service.reverse(10.0, 76.3);
      expect(place.locality).toBe('Palarivattom');
      expect(place.type).toBe('locality');
    });

    it('leaves levels Google did not return as null', async () => {
      google.reverseGeocode.mockResolvedValue([
        geocodeResult({
          types: ['locality'],
          address_components: [
            { long_name: 'Kochi', short_name: 'Kochi', types: ['locality'] },
            { long_name: 'India', short_name: 'IN', types: ['country'] },
          ],
        }),
      ]);

      const place = await service.reverse(10.0, 76.3);
      expect(place.locality).toBeNull();
      expect(place.state).toBeNull();
      expect(place.city).toBe('Kochi');
      // No sub-locality, so the city becomes the header label.
      expect(place.name).toBe('Kochi');
    });

    it('rounds the cache key so GPS jitter reuses one entry', async () => {
      await service.reverse(10.015912345, 76.341987654);

      expect(cache.set).toHaveBeenCalledWith(
        'places:rev:10.0159,76.3420',
        expect.anything(),
        expect.any(Number),
      );
    });

    it('serves a cached coordinate without calling Google', async () => {
      cache.get.mockResolvedValue({ name: 'Cached' });

      const place = await service.reverse(10.0159, 76.3419);
      expect(place).toEqual({ name: 'Cached' });
      expect(google.reverseGeocode).not.toHaveBeenCalled();
    });

    it('classifies a street address by its finest named level, not as a city', async () => {
      google.reverseGeocode.mockResolvedValue([
        geocodeResult({
          // A house number has no administrative type of its own.
          types: ['street_address'],
        }),
      ]);

      const place = await service.reverse(10.0159, 76.3419);
      expect(place.type).toBe('locality');
      expect(place.name).toBe('Kakkanad');
    });

    it('reports an unmapped coordinate as not found', async () => {
      google.reverseGeocode.mockResolvedValue([]);

      await expect(service.reverse(0, 0)).rejects.toBeInstanceOf(ResourceNotFoundException);
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('flattens predictions to the fields the picker renders', async () => {
      google.autocomplete.mockResolvedValue([
        {
          placePrediction: {
            placeId: 'ChIJa',
            text: { text: 'Kakkanad, Kochi, Kerala, India' },
            structuredFormat: {
              mainText: { text: 'Kakkanad' },
              secondaryText: { text: 'Kochi, Kerala, India' },
            },
          },
        },
      ]);

      await expect(service.search('kakka')).resolves.toEqual([
        {
          placeId: 'ChIJa',
          text: 'Kakkanad, Kochi, Kerala, India',
          mainText: 'Kakkanad',
          secondaryText: 'Kochi, Kerala, India',
        },
      ]);
    });

    it('drops suggestions with no place id rather than returning untappable rows', async () => {
      google.autocomplete.mockResolvedValue([{}, { placePrediction: undefined }]);

      await expect(service.search('kakka')).resolves.toEqual([]);
    });

    it('is not cached — the user is still typing', async () => {
      await service.search('kakka');

      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('details', () => {
    it('maps the Places API shape onto the same DTO as reverse geocoding', async () => {
      const place = await service.details('ChIJdetails');

      expect(place).toMatchObject({
        placeId: 'ChIJdetails',
        type: 'locality',
        name: 'Kakkanad',
        locality: 'Kakkanad',
        city: 'Kochi',
        district: 'Ernakulam',
        state: 'Kerala',
        country: 'India',
        lat: 10.0159,
        lng: 76.3419,
      });
    });

    it('caches by place id', async () => {
      await service.details('ChIJdetails');

      expect(cache.set).toHaveBeenCalledWith(
        'places:id:ChIJdetails',
        expect.objectContaining({ placeId: 'ChIJdetails' }),
        expect.any(Number),
      );
    });

    it('reports a stale place id as not found', async () => {
      google.placeDetails.mockResolvedValue(null);

      await expect(service.details('gone')).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  it('refuses every operation when no API key is configured', async () => {
    configured = false;

    await expect(service.search('kakka')).rejects.toBeInstanceOf(UpstreamServiceException);
    await expect(service.reverse(10, 76)).rejects.toBeInstanceOf(UpstreamServiceException);
    await expect(service.details('x')).rejects.toBeInstanceOf(UpstreamServiceException);
    expect(google.autocomplete).not.toHaveBeenCalled();
  });
});

describe('GooglePlacesClient', () => {
  let fetchMock: jest.Mock;

  async function build(overrides: Record<string, unknown> = {}): Promise<GooglePlacesClient> {
    const values = { ...settings, ...overrides };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GooglePlacesClient,
        { provide: ConfigService, useValue: { get: (k: string) => values[k] } },
      ],
    }).compile();
    return moduleRef.get(GooglePlacesClient);
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

  it('treats ZERO_RESULTS as an empty answer, not an outage', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'ZERO_RESULTS' }));
    const client = await build();

    await expect(client.reverseGeocode(0, 0)).resolves.toEqual([]);
  });

  it('raises upstream when the Geocoding API reports a failure inside a 200', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'REQUEST_DENIED', error_message: 'bad key' }));
    const client = await build();

    await expect(client.reverseGeocode(10, 76)).rejects.toBeInstanceOf(UpstreamServiceException);
  });

  it('biases autocomplete to the configured region', async () => {
    fetchMock.mockResolvedValue(ok({ suggestions: [] }));
    const client = await build({ 'places.regionCode': 'AE' });

    await client.autocomplete('marina');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      input: 'marina',
      includedRegionCodes: ['AE'],
    });
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
  });

  it('sends the API key in a header, never in the Places URL', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'x', location: { latitude: 1, longitude: 2 } }));
    const client = await build();

    await client.placeDetails('ChIJ x/y');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain('test-key');
    // The id is escaped, so a crafted id cannot climb the Places URL path.
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJ%20x%2Fy');
  });

  it('returns null for a place id Google rejects', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('not found'),
    });
    const client = await build();

    await expect(client.placeDetails('gone')).resolves.toBeNull();
  });

  it('converts a network failure into an upstream error', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const client = await build();

    await expect(client.autocomplete('kakka')).rejects.toBeInstanceOf(UpstreamServiceException);
  });

  it('is unconfigured when the key is empty', async () => {
    const client = await build({ 'places.googleMapsApiKey': '' });

    expect(client.isConfigured).toBe(false);
  });
});
