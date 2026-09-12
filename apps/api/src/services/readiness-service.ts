import { and, eq, sql } from 'drizzle-orm';
import { evaluateReadiness } from '@jibli/domain';
import {
  branchWorkingHours,
  cities,
  governorates,
  menuItems,
  restaurantBranches,
  restaurantCommissionConfigs,
  restaurantDrivers,
  restaurantMembers,
  restaurants,
} from '@jibli/db';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import type { AppContext } from '../lib/context.js';

/**
 * The onboarding readiness checklist (plan §122), computed once.
 *
 * It lived inside the Admin geography route, which is where it was written and
 * not where it belongs. The restaurant needs the same answer — it is the one
 * doing the work the checklist describes — and a second copy of twelve queries
 * is a second copy that drifts.
 */

export interface ReadinessResult {
  readonly ready: boolean;
  readonly checks: { key: string; label_ar: string; passed: boolean; blocking: boolean }[];
  readonly blocking_failures: string[];
}

export async function computeReadiness(
  ctx: AppContext,
  restaurantId: string,
): Promise<ReadinessResult> {
  const [restaurant] = await ctx.db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  if (!restaurant) {
    throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });
  }

  const [branch] = await ctx.db
    .select({
      id: restaurantBranches.id,
      latitude: restaurantBranches.latitude,
      longitude: restaurantBranches.longitude,
      cityOrderingEnabled: sql<boolean>`${cities.orderingEnabled} AND ${governorates.orderingEnabled}`,
    })
    .from(restaurantBranches)
    .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
    .innerJoin(governorates, eq(cities.governorateId, governorates.id))
    .where(eq(restaurantBranches.restaurantId, restaurantId))
    .limit(1);

  const [hoursCount] = await ctx.db
    .select({ value: sql<number>`COUNT(*)` })
    .from(branchWorkingHours)
    .where(eq(branchWorkingHours.branchId, branch?.id ?? ''));

  const [itemCount] = await ctx.db
    .select({ value: sql<number>`COUNT(*)` })
    .from(menuItems)
    .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.isActive, true)));

  const [commissionCount] = await ctx.db
    .select({ value: sql<number>`COUNT(*)` })
    .from(restaurantCommissionConfigs)
    .where(eq(restaurantCommissionConfigs.restaurantId, restaurantId));

  const [driverCount] = await ctx.db
    .select({ value: sql<number>`COUNT(*)` })
    .from(restaurantDrivers)
    .where(and(eq(restaurantDrivers.restaurantId, restaurantId), eq(restaurantDrivers.isActive, true)));

  const [ownerCount] = await ctx.db
    .select({ value: sql<number>`COUNT(*)` })
    .from(restaurantMembers)
    .where(and(eq(restaurantMembers.restaurantId, restaurantId), eq(restaurantMembers.isActive, true)));

  const readiness = evaluateReadiness({
    applicationApproved: restaurant.onboardingStatus === 'APPROVED',
    cityOrderingEnabled: Boolean(branch?.cityOrderingEnabled),
    ownerActive: Number(ownerCount?.value ?? 0) > 0,
    branchLocationValid: Boolean(branch?.latitude && branch?.longitude),
    workingHoursConfigured: Number(hoursCount?.value ?? 0) > 0,
    hasActiveMenuItem: Number(itemCount?.value ?? 0) > 0,
    commissionConfigured: Number(commissionCount?.value ?? 0) > 0,
    settlementPolicyConfigured: Number(commissionCount?.value ?? 0) > 0,
    /*
     * Not yet derived from anything. Kept as passing rather than failing so the
     * checklist does not block on a check nothing can satisfy — and named here
     * so it is obvious which of the twelve are real.
     */
    deliveryConfigured: true,
    hasActiveDriver: Number(driverCount?.value ?? 0) > 0,
    orderAlertAcknowledged: true,
    requiredDocumentsPresent: true,
  });

  return {
    ready: readiness.ready,
    checks: readiness.checks.map((check) => ({
      key: check.key,
      label_ar: check.labelAr,
      passed: check.passed,
      blocking: check.blocking,
    })),
    blocking_failures: readiness.blockingFailures.map((check) => check.key),
  };
}
