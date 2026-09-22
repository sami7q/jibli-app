import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingCredentials,
  holdPendingCredentials,
  readPendingCredentials,
} from './pending-credentials';

/**
 * The rules around the one place a plaintext password lives on the device.
 *
 * Registration and password reset are each two requests with a screen between
 * them, so the password has to survive that gap somewhere. This module is that
 * somewhere, and the two properties worth asserting are the ones that would
 * fail silently: a hold must not be readable by the wrong flow, and it must not
 * be readable for a different number.
 *
 * Both matter because the OTP screen reads whatever is held and sends it. A
 * stale hold from an abandoned signup, read by a reset for another number,
 * would set a stranger's chosen password on an account they proved nothing
 * about.
 */

afterEach(() => clearPendingCredentials());

describe('readPendingCredentials()', () => {
  it('returns what was held, for the right flow and number', () => {
    holdPendingCredentials({
      purpose: 'REGISTER',
      phone: '+9647712345678',
      password: 'correct-horse-7',
      fullName: 'سامي',
    });

    expect(readPendingCredentials('REGISTER', '+9647712345678')).toMatchObject({
      password: 'correct-horse-7',
      fullName: 'سامي',
    });
  });

  it('refuses a hold made for a different number', () => {
    /*
     * The case this exists for: a signup abandoned halfway, then a reset
     * started for another number. Reading the stale hold would set the
     * abandoned password on an account the customer never proved.
     */
    holdPendingCredentials({
      purpose: 'REGISTER',
      phone: '+9647712345678',
      password: 'correct-horse-7',
    });

    expect(readPendingCredentials('REGISTER', '+9647801112233')).toBeNull();
  });

  it('refuses a registration hold read as a reset', () => {
    holdPendingCredentials({
      purpose: 'REGISTER',
      phone: '+9647712345678',
      password: 'correct-horse-7',
    });

    expect(readPendingCredentials('RESET', '+9647712345678')).toBeNull();
  });

  it('holds one at a time, so a restarted flow replaces the last', () => {
    holdPendingCredentials({ purpose: 'REGISTER', phone: '+9647712345678', password: 'first-1' });
    holdPendingCredentials({ purpose: 'RESET', phone: '+9647801112233', password: 'second-2' });

    expect(readPendingCredentials('REGISTER', '+9647712345678')).toBeNull();
    expect(readPendingCredentials('RESET', '+9647801112233')).toMatchObject({
      password: 'second-2',
    });
  });

  it('is empty once cleared, so a finished flow leaves no password behind', () => {
    holdPendingCredentials({ purpose: 'RESET', phone: '+9647712345678', password: 'secret-9' });
    clearPendingCredentials();

    expect(readPendingCredentials('RESET', '+9647712345678')).toBeNull();
  });

  it('is empty before anything is held', () => {
    expect(readPendingCredentials('REGISTER', '+9647712345678')).toBeNull();
  });
});
