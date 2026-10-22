/**
 * What both map pickers share.
 *
 * `map-picker.tsx` draws the map on a device and `map-picker.web.tsx` in a
 * browser, and Metro picks one by platform. The web file used to import
 * `isSamePoint` from `./map-picker` — which on web resolves to itself, so the
 * import was a cycle and the function was `undefined` at the first pick. The
 * pieces both files need live here, where neither platform shadows them.
 */

export interface MapPickerProps {
  /** Where the pin is. Falls back to the centre of Haditha. */
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly onPick: (coordinates: { latitude: number; longitude: number }) => void;
  readonly height?: number;
  /** Whose door the pin marks — the hint says «منزلك» or «باب متجرك» (MERCH-18). */
  readonly placeNoun?: 'home' | 'shop';
}

/** About a metre: closer than this, a new position is the map's own echo. */
const SAME_POINT_DEGREES = 1e-5;

export function isSamePoint(
  a: { latitude: number; longitude: number } | null,
  b: { latitude: number; longitude: number },
): boolean {
  return (
    a !== null &&
    Math.abs(a.latitude - b.latitude) < SAME_POINT_DEGREES &&
    Math.abs(a.longitude - b.longitude) < SAME_POINT_DEGREES
  );
}
