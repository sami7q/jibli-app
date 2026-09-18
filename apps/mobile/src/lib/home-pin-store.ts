import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Whether the customer has waved away the offer to pin their home.
 *
 * Local, like the notification read marker and the owner's shop choice, and for
 * the same reason: it is a fact about a card somebody closed on this phone, not
 * about the account. Syncing it would mean a column and a migration to record
 * that a suggestion went away.
 *
 * Dismissing is permanent by design. A card that comes back is a card that has
 * stopped being an offer — and the address form is still one tap away in
 * checkout for anyone who changes their mind.
 */

const KEY = 'jibli.home.pinDismissed';

/**
 * `expo-secure-store` ships `export default {}` for web — calling it there
 * throws — so the browser preview falls back to `localStorage`, exactly as
 * `secure-session` does. Nothing here is secret; it is one flag.
 */
const isWeb = Platform.OS === 'web';

export async function pinHomeDismissed(): Promise<boolean> {
  try {
    const raw = isWeb
      ? (globalThis.localStorage?.getItem(KEY) ?? null)
      : await SecureStore.getItemAsync(KEY);
    return raw === '1';
  } catch {
    /*
     * Unreadable storage reads as "not dismissed", which errs towards showing
     * the card. An offer somebody has already declined reappearing once is a
     * smaller wrong than a courier who never gets the pin.
     */
    return false;
  }
}

export async function dismissPinHome(): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(KEY, '1');
    else await SecureStore.setItemAsync(KEY, '1');
  } catch {
    /* Losing it costs the card appearing once more. */
  }
}
