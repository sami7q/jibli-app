import {
  AppError,
  ERROR_CODES,
  adminPermissionsFor,
  MFA_MANDATORY_ROLES,
  requiresReauthentication,
  restaurantPermissionsFor,
  type AdminPermission,
  type PlatformRole,
  type RestaurantPermission,
  type RestaurantRole,
} from '@jibli/contracts';

/**
 * The authenticated principal and the guards that act on it.
 *
 * Plan §63: "Every restaurant request resolves membership from authenticated
 * session. Submitted `restaurant_id` is never accepted as proof of access."
 * That rule is enforced here, not in individual route handlers.
 */

export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly platformRoles: readonly PlatformRole[];
  /** restaurantId → roles held there. The only source of restaurant authority. */
  readonly restaurantRoles: Readonly<Record<string, RestaurantRole[]>>;
  readonly driverId: string | null;
  readonly profileCompleted: boolean;
  /**
   * Whether a phone number has been proved for this account.
   *
   * False for a fresh Google sign-in. Browsing is fine without one; placing an
   * order is not, because an order needs a number a driver can call.
   */
  readonly phoneVerified: boolean;
  /** When the principal last passed an MFA challenge, if ever. */
  readonly mfaAt: Date | null;
  /**
   * Whether an authenticator is enrolled on this account at all.
   *
   * Distinct from `mfaAt`, which is about *this session*: an admin who enrolled
   * a year ago and has not been challenged today has `mfaEnrolled: true` and
   * `mfaAt: null`. The first decides whether they may act as an admin; the
   * second whether they may perform a sensitive action right now.
   */
  readonly mfaEnrolled: boolean;
  /**
   * Whether the platform is currently demanding enrolment of the roles that
   * require it.
   *
   * Read from `require_mfa` per request rather than baked into the token, so
   * turning the requirement on takes effect immediately for sessions that are
   * already open — the same rule the rest of this file follows for roles.
   */
  readonly mfaRequiredByPolicy: boolean;
}

/** How recently MFA must have happened to authorise a sensitive action. */
export const MFA_FRESHNESS_SECONDS = 15 * 60;

export function isPlatformStaff(principal: Principal): boolean {
  return principal.platformRoles.length > 0;
}

export function isDriver(principal: Principal): boolean {
  return principal.driverId !== null;
}

/** Restaurants this principal is a member of. */
export function memberRestaurantIds(principal: Principal): string[] {
  return Object.keys(principal.restaurantRoles);
}

// ── Platform authorization ───────────────────────────────────────────────────

export function hasAdminPermission(principal: Principal, permission: AdminPermission): boolean {
  return adminPermissionsFor(principal.platformRoles).has(permission);
}

/**
 * Whether this principal holds a role the plan makes MFA mandatory for, and has
 * not enrolled one.
 *
 * `MFA_MANDATORY_ROLES` existed and was read in exactly one place — to decide
 * whether to *offer* enrolment at login — so a SUPER_ADMIN could decline and
 * carry on with a password alone, reaching customer phone numbers, settlement
 * voids and commission changes. The list said "mandatory" and nothing made it so.
 */
export function needsMfaEnrolment(principal: Principal): boolean {
  if (!principal.mfaRequiredByPolicy) return false;
  if (principal.mfaEnrolled) return false;
  return principal.platformRoles.some((role) => MFA_MANDATORY_ROLES.includes(role));
}

export function assertAdminPermission(principal: Principal, permission: AdminPermission): void {
  if (!hasAdminPermission(principal, permission)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      details: { requiredPermission: permission },
    });
  }

  /*
   * Enrolment is enforced here rather than at login, because login is not where
   * it can be enforced: the server issues a session and returns
   * `mfa_enrolment_required` for the portal to act on — which is a request, not
   * a control. A client that ignores it had a fully privileged session.
   *
   * This is the choke point every admin action already passes through, so an
   * unenrolled mandatory role can authenticate and manage its own MFA, and can
   * do nothing else. The routes under /auth/mfa deliberately do not call this.
   */
  if (needsMfaEnrolment(principal)) {
    throw new AppError(ERROR_CODES.MFA_REQUIRED, {
      details: { reason: 'MFA_ENROLMENT_REQUIRED', requiredPermission: permission },
    });
  }

  // Sensitive actions additionally demand a fresh MFA challenge (plan §88).
  if (requiresReauthentication(permission) && !hasFreshMfa(principal)) {
    throw new AppError(ERROR_CODES.REAUTHENTICATION_REQUIRED, {
      details: { requiredPermission: permission },
    });
  }
}

