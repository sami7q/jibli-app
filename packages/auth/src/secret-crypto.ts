import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Reversible encryption for secrets held at rest — the TOTP seed (ADMIN-22).
 *
 * The seed was written to `users.mfa_secret_encrypted` in the clear despite the
 * column's name, so anyone with a database or backup read could generate every
 * admin's codes. This wraps it in AES-256-GCM under an environment key.
 *
 * Backward compatible on purpose. A value that does not carry the `enc:v1:`
 * marker is treated as legacy plaintext and returned as-is, so existing rows
 * keep working and re-enrolment migrates them. With no key configured the
 * functions pass the value straight through — today's behaviour — and the
 * caller logs a warning; the stored data is no less safe than it already was.
 */

const MARKER = 'enc:v1:';

/** A stable 32-byte key from whatever the operator set — any length string works. */
function deriveKey(envKey: string): Buffer {
  return createHash('sha256').update(envKey, 'utf8').digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(MARKER);
}

/** Encrypt a secret for storage. Returns plaintext unchanged when no key is set. */
export function encryptSecret(plaintext: string, envKey: string | undefined): string {
  if (!envKey) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(envKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${MARKER}${iv.toString('base64')}.${ciphertext.toString('base64')}.${tag.toString('base64')}`;
}

/**
 * Decrypt a stored secret. A legacy plaintext value (no marker) is returned
 * as-is; an encrypted value with no key configured throws, because silently
 * returning ciphertext would make every code fail in a way nobody could debug.
 */
export function decryptSecret(stored: string, envKey: string | undefined): string {
  if (!isEncryptedSecret(stored)) return stored;
  if (!envKey) {
    throw new Error('MFA secret is encrypted but MFA_SECRET_ENC_KEY is not set');
  }
  const [ivB64, ctB64, tagB64] = stored.slice(MARKER.length).split('.');
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error('Malformed encrypted MFA secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(envKey), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
