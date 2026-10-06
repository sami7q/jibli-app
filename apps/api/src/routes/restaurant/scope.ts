import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { resolveRestaurantScope, type Principal } from '@jibli/auth';
import { requirePrincipal } from '../../plugins/auth.js';

/**
 * Restaurant scope resolution (plan §63).
 *
 * "Every restaurant request resolves membership from authenticated session.
 * Submitted `restaurant_id` is never accepted as proof of access."
 *
 * The header is a *selector* among restaurants the session already proves
 * membership of — it grants nothing. `resolveRestaurantScope` throws
 * TENANT_MISMATCH when the claim is not backed by membership, and
 * VALIDATION_FAILED when a user belongs to several restaurants and named none.
 */

const headerSchema = z.string().uuid().optional();

export interface RestaurantScope {
  readonly principal: Principal;
  readonly restaurantId: string;
}

export function restaurantScope(request: FastifyRequest): RestaurantScope {
  const principal = requirePrincipal(request);
  const claimed = headerSchema.parse(request.headers['x-restaurant-id'] ?? undefined);
  return { principal, restaurantId: resolveRestaurantScope(principal, claimed ?? null) };
}

/**
 * Whether a principal holds a permission, without throwing.
 *
 * Used to shape a response — for example hiding cost prices from a Cashier —
 * rather than to gate an action. Gating always uses the asserting form so a
 * missing permission fails loudly.
 */
export function hasPermission(check: () => void): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}
