import { describe, expect, it } from 'vitest';
import {
  buildTotpUri,
  fromBase32,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
  toBase32,
  verifyTotpCode,
} from './mfa.js';

describe('base32 encoding', () => {
  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xde, 0xad, 0xbe, 0xef]);
    expect(fromBase32(toBase32(original)).equals(original)).toBe(true);
  });

  it('produces only alphabet characters, unpadded', () => {
    const encoded = toBase32(Buffer.from('jibli-secret'));
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
  });

  it('tolerates lowercase, spaces and padding on decode', () => {
    const encoded = toBase32(Buffer.from([1, 2, 3, 4, 5]));
    const messy = `${encoded.toLowerCase()}  ===`;
    expect(fromBase32(messy).equals(fromBase32(encoded))).toBe(true);
  });

  it('rejects an invalid character rather than decoding garbage', () => {
    expect(() => fromBase32('ABC!DEF')).toThrow();
  });
});

describe('generateTotpSecret()', () => {
  it('produces a 160-bit secret', () => {
    expect(fromBase32(generateTotpSecret())).toHaveLength(20);
  });

  it('is different every time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe('TOTP against RFC 6238 test vectors', () => {
  // RFC 6238 Appendix B uses the ASCII secret "12345678901234567890".
  const RFC_SECRET = toBase32(Buffer.from('12345678901234567890', 'ascii'));

  it('matches the published SHA-1 vectors', () => {
    // Each entry is [unix seconds, expected 8-digit code]; we compare the low
    // 6 digits because this implementation emits 6.
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];

    for (const [seconds, expected] of vectors) {
      expect(generateTotpCode(RFC_SECRET, seconds * 1000)).toBe(expected.slice(-6));
    }
  });
});

describe('verifyTotpCode()', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it('accepts the current code', () => {
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, { atMs: now }).valid).toBe(true);
  });

  it('accepts a code one step old, for clock drift', () => {
    const code = generateTotpCode(secret, now - 30_000);
    expect(verifyTotpCode(secret, code, { atMs: now }).valid).toBe(true);
  });

  it('accepts a code one step early', () => {
    const code = generateTotpCode(secret, now + 30_000);
    expect(verifyTotpCode(secret, code, { atMs: now }).valid).toBe(true);
  });

  it('rejects a code two steps old — drift, not a wide-open window', () => {
    const code = generateTotpCode(secret, now - 90_000);
    expect(verifyTotpCode(secret, code, { atMs: now }).valid).toBe(false);
  });

  it('rejects a wrong code', () => {
    expect(verifyTotpCode(secret, '000000', { atMs: now }).valid).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyTotpCode(secret, 'abcdef', { atMs: now }).valid).toBe(false);
    expect(verifyTotpCode(secret, '12345', { atMs: now }).valid).toBe(false);
    expect(verifyTotpCode(secret, '', { atMs: now }).valid).toBe(false);
  });

  it('tolerates spaces, as typed from an authenticator app', () => {
    const code = generateTotpCode(secret, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotpCode(secret, spaced, { atMs: now }).valid).toBe(true);
  });

  it('returns the matched counter so a replay can be blocked', () => {
    const code = generateTotpCode(secret, now);
    const result = verifyTotpCode(secret, code, { atMs: now });
    expect(result.counter).toBe(Math.floor(now / 1000 / 30));
  });

  it('refuses a code that was already consumed', () => {
    const code = generateTotpCode(secret, now);
    const first = verifyTotpCode(secret, code, { atMs: now });
    expect(first.valid).toBe(true);

    // A shoulder-surfed code must not work a second time inside its window.
    const replay = verifyTotpCode(secret, code, { atMs: now, lastUsedCounter: first.counter });
    expect(replay.valid).toBe(false);
  });

  it('still accepts the next window after a consumed code', () => {
    const used = Math.floor(now / 1000 / 30);
    const nextCode = generateTotpCode(secret, now + 30_000);
    expect(
      verifyTotpCode(secret, nextCode, { atMs: now + 30_000, lastUsedCounter: used }).valid,
    ).toBe(true);
  });

  it('rejects a code from a different secret', () => {
    const other = generateTotpSecret();
    const code = generateTotpCode(other, now);
    expect(verifyTotpCode(secret, code, { atMs: now }).valid).toBe(false);
  });
});

describe('buildTotpUri()', () => {
  it('produces a scannable otpauth URI with the expected parameters', () => {
    const uri = buildTotpUri({ secretBase32: 'JBSWY3DPEHPK3PXP', accountName: 'admin@jibli.iq' });
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Jibli');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('URL-encodes the account label', () => {
    const uri = buildTotpUri({ secretBase32: 'JBSWY3DPEHPK3PXP', accountName: 'a b@jibli.iq' });
    expect(uri).not.toContain(' ');
  });
});

describe('recovery codes', () => {
  it('generates ten distinct, readable codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it('hashes consistently regardless of formatting', () => {
    const pepper = 'test-pepper';
    const hashed = hashRecoveryCode('ABCDE-12345', pepper);
    expect(hashRecoveryCode('abcde12345', pepper)).toBe(hashed);
    expect(hashRecoveryCode('ABCDE 12345', pepper)).toBe(hashed);
  });

  it('produces different hashes under different peppers', () => {
    expect(hashRecoveryCode('ABCDE-12345', 'pepper-a')).not.toBe(
      hashRecoveryCode('ABCDE-12345', 'pepper-b'),
    );
  });
});
