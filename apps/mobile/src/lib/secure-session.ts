import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Session storage on device (plan §79).
 *
 * "Sensitive session material belongs in Keychain/Keystore-backed storage.
 * AsyncStorage can hold non-sensitive cached UI state but not bearer tokens,
 * OTPs, passwords, private keys, or Delivery PIN values."
 *
 * expo-secure-store is backed by the iOS Keychain and Android Keystore, so
 * tokens are encrypted at rest and are not readable from a device backup or by
 * another app.
 */

const ACCESS_TOKEN_KEY = 'jibli.access_token';
const REFRESH_TOKEN_KEY = 'jibli.refresh_token';
const USER_ID_KEY = 'jibli.user_id';

/**
 * Require the device to be unlocked. Tokens are useless to an attacker holding
 * a locked phone, and this also excludes them from iCloud/Google backups.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * The browser has no keystore.
 *
 * `expo-secure-store` ships an empty object for web — calling `setItemAsync`
 * there throws "not a function", which surfaced as an unexplained «حدث خطأ غير
 * متوقع» the moment anyone tried to sign in from `expo start --web`. The
 * preview could show every screen and complete nothing.
 *
 * `localStorage` is the only thing a browser offers, and it is genuinely worse:
 * readable by any script on the origin, and not encrypted at rest. That is
 * acceptable for exactly one thing — a developer reviewing screens on their own
 * machine — and for nothing else, which is why this is a web-only branch and
 * the app is never shipped to the web.
 */
const isWeb = Platform.OS === 'web';

const webStore = {
  set(key: string, value: string): void {
    globalThis.localStorage?.setItem(key, value);
  },
  get(key: string): string | null {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  remove(key: string): void {
    globalThis.localStorage?.removeItem(key);
  },
};

export async function putSecure(key: string, value: string): Promise<void> {
  if (isWeb) return void webStore.set(key, value);
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

export async function readSecure(key: string): Promise<string | null> {
  if (isWeb) return webStore.get(key);
  return SecureStore.getItemAsync(key, OPTIONS);
}

export async function dropSecure(key: string): Promise<void> {
  if (isWeb) return void webStore.remove(key);
  await SecureStore.deleteItemAsync(key, OPTIONS);
}

export interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly userId: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    putSecure(ACCESS_TOKEN_KEY, session.accessToken),
    putSecure(REFRESH_TOKEN_KEY, session.refreshToken),
    putSecure(USER_ID_KEY, session.userId),
  ]);
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [accessToken, refreshToken, userId] = await Promise.all([
      readSecure(ACCESS_TOKEN_KEY),
      readSecure(REFRESH_TOKEN_KEY),
      readSecure(USER_ID_KEY),
    ]);

    if (!accessToken || !refreshToken || !userId) return null;
    return { accessToken, refreshToken, userId };
  } catch {
    // A keystore read can fail after an OS restore or a biometric change.
    // Treating it as "signed out" is correct: the user re-authenticates.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    dropSecure(ACCESS_TOKEN_KEY),
    dropSecure(REFRESH_TOKEN_KEY),
    dropSecure(USER_ID_KEY),
  ]);
}

// ── The guest choice ────────────────────────────────────────────────────────

const GUEST_KEY = 'jibli.browsing_as_guest';

/**
 * Whether the customer chose «تصفح كضيف» on the welcome screen.
 *
 * Not sensitive — it is one boolean about a choice, not credentials — but it
 * lives here rather than pulling in AsyncStorage for a single flag. Keeping it
 * at all is the point: without it the welcome screen reappears on every
 * launch, and a guest who has to re-answer the same question every time is
 * being asked to sign in with extra steps.
 */
export async function rememberGuestChoice(): Promise<void> {
  try {
    await putSecure(GUEST_KEY, '1');
  } catch {
    // A choice we could not persist still holds for this launch.
  }
}

export async function loadGuestChoice(): Promise<boolean> {
  try {
    return (await readSecure(GUEST_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function forgetGuestChoice(): Promise<void> {
  try {
    await dropSecure(GUEST_KEY);
  } catch {
    // Nothing to do: the next read fails closed to "not a guest".
  }
}

// ── The parked account ──────────────────────────────────────────────────────

const PARKED_KEY = 'jibli.parked_session';

/** Which of the two the parked account is, for the row that offers it. */
export type ParkedKind = 'customer' | 'shop';

export interface ParkedSession extends StoredSession {
  readonly kind: ParkedKind;
}

/**
 * One person, two accounts: the customer they are, and the shop they run.
 *
 * A shop's portal login is a separate user, so signing into it used to cost
 * the customer account — and signing back in as a customer cost the shop's
 * password. The account not in use is kept here, whole, so switching is a
 * swap rather than a sign-in. The keystore holds it exactly as it holds
 * the active one; nothing about it is less sensitive for being parked.
 */
export async function parkSession(session: ParkedSession): Promise<void> {
  await putSecure(PARKED_KEY, JSON.stringify(session));
}

export async function loadParkedSession(): Promise<ParkedSession | null> {
  try {
    const raw = await readSecure(PARKED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ParkedSession>;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.userId !== 'string' ||
      (parsed.kind !== 'customer' && parsed.kind !== 'shop')
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      userId: parsed.userId,
      kind: parsed.kind,
    };
  } catch {
    return null;
  }
}

export async function clearParkedSession(): Promise<void> {
  try {
    await dropSecure(PARKED_KEY);
  } catch {
    /* Nothing to do: a parked account that cannot be read is not offered. */
  }
}

// ── The chosen area ─────────────────────────────────────────────────────────

const AREA_KEY = 'jibli.delivery_area';

/**
 * Where the customer is ordering to.
 *
 * A signed-in customer's area comes from their profile and this is only a
 * cache of it. A guest has no profile, so this *is* their area — and without
 * it the home screen has no city id, which means no restaurants at all.
 */
export async function saveArea(serialized: string): Promise<void> {
  try {
    await putSecure(AREA_KEY, serialized);
  } catch {
    // The choice still holds for this launch.
  }
}

export async function loadArea(): Promise<string | null> {
  try {
    return await readSecure(AREA_KEY);
  } catch {
    return null;
  }
}

/**
 * Update only the tokens after a refresh rotation, leaving the identity intact.
 */
export async function updateTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    putSecure(ACCESS_TOKEN_KEY, accessToken),
    putSecure(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}
