import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Which saved address this phone is ordering to.
 *
 * The server has a notion of a default — one address per customer, enforced by
 * a partial unique index — and it is the right cross-device answer. What it
 * cannot express is «today I am at the office», because there is no endpoint to
 * move it: addresses can be created and deleted and nothing else. Switching
 * would mean writing a copy and retiring the original on every tap, which
 * churns ids and leaves a trail of soft-deleted rows behind an act as small as
 * choosing from a list.
 *
 * So the choice is local, and it sits in front of the server's default rather
 * than replacing it: this phone honours the pick, a second phone still gets the
 * account's default, and an address that disappears falls back to it too.
 *
 * `expo-secure-store` is `export default {}` on web — calling it there throws —
 * so the browser preview uses `localStorage`, as the session store does.
 * Nothing here is a secret; it is one id.
 */

const KEY = 'jibli.address.preferred';

const isWeb = Platform.OS === 'web';

export async function loadPreferredAddressId(): Promise<string | null> {
  try {
    return isWeb
      ? (globalThis.localStorage?.getItem(KEY) ?? null)
      : await SecureStore.getItemAsync(KEY);
  } catch {
    // Unreadable storage means no preference, which is the server's default.
    return null;
  }
}

export async function savePreferredAddressId(addressId: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(KEY, addressId);
    else await SecureStore.setItemAsync(KEY, addressId);
  } catch {
    /* Losing it costs the next order starting from the account's default. */
  }
}

/*
 * The choosing rule lives next door, with nothing imported, so it can be
 * tested without a React Native runtime — this file cannot be, because
 * `expo-secure-store` and `Platform` do not exist in a test process.
 */
export { resolvePreferred } from './address-choice';
