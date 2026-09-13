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

export interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly userId: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken, OPTIONS),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken, OPTIONS),
    SecureStore.setItemAsync(USER_ID_KEY, session.userId, OPTIONS),
  ]);
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [accessToken, refreshToken, userId] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY, OPTIONS),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY, OPTIONS),
      SecureStore.getItemAsync(USER_ID_KEY, OPTIONS),
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
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY, OPTIONS),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, OPTIONS),
    SecureStore.deleteItemAsync(USER_ID_KEY, OPTIONS),
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
    await SecureStore.setItemAsync(GUEST_KEY, '1', OPTIONS);
  } catch {
    // A choice we could not persist still holds for this launch.
  }
}

export async function loadGuestChoice(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(GUEST_KEY, OPTIONS)) === '1';
  } catch {
    return false;
  }
}

export async function forgetGuestChoice(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(GUEST_KEY, OPTIONS);
  } catch {
    // Nothing to do: the next read fails closed to "not a guest".
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
    await SecureStore.setItemAsync(AREA_KEY, serialized, OPTIONS);
  } catch {
    // The choice still holds for this launch.
  }
}

export async function loadArea(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AREA_KEY, OPTIONS);
  } catch {
    return null;
  }
}

/**
 * Update only the tokens after a refresh rotation, leaving the identity intact.
 */
export async function updateTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken, OPTIONS),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, OPTIONS),
  ]);
}
