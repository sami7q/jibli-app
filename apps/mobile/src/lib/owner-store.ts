import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Which shop this device was last working on.
 *
 * A grocer who manages two branches should not re-pick on every launch, and the
 * choice is not a fact about the account — the same person on a second phone may
 * reasonably be standing in the other branch. So it is local, like the
 * notification read marker, and for the same reason: syncing it would mean a
 * column, a migration and an endpoint to record which aisle somebody is in.
 *
 * It grants nothing. The id becomes `X-Restaurant-Id`, which the server treats
 * as a selector among shops the session already proves membership of — a
 * tampered value earns TENANT_MISMATCH, not access.
 */

const KEY = 'jibli.owner.selectedShop';

/**
 * `expo-secure-store` ships `export default {}` for web — calling it there
 * throws — so the browser preview falls back to `localStorage`, exactly as
 * `secure-session` does. Nothing here is secret; it is a uuid the server
 * re-checks on every request.
 */
const isWeb = Platform.OS === 'web';

export async function loadSelectedShop(): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // Blocked storage means "no preference", which falls back to the first
    // shop — a worse guess than the remembered one, never a broken screen.
    return null;
  }
}

export async function rememberSelectedShop(shopId: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(KEY, shopId);
    else await SecureStore.setItemAsync(KEY, shopId);
  } catch {
    /* Losing it costs one extra tap on the next launch. */
  }
}

/**
 * The aisle the last product was filed under.
 *
 * Somebody stocking a shelf adds eight things from one category in a row, and
 * re-picking it eight times is most of the minute the form is trying to save.
 * Local for the same reason the shop choice is: it is a fact about what this
 * person is doing right now, not about the account.
 */
const LAST_CATEGORY = 'jibli.owner.lastCategory';

export async function lastCategory(): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(LAST_CATEGORY) ?? null;
    return await SecureStore.getItemAsync(LAST_CATEGORY);
  } catch {
    return null;
  }
}

export async function rememberLastCategory(categoryId: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(LAST_CATEGORY, categoryId);
    else await SecureStore.setItemAsync(LAST_CATEGORY, categoryId);
  } catch {
    /* Losing it costs one tap on the next product. */
  }
}