export function hasFreshMfa(principal: Principal, now: Date = new Date()): boolean {
  if (!principal.mfaAt) return false;
  const ageSeconds = (now.getTime() - principal.mfaAt.getTime()) / 1000;
  return ageSeconds >= 0 && ageSeconds <= MFA_FRESHNESS_SECONDS;
}

// ── Restaurant (tenant) authorization ────────────────────────────────────────

export function rolesInRestaurant(principal: Principal, restaurantId: string): RestaurantRole[] {
  return principal.restaurantRoles[restaurantId] ?? [];
}

export function isMemberOf(principal: Principal, restaurantId: string): boolean {
  return rolesInRestaurant(principal, restaurantId).length > 0;
}

export function hasRestaurantPermission(
  principal: Principal,
  restaurantId: string,
  permission: RestaurantPermission,
): boolean {
  const roles = rolesInRestaurant(principal, restaurantId);
  if (roles.length === 0) return false;
  return restaurantPermissionsFor(roles).has(permission);
}

/**
 * The tenant-isolation gate.
 *
 * A non-member gets TENANT_MISMATCH rather than FORBIDDEN so support can tell
 * "wrong restaurant" apart from "right restaurant, insufficient role" — and so
 * the security tests in plan §154 can assert on the distinction.
 */
export function assertRestaurantPermission(
  principal: Principal,
  restaurantId: string,
  permission: RestaurantPermission,
): void {
  if (!isMemberOf(principal, restaurantId)) {
    throw new AppError(ERROR_CODES.TENANT_MISMATCH, {
      details: { restaurantId, requiredPermission: permission },
    });
  }
  if (!hasRestaurantPermission(principal, restaurantId, permission)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      details: { restaurantId, requiredPermission: permission },
    });
  }
}

/**
 * Resolve the restaurant a portal request operates on.
 *
 * The caller passes whatever the client claimed; this function only returns it
 * if the session actually carries membership. When the client claims nothing and
 * the user belongs to exactly one restaurant, that one is used.
 */
export function resolveRestaurantScope(principal: Principal, claimedId?: string | null): string {
  const memberships = memberRestaurantIds(principal);
  if (memberships.length === 0) {
    throw new AppError(ERROR_CODES.FORBIDDEN, { details: { reason: 'NO_RESTAURANT_MEMBERSHIP' } });
  }
  if (!claimedId) {
    if (memberships.length === 1) return memberships[0] as string;
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { field: 'restaurantId', reason: 'AMBIGUOUS_RESTAURANT_SCOPE' },
    });
  }
  if (!memberships.includes(claimedId)) {
    throw new AppError(ERROR_CODES.TENANT_MISMATCH, { details: { restaurantId: claimedId } });
  }
  return claimedId;
}

// ── Driver authorization ─────────────────────────────────────────────────────

export function assertDriver(principal: Principal): string {
  if (!principal.driverId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, { details: { reason: 'NOT_A_DRIVER' } });
  }
  return principal.driverId;
}

/**
 * A driver may only act on their own assignment. Plan §71: "A driver who was
 * removed or reassigned cannot continue using a previously opened screen to
 * mutate the task."
 */
export function assertOwnsAssignment(principal: Principal, assignmentDriverId: string): void {
  const driverId = assertDriver(principal);
  if (driverId !== assignmentDriverId) {
    throw new AppError(ERROR_CODES.DELIVERY_NOT_ASSIGNED_TO_DRIVER, {
      details: { driverId },
    });
  }
}

// ── Customer guards ──────────────────────────────────────────────────────────

/** Ordering requires a completed profile (plan §11, §27). */
export function assertProfileComplete(principal: Principal): void {
  if (!principal.profileCompleted) {
    throw new AppError(ERROR_CODES.PROFILE_INCOMPLETE);
  }
}

/**
 * An order needs a number a driver can call.
 *
 * Google proves an identity, not a phone, so an account can be signed in and
 * still unable to order. Enforced here rather than trusted to the app: the
 * client routes to phone verification as a courtesy, the server refuses as a
 * rule.
 */
export function assertPhoneVerified(principal: Principal): void {
  if (!principal.phoneVerified) {
    throw new AppError(ERROR_CODES.PROFILE_INCOMPLETE, {
      messageAr: 'أضف رقم هاتفك وفعّله لإتمام الطلب.',
      details: { reason: 'PHONE_NOT_VERIFIED' },
    });
  }
}

/** A customer may only read their own resources. */
export function assertOwnsResource(principal: Principal, ownerUserId: string): void {
  if (principal.userId !== ownerUserId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, { details: { reason: 'NOT_RESOURCE_OWNER' } });
  }
}
