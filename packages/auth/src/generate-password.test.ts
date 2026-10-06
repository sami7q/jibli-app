import { describe, expect, it } from 'vitest';
import { generatePortalPassword } from './generate-password.js';
import { ADMIN_PASSWORD_MIN_LENGTH, checkPasswordPolicy } from './password.js';

/**
 * The bug this file exists to prevent: the generator prefixed every password
 * with `Jibli-`, which `checkPasswordPolicy` rejects as a product-name pattern.
 * Every attempt to create a restaurant account would have failed with an
 * internal error, and nothing in the type system had anything to say about it.
 *
 * A generator and the policy that judges it have to be tested against each
 * other, not separately.
 */
describe('generatePortalPassword()', () => {
  it('always satisfies the policy it will be judged by', () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generatePortalPassword();
      const policy = checkPasswordPolicy(password);
      expect(policy.problems).toEqual([]);
    }
  });

  it('satisfies the stricter admin minimum when asked', () => {
    for (let i = 0; i < 100; i += 1) {
      const password = generatePortalPassword({ minLength: ADMIN_PASSWORD_MIN_LENGTH });
      expect(checkPasswordPolicy(password, { minLength: ADMIN_PASSWORD_MIN_LENGTH }).ok).toBe(true);
    }
  });

  it('never contains the username it was generated for', () => {
    for (let i = 0; i < 100; i += 1) {
      const username = 'mataam-baghdad';
      const password = generatePortalPassword({ username });
      expect(password.toLowerCase()).not.toContain(username);
      expect(checkPasswordPolicy(password, { username }).ok).toBe(true);
    }
  });

  it('avoids characters that are ambiguous when read aloud', () => {
    /*
     * These are delivered by reading them down a phone. O/0 and l/1/I are the
     * pairs that come back mistyped, and a mistyped password looks to the
     * restaurant exactly like a wrong one.
     */
    for (let i = 0; i < 100; i += 1) {
      expect(generatePortalPassword()).not.toMatch(/[O0lI1aeiou]/);
    }
  });

  it('is grouped so it can be dictated', () => {
    const password = generatePortalPassword();
    const groups = password.split('-');
    expect(groups).toHaveLength(5);
    for (const g of groups) expect(g).toHaveLength(4);
    // Last group is digits, so the digit requirement is structural, not luck.
    expect(groups[4]).toMatch(/^\d{4}$/);
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generatePortalPassword());
    expect(seen.size).toBe(500);
  });
});
