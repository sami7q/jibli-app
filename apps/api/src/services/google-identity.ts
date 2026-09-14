import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError, ERROR_CODES } from '@jibli/contracts';

/**
 * Verifying a Google ID token.
 *
 * The app signs in with Google on the device and sends the resulting ID token
 * here. It is a JWT signed by Google, so the server can check it without
 * trusting the client at all — which is the whole point: a client that says
 * "I am ali@example.com" proves nothing, a token signed by Google proves it.
 *
 * Verified locally against Google's published keys rather than by calling
 * `tokeninfo`. Local verification adds no network round trip to a sign-in, and
 * the key set is fetched once and cached by `jose` until Google rotates it.
 *
 * Three things are checked beyond the signature, and each one is a real attack
 * if skipped:
 *
 *   - the **issuer**, or any JWT at all would do;
 *   - the **audience**, or a token minted for a *different* application would
 *     sign its holder into this one — the classic confused-deputy;
 *   - **expiry**, which `jose` enforces, so a token captured yesterday is
 *     worthless today.
 */

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Cached across requests. `createRemoteJWKSet` refetches on its own when it
 * sees a key id it does not know, so rotation needs no restart.
 */
let keySet: ReturnType<typeof createRemoteJWKSet> | null = null;

function googleKeys(): ReturnType<typeof createRemoteJWKSet> {
  keySet ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return keySet;
}

export interface GoogleIdentity {
  /** Google's stable subject id. The thing to store; never the email. */
  readonly subject: string;
  readonly email: string | null;
  /** Google's own verification of the address, not ours. */
  readonly emailVerified: boolean;
  readonly name: string | null;
}

/**
 * @param audiences Every client id that may sign into this backend — iOS,
 * Android and web are three different ids for the same application, and all
 * three are legitimate audiences here.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audiences: readonly string[],
): Promise<GoogleIdentity> {
  if (audiences.length === 0) {
    // Refusing is the only safe answer: with no audience to check against,
    // any Google token from any application would be accepted.
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, {
      messageAr: 'تسجيل الدخول عبر جوجل غير مُهيأ على الخادم.',
    });
  }

  try {
    const { payload } = await jwtVerify(idToken, googleKeys(), {
      issuer: GOOGLE_ISSUERS,
      audience: [...audiences],
    });

    const subject = payload.sub;
    if (!subject) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, {
        messageAr: 'تعذّر التحقق من حساب جوجل.',
      });
    }

    const email = typeof payload.email === 'string' ? payload.email : null;

    return {
      subject,
      email,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch (error) {
    if (AppError.is(error)) throw error;

    /*
     * Every failure looks the same to the caller.
     *
     * Expired, wrong audience, bad signature — telling them which would help
     * someone probing for a token this backend will accept, and none of the
     * distinctions change what the app does next.
     */
    throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, {
      messageAr: 'تعذّر التحقق من حساب جوجل. حاول مرة أخرى.',
      cause: error,
    });
  }
}
