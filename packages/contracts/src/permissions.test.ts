import { describe, expect, it } from 'vitest';
import { PLATFORM_ROLES } from './enums.js';
import { ADMIN_PERMISSIONS, ADMIN_ROLE_PERMISSIONS, adminPermissionsFor } from './permissions.js';

describe('review.moderate', () => {
  it('is a platform permission', () => {
    expect(ADMIN_PERMISSIONS).toContain('review.moderate');
  });

  it('is held by Super Admin, Operations and Support, and nobody else', () => {
    // Hiding a review changes what a shop is rated; every role reads
    // restaurants, so this list is deliberately short.
    const holders = PLATFORM_ROLES.filter((role) =>
      adminPermissionsFor([role]).has('review.moderate'),
    );
    expect([...holders].sort()).toEqual(['OPERATIONS_ADMIN', 'SUPER_ADMIN', 'SUPPORT_AGENT']);
  });

  it('is not implied by reading restaurants', () => {
    for (const role of [
      'FINANCE_ADMIN',
      'RESTAURANT_ONBOARDING',
      'MARKETING',
      'ANALYST',
      'AUDITOR',
    ] as const) {
      expect(ADMIN_ROLE_PERMISSIONS[role]).toContain('restaurant.read');
      expect(ADMIN_ROLE_PERMISSIONS[role]).not.toContain('review.moderate');
    }
  });
});
