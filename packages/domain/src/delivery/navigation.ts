/**
 * External navigation links (plan §50, §108, §169, Appendix H).
 *
 * Release 1 does not build turn-by-turn navigation. The driver opens Google Maps
 * (default) or Waze. Maps URLs need no API key, work cross-platform, and fall
 * back to the web when the app is not installed.
 *
 * Plan §50: "No authentication token, delivery PIN, or sensitive secret is ever
 * included in an external deep link." Nothing in this module accepts one.
 */

export interface Destination {
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Human-readable address, used when coordinates are missing (plan §108). */
  readonly addressText?: string | null;
}

export interface NavigationLinks {
  readonly googleMaps: string | null;
  readonly waze: string | null;
  /** Text the driver can copy when neither app opens. */
  readonly copyableAddress: string | null;
  readonly hasCoordinates: boolean;
}

/** Coordinates must be real numbers inside the valid WGS84 range. */
function hasValidCoordinates(destination: Destination): destination is Destination & {
  latitude: number;
  longitude: number;
} {
  const { latitude, longitude } = destination;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    // 0,0 is in the Atlantic — almost always a missing-value sentinel, not a place.
    !(latitude === 0 && longitude === 0)
  );
}

/**
 * Format a coordinate for a URL.
 *
 * Fixed to 6 decimals (~0.1 m) and passed through Number() to strip any
 * exponential notation, which map apps do not parse.
 */
function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * Google Maps directions URL (plan Appendix H):
 *   https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=driving
 */
export function googleMapsUrl(destination: Destination): string | null {
  if (hasValidCoordinates(destination)) {
    const params = new URLSearchParams({
      api: '1',
      destination: `${formatCoordinate(destination.latitude)},${formatCoordinate(destination.longitude)}`,
      travelmode: 'driving',
    });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  // Coordinate-free fallback: search by address text (plan §108).
  if (destination.addressText?.trim()) {
    const params = new URLSearchParams({
      api: '1',
      query: destination.addressText.trim(),
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  return null;
}

/**
 * Waze deep link (plan Appendix H):
 *   https://waze.com/ul?ll=LAT,LNG&navigate=yes
 *
 * Waze has no reliable address-search deep link, so without coordinates there is
 * no Waze option — the UI falls back to Google Maps or "copy address".
 */
export function wazeUrl(destination: Destination): string | null {
  if (!hasValidCoordinates(destination)) return null;
  const params = new URLSearchParams({
    ll: `${formatCoordinate(destination.latitude)},${formatCoordinate(destination.longitude)}`,
    navigate: 'yes',
  });
  return `https://waze.com/ul?${params.toString()}`;
}

/** Everything the driver's navigation row needs, including its fallbacks. */
export function buildNavigationLinks(destination: Destination): NavigationLinks {
  const hasCoordinates = hasValidCoordinates(destination);
  const copyable = hasCoordinates
    ? (destination.addressText?.trim() ??
      `${formatCoordinate(destination.latitude as number)}, ${formatCoordinate(destination.longitude as number)}`)
    : (destination.addressText?.trim() ?? null);

  return {
    googleMaps: googleMapsUrl(destination),
    waze: wazeUrl(destination),
    copyableAddress: copyable,
    hasCoordinates,
  };
}

/**
 * True when an address needs correcting: the order can still be delivered by
 * phone, but the address should be flagged for follow-up (plan §108).
 */
export function needsAddressCorrection(destination: Destination): boolean {
  return !hasValidCoordinates(destination) && !destination.addressText?.trim();
}
