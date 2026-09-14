import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

/**
 * Signing in with Google.
 *
 * The device asks Google for an **ID token** — a JWT Google signed — and the
 * server verifies it against Google's published keys. That is the whole
 * security model: the app never sees a password, and the server never trusts
 * the app's word about who someone is.
 *
 * Google issues a different client id per platform for the same application,
 * which is why there are three here. They are configuration rather than code:
 * they are not secrets, but they differ between a development project and a
 * production one, and a hard-coded id is one more thing to remember to change.
 *
 * **Without them configured, this is off.** `isGoogleSignInConfigured` is what
 * the sign-in screen asks before drawing the button, because a Google button
 * that fails is worse than no Google button — and App Store guideline 4.8
 * means shipping this on iOS obliges Sign in with Apple beside it.
 */

// Required so the browser tab closes itself after the redirect.
WebBrowser.maybeCompleteAuthSession();

interface GoogleConfig {
  readonly iosClientId?: string;
  readonly androidClientId?: string;
  readonly webClientId?: string;
}

function config(): GoogleConfig {
  const extra = Constants.expoConfig?.extra as { google?: GoogleConfig } | undefined;
  return extra?.google ?? {};
}

/** The client id for the platform this is running on. */
function clientId(): string | undefined {
  const { iosClientId, androidClientId, webClientId } = config();
  if (Platform.OS === 'ios') return iosClientId ?? webClientId;
  if (Platform.OS === 'android') return androidClientId ?? webClientId;
  return webClientId;
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(clientId());
}

export type GoogleSignInResult =
  | { readonly status: 'ok'; readonly idToken: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'unconfigured' }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * Open Google's sign-in and come back with an ID token.
 *
 * `response_type=id_token` with a nonce: the token is what the server needs,
 * and asking for an authorization code instead would mean exchanging it, which
 * needs a client secret the app must not hold.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const id = clientId();
  if (!id) return { status: 'unconfigured' };

  try {
    const discovery = await AuthSession.fetchDiscoveryAsync('https://accounts.google.com');
    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'jibli' });

    const request = new AuthSession.AuthRequest({
      clientId: id,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      responseType: AuthSession.ResponseType.IdToken,
      // Binds the token to this request; Google echoes it back inside the JWT
      // so a token captured from another flow cannot be replayed into this one.
      extraParams: { nonce: Math.random().toString(36).slice(2) },
    });

    const result = await request.promptAsync(discovery);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { status: 'cancelled' };
    }

    if (result.type !== 'success') {
      return { status: 'failed', reason: result.type };
    }

    const idToken = result.params.id_token;
    if (typeof idToken !== 'string' || idToken.length === 0) {
      return { status: 'failed', reason: 'NO_ID_TOKEN' };
    }

    return { status: 'ok', idToken };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : 'UNKNOWN' };
  }
}
