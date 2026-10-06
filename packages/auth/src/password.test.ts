import { describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD_MIN_LENGTH, checkPasswordPolicy, PASSWORD_MIN_LENGTH } from './password.js';

/**
 * The policy is NIST SP 800-63B shaped, so these tests pin down what it
 * deliberately does *not* require as much as what it does. Someone will
 * eventually be asked to "add a symbol requirement"; the cases below are the
 * argument against it.
 */
describe('checkPasswordPolicy()', () => {
  it('accepts a long passphrase with no symbols', () => {
    // Length is the factor that matters. Demanding punctuation on top of this
    // buys nothing and pushes people toward shorter, patterned passwords.
    expect(checkPasswordPolicy('Correct-Horse-Battery-9').ok).toBe(true);
    expect(checkPasswordPolicy('tayyib kabab baghdad 7').ok).toBe(true);
  });

  it('accepts an Arabic passphrase', () => {
    // Release 1 is Arabic-only. A letters rule that only understood Latin
    // would reject the most natural password an Iraqi owner would choose.
    expect(checkPasswordPolicy('كلمة-مرور-قوية-9').ok).toBe(true);
  });

  it('enforces length, and a higher bar for admin', () => {
    expect(checkPasswordPolicy('short1').problems).toContain('PASSWORD_TOO_SHORT');
    expect(checkPasswordPolicy('Ab3'.repeat(3).slice(0, PASSWORD_MIN_LENGTH - 1)).ok).toBe(false);

    const thirteen = 'Short-Pass-12';
    expect(checkPasswordPolicy(thirteen).ok).toBe(true);
    expect(
      checkPasswordPolicy(thirteen, { minLength: ADMIN_PASSWORD_MIN_LENGTH }).problems,
    ).toContain('PASSWORD_TOO_SHORT');
  });

  it('rejects what credential stuffing tries first', () => {
    // Each of these passes a naive length-and-digit rule.
    expect(checkPasswordPolicy('Password123456').problems).toContain('PASSWORD_TOO_COMMON');
    expect(checkPasswordPolicy('welcome123456').problems).toContain('PASSWORD_TOO_COMMON');
    expect(checkPasswordPolicy('jibli-secret-99').problems).toContain('PASSWORD_TOO_COMMON');
  });

  it('rejects a single repeated character or a plain run', () => {
    // Fourteen characters, satisfies every other rule, and is found instantly
    // by a search over "one repeated character plus a digit".
    expect(checkPasswordPolicy('aaaaaaaaaaaaa1').problems).toContain('PASSWORD_TOO_REPETITIVE');
    expect(checkPasswordPolicy('abcdefghijklmn').problems).toContain('PASSWORD_TOO_REPETITIVE');
    // A run that merely *starts* ascending is fine.
    expect(checkPasswordPolicy('abcdefghijklm1').ok).toBe(true);
  });

  it('catches a string that is one character repeated', () => {
    /*
     * Exercises the backreference specifically. It was once written with a
     * literal 0x01 instead of ``, which matched nothing — and the distinct-
     * character rule hid the failure by rejecting the same inputs for a
     * different reason.
     */
    const single = checkPasswordPolicy('kkkkkkkkkkkkkk');
    expect(single.problems).toContain('PASSWORD_TOO_REPETITIVE');
    expect(checkPasswordPolicy('9999999999999').problems).toContain('PASSWORD_TOO_REPETITIVE');
  });

  it('rejects a password containing the username', () => {
    /*
     * For a restaurant the username is derived from the name on the shopfront,
     * so this is the first guess an attacker makes once they have the login
     * name — which is public by construction.
     */
    expect(
      checkPasswordPolicy('mataam-baghdad-9', { username: 'mataam-baghdad' }).problems,
    ).toContain('PASSWORD_CONTAINS_USERNAME');

    // Case-insensitive, and unaffected by surrounding text.
    expect(
      checkPasswordPolicy('xx-MATAAM-BAGHDAD-xx9', { username: 'mataam-baghdad' }).problems,
    ).toContain('PASSWORD_CONTAINS_USERNAME');

    // A short username is not treated as a substring rule, or "ali" would
    // reject every password containing those three letters.
    expect(checkPasswordPolicy('Normal-Passphrase-1', { username: 'al' }).ok).toBe(true);
  });

  it('requires letters and a digit, and nothing more', () => {
    expect(checkPasswordPolicy('123456789012345').problems).toContain('PASSWORD_NEEDS_LETTERS');
    expect(checkPasswordPolicy('onlylettershere').problems).toContain('PASSWORD_NEEDS_DIGIT');
    // No symbol requirement: this passes.
    expect(checkPasswordPolicy('sevenbrownfoxes9').ok).toBe(true);
  });

  it('caps length so a hash is never asked to chew a megabyte', () => {
    expect(checkPasswordPolicy('a1'.repeat(200)).problems).toContain('PASSWORD_TOO_LONG');
  });
});
