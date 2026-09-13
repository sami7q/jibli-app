import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

/**
 * Where the customer is, and how a driver gets there.
 *
 * Two deliberately small pieces, because the alternative is large: an in-app
 * map needs a map SDK, a Google or Mapbox key, a billing account and a
 * geocoder, and none of that makes a delivery arrive faster in a city where
 * addresses are landmarks rather than street numbers.
 *
 * What does help is a pair of coordinates attached to the address — «قرب صيدلية
 * النور» plus a point — and a way to open that point in whatever maps app the
 * driver already uses. Neither needs a key, an account, or a screen that has to
 * render a tile server.
 *
 * ADR-0005 stands: there is no live driver tracking here. This is a fixed point
 * captured once, with the customer's permission, at the moment they save an
 * address.
 */

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
  /** Metres. A fix worse than ~100m is not worth attaching to an address. */
  readonly accuracy: number | null;
}

export type LocationOutcome =
  | { readonly status: 'ok'; readonly coordinates: Coordinates }
  | { readonly status: 'denied' }
  | { readonly status: 'disabled' }
  | { readonly status: 'unavailable' };

/**
 * Iraq's bounding box, roughly.
 *
 * A device that returns a fix in the Atlantic — which is what a failed GPS
 * emulator does — must not have it saved onto an address, because nothing
 * downstream questions a coordinate once it is stored.
 */
const IRAQ_BOUNDS = { minLat: 28.5, maxLat: 37.5, minLon: 38.5, maxLon: 49.0 };

function withinIraq({ latitude, longitude }: { latitude: number; longitude: number }): boolean {
  return (
    latitude >= IRAQ_BOUNDS.minLat &&
    latitude <= IRAQ_BOUNDS.maxLat &&
    longitude >= IRAQ_BOUNDS.minLon &&
    longitude <= IRAQ_BOUNDS.maxLon
  );
}

/**
 * Ask once, then read the position.
 *
 * Foreground only — `requestForegroundPermissionsAsync` — because the app has
 * no reason to know where anyone is when it is closed, and asking for more
 * than that is both a store-review problem and a promise the product does not
 * need to make.
 */
export async function captureCurrentLocation(): Promise<LocationOutcome> {
  try {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) return { status: 'disabled' };

    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return { status: 'denied' };

    const position = await Location.getCurrentPositionAsync({
      // Balanced rather than highest: a delivery pin does not need a metre,
      // and the high-accuracy mode can take fifteen seconds on a cold GPS.
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude, accuracy } = position.coords;
    if (!withinIraq({ latitude, longitude })) return { status: 'unavailable' };

    return {
      status: 'ok',
      coordinates: { latitude, longitude, accuracy: accuracy ?? null },
    };
  } catch {
    // A location read can fail for a dozen reasons the customer cannot act on.
    // They all mean the same thing here: type the address instead.
    return { status: 'unavailable' };
  }
}

/** What to tell the customer when it did not work. */
export const LOCATION_MESSAGES_AR: Record<Exclude<LocationOutcome['status'], 'ok'>, string> = {
  denied: 'لم تُمنح صلاحية الموقع. يمكنك كتابة العنوان يدوياً.',
  disabled: 'خدمة الموقع مغلقة في جهازك. فعّلها أو اكتب العنوان يدوياً.',
  unavailable: 'تعذّر تحديد موقعك الآن. اكتب العنوان يدوياً.',
};

/**
 * Open a point in whatever maps app the phone has.
 *
 * `geo:` on Android is the intent every maps app registers for, so the driver
 * keeps using the one they already trust. iOS has no equivalent scheme that
 * offers a choice, so it goes to Apple Maps, which is always installed. The
 * https fallback is for anything that answers neither.
 */
export async function openInMaps(
  coordinates: { latitude: number; longitude: number },
  label?: string,
): Promise<boolean> {
  const { latitude, longitude } = coordinates;
  const name = encodeURIComponent(label ?? 'عنوان التوصيل');

  const candidates =
    Platform.OS === 'android'
      ? [`geo:${latitude},${longitude}?q=${latitude},${longitude}(${name})`]
      : [`maps://?ll=${latitude},${longitude}&q=${name}`];

  candidates.push(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);

  for (const url of candidates) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      /* try the next one */
    }
  }

  return false;
}
