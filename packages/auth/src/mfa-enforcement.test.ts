import { describe, expect, it } from 'vitest';
import { assertAdminPermission, needsMfaEnrolment, type Principal } from './principal.js';

/**
 * That `MFA_MANDATORY_ROLES` means mandatory.
 *
 * The list existed and was read in exactly one place — to decide whether login
 * should *offer* enrolment. The server then issued a full session either way and
 * returned `mfa_enrolment_required: true` for the portal to act on, which is a
 * request rather than a control: a client that ignored it held a fully
 * privileged SUPER_ADMIN session authenticated by a password alone.
 *
 * So the rule is asserted at the choke point every admin action passes through,
 * and asserted here.
 */

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    sessionId: 's1',
    platformRoles: [],
    restaurantRoles: {},
    driverId: null,
    profileCompleted: true,
    phoneVerified: true,
    mfaAt: null,
    mfaEnrolled: false,
    mfaRequiredByPolicy: true,
    ...overrides,
  };
}

describe('needsMfaEnrolment()', () => {
  it.each(['SUPER_ADMIN', 'FINANCE_ADMIN'] as const)('is true for an unenrolled %s', (role) => {
    expect(needsMfaEnrolment(principal({ platformRoles: [role] }))).toBe(true);
  });

  it('is false once an authenticator is enrolled', () => {
    expect(
      needsMfaEnrolment(principal({ platformRoles: ['SUPER_ADMIN'], mfaEnrolled: true })),
    ).toBe(false);
  });

  it('is false when the operator has turned the requirement off', () => {
    // `require_mfa` remains a setting. Turning it off is now a decision
    // somebody makes, rather than the default nobody noticed.
    expect(
      needsMfaEnrolment(principal({ platformRoles: ['SUPER_ADMIN'], mfaRequiredByPolicy: false })),
    ).toBe(false);
  });

  it('does not apply to a customer, driver or restaurant member', () => {
    // The setting governs platform roles. A courier has no authenticator and
    // does not need one to deliver food.
    expect(needsMfaEnrolment(principal({ platformRoles: [], driverId: 'd1' }))).toBe(false);
    expect(needsMfaEnrolment(principal({ restaurantRoles: { r1: ['OWNER'] } }))).toBe(false);
  });
});

describe('assertAdminPermission() with enrolment enforced', () => {
  it('refuses every admin action for an unenrolled mandatory role', () => {
    const admin = principal({ platformRoles: ['SUPER_ADMIN'] });

    // Not a sensitive action — an ordinary read. The point is that *nothing*
    // is available, not merely the dangerous things.
    expect(() => assertAdminPermission(admin, 'order.read.global')).toThrow(/MFA_REQUIRED/);
  });

  it('reports why, so the portal can route to enrolment rather than guess', () => {
    const admin = principal({ platformRoles: ['SUPER_ADMIN'] });

    try {
      assertAdminPermission(admin, 'order.read.global');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { details?: Record<string, unknown> }).details).toMatchObject({
        reason: 'MFA_ENROLMENT_REQUIRED',
      });
    }
  });

  it('allows an enrolled admin through', () => {
    const admin = principal({ platformRoles: ['SUPER_ADMIN'], mfaEnrolled: true });
    expect(() => assertAdminPermission(admin, 'order.read.global')).not.toThrow();
  });

  it('still demands a fresh challenge for a sensitive action', () => {
    /*
     * Enrolment and freshness are different questions. An admin who enrolled a
     * year ago may read an order; voiding a settlement needs a code entered in
     * the last few minutes.
     */
    const admin = principal({ platformRoles: ['SUPER_ADMIN'], mfaEnrolled: true, mfaAt: null });
    expect(() => assertAdminPermission(admin, 'finance.settlement.void')).toThrow(
      /REAUTHENTICATION_REQUIRED/,
    );
  });

  it('checks the role before the enrolment, so a stranger is told FORBIDDEN', () => {
    // Leaking "you need MFA" to somebody with no admin role at all would
    // confirm that the permission exists and that they are close to it.
    const nobody = principal({ platformRoles: [] });
    expect(() => assertAdminPermission(nobody, 'order.read.global')).toThrow(/FORBIDDEN/);
  });
});
