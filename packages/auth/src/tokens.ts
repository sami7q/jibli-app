import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AppMode, PlatformRole, RestaurantRole } from '@jibli/contracts';

/**
 * Session tokens and one-way hashing (plan §77).
 *
 * Access tokens are short-lived and stateless. Refresh tokens are opaque,
 * rotated on every use, and stored only as a hash — a database dump must not
 * let an attacker mint sessions.
 */

export interface AccessTokenClaims extends JWTPayload {
  readonly sub: string;
  /** Session this token belongs to, so revocation can invalidate it. */
  readonly sid: string;
  readonly platformRoles: PlatformRole[];
  /** Restaurant memberships resolved at issue time: restaurantId → roles. */
  readonly restaurantRoles: Record<string, RestaurantRole[]>;
  readonly driverId: string | null;
  readonly modes: AppMode[];
  readonly profileCompleted: boolean;
  /** Last MFA challenge, for step-up checks on sensitive actions (plan §88). */
  readonly mfaAt: number | null;
}

export interface TokenConfig {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly issuer?: string;
  readonly audience?: string;
}

const DEFAULT_ISSUER = 'jibli';
const DEFAULT_AUDIENCE = 'jibli-clients';

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>,
  config: TokenConfig,
): Promise<string> {
  return new SignJWT(claims as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(config.issuer ?? DEFAULT_ISSUER)
    .setAudience(config.audience ?? DEFAULT_AUDIENCE)
    .setExpirationTime(`${config.accessTtlSeconds}s`)
    .sign(secretKey(config.accessSecret));
}

export async function verifyAccessToken(
  token: string,
  config: TokenConfig,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretKey(config.accessSecret), {
    issuer: config.issuer ?? DEFAULT_ISSUER,
    audience: config.audience ?? DEFAULT_AUDIENCE,
    algorithms: ['HS256'],
  });
  return payload as AccessTokenClaims;
}

/**
 * Hash a refresh token for storage.
 *
 * SHA-256 rather than a password KDF is correct here: the token is 256 bits of
 * CSPRNG output, so there is no low-entropy guess for an attacker to iterate on,
 * and lookup must stay fast on every refresh.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hash an OTP code or delivery PIN with a server-side pepper.
 *
 * These are 4-6 digit secrets — trivially brute-forced from a hash alone. The
 * pepper lives in the secret manager, never in the database, so a database-only
 * compromise does not reveal them. Short expiry and attempt limits do the rest.
 */
export function hashShortCode(code: string, pepper: string, salt: string): string {
  return createHmac('sha256', pepper).update(`${salt}:${code}`).digest('hex');
}

/** Constant-time comparison, so a timing side channel cannot leak a code. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Stable hash of a request body, used to detect idempotency-key reuse (plan §28). */
export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

/** Deterministic JSON: key order must not change the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
