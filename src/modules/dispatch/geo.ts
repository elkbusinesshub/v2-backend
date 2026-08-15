/** Mean earth radius in kilometres. */
const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Haversine rather than a projected approximation: dispatch radii are small
 * enough that either would do, but this one does not degrade near the poles or
 * across the antimeridian, and it costs nothing extra to be right everywhere.
 */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * A latitude/longitude box that fully contains the circle of [radiusKm] around
 * [centre].
 *
 * Used to narrow the query in SQL before measuring properly in JS: an index on
 * two indexed columns can serve a box, but not a circle. The box is a superset,
 * so nothing inside the circle is missed — the corners are then discarded by
 * the real distance check.
 */
export function boundingBox(
  centre: { lat: number; lng: number },
  radiusKm: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  // Longitude degrees shrink towards the poles; guard the cosine so a point at
  // a pole widens the box to everything rather than dividing by zero.
  const cosLat = Math.max(Math.cos(toRadians(centre.lat)), 1e-6);
  const lngDelta = latDelta / cosLat;

  return {
    minLat: centre.lat - latDelta,
    maxLat: centre.lat + latDelta,
    minLng: centre.lng - lngDelta,
    maxLng: centre.lng + lngDelta,
  };
}
