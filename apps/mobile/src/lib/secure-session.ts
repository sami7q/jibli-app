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

/**
 * Update only the tokens after a refresh rotation, leaving the identity intact.
 */
export async function updateTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken, OPTIONS),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, OPTIONS),
  ]);
}
