import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';

/** `expo-secure-store` is `export default {}` on web; the flag is not a secret. */
const isWeb = Platform.OS === 'web';

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

/**
 * Whether the customer has already said yes.
 *
 * Read, never ask. `captureCurrentLocation` raises the system dialog, and a
 * prompt that appears because a form opened — rather than because somebody
 * pressed something — is the one every customer denies. The address sheet uses
 * this to decide whether it may quietly open the map on where they are standing.
 */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    return existing.status === 'granted';
  } catch {
    // No location services on this device or platform.
    return false;
  }
}

/**
 * Ask for the permission once, early, and never again.
 *
 * A delivery app that only asks at the address form asks at the worst moment:
 * the customer is mid-checkout, hungry, and a system dialog lands on top of
 * the one screen where hesitating costs an order. Asking on the way in — after
 * the session resolves, on the home screen, not over a sign-in — means the
 * answer is already known by the time it matters, and the map opens on the
 * right street instead of on Tahrir Square.
 *
 * Once is the important half. iOS shows the prompt exactly once and every
 * later request resolves silently to the earlier answer, so re-asking trains
 * nobody and annoys everybody; the flag makes Android behave the same way.
 * A customer who said no can still say yes from the address form, which asks
 * deliberately rather than automatically.
 */
const ASKED_KEY = 'jibli.location.asked';

export async function ensureLocationPermissionAsked(): Promise<void> {
  try {
    if (isWeb ? globalThis.localStorage?.getItem(ASKED_KEY) : await SecureStore.getItemAsync(ASKED_KEY)) {
      return;
    }
  } catch {
    // Unreadable storage: fall through and ask. The platform dialog is itself
    // idempotent, so the worst case is a prompt that never appears.
  }

  try {
    const existing = await Location.getForegroundPermissionsAsync();
    // Only when the platform is still willing to show a dialog. Calling
    // `request` after a denial is a no-op on iOS and a second prompt on some
    // Android builds — neither is worth it.
    if (existing.status === 'undetermined' && existing.canAskAgain) {
      await Location.requestForegroundPermissionsAsync();
    }
  } catch {
    /* No location services on this device or platform. */
  }

  try {
    if (isWeb) globalThis.localStorage?.setItem(ASKED_KEY, '1');
    else await SecureStore.setItemAsync(ASKED_KEY, '1');
  } catch {
    /* The flag is a convenience; the platform is the real record. */
  }
}

/** What to tell the customer when it did not work. */
export const LOCATION_MESSAGES_AR: Record<Exclude<LocationOutcome['status'], 'ok'>, string> = {
  denied: 'لم تُمنح صلاحية الموقع. يمكنك كتابة العنوان يدوياً.',
  disabled: 'خدمة الموقع مغلقة في جهازك. فعّلها أو اكتب العنوان يدوياً.',
  unavailable: 'تعذّر تحديد موقعك الآن. اكتب العنوان يدوياً.',
};
