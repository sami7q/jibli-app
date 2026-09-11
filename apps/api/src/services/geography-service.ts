import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import {
  AppError,
  ERROR_CODES,
  LIVE_ORDER_STATUSES,
  type GeographyCapability,
} from '@jibli/contracts';
import {
  assertCityCapability,
  selectableCities,
  selectableGovernorates,
  type CityNode,
  type GovernorateNode,
  type ResolvedCity,
} from '@jibli/geography';
import {
  cities,
  governorates,
  orders,
  restaurantBranches,
  users,
  type DbExecutor,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';

/**
 * Geography reads and capability resolution.
 *
 * Every caller that needs to know whether a city is open goes through
 * `resolveCity` + the `@jibli/geography` assertions, so the parent-override rule
 * is applied in exactly one place (plan §8.6).
 */

const GOVERNORATE_COLUMNS = {
  id: governorates.id,
  code: governorates.code,
  nameAr: governorates.nameAr,
  isEnabled: governorates.isEnabled,
  customerSignupEnabled: governorates.customerSignupEnabled,
  restaurantOnboardingEnabled: governorates.restaurantOnboardingEnabled,
  orderingEnabled: governorates.orderingEnabled,
  sortOrder: governorates.sortOrder,
};

const CITY_COLUMNS = {
  id: cities.id,
  governorateId: cities.governorateId,
  code: cities.code,
  nameAr: cities.nameAr,
  isEnabled: cities.isEnabled,
  customerSignupEnabled: cities.customerSignupEnabled,
  restaurantOnboardingEnabled: cities.restaurantOnboardingEnabled,
  orderingEnabled: cities.orderingEnabled,
  sortOrder: cities.sortOrder,
};

/** Cache TTL for public geography lists (plan §115). Short, and never trusted at checkout. */
const GEOGRAPHY_CACHE_TTL_SECONDS = 300;

function cacheKey(capability: GeographyCapability, governorateId?: string): string {
  return governorateId
    ? `geo:cities:${capability}:${governorateId}`
    : `geo:governorates:${capability}`;
}

/**
 * Governorates a client may choose from, for one capability.
 *
 * The list is filtered server-side: a selector must never show an option the
 * server would then reject (plan §11).
 */
export async function listSelectableGovernorates(
  ctx: AppContext,
  capability: GeographyCapability,
): Promise<Pick<GovernorateNode, 'id' | 'code' | 'nameAr'>[]> {
  const cached = await readCache(ctx, cacheKey(capability));
  if (cached) return cached as Pick<GovernorateNode, 'id' | 'code' | 'nameAr'>[];

  const rows = await ctx.db
    .select(GOVERNORATE_COLUMNS)
    .from(governorates)
    .orderBy(asc(governorates.sortOrder), asc(governorates.nameAr));

  const result = selectableGovernorates(rows as GovernorateNode[], capability).map((g) => ({
    id: g.id,
    code: g.code,
    nameAr: g.nameAr,
  }));

  await writeCache(ctx, cacheKey(capability), result);
  return result;
}

export async function listSelectableCities(
  ctx: AppContext,
  governorateId: string,
  capability: GeographyCapability,
): Promise<Pick<CityNode, 'id' | 'code' | 'nameAr'>[]> {
  const cached = await readCache(ctx, cacheKey(capability, governorateId));
  if (cached) return cached as Pick<CityNode, 'id' | 'code' | 'nameAr'>[];

  const [governorate] = await ctx.db
    .select(GOVERNORATE_COLUMNS)
    .from(governorates)
    .where(eq(governorates.id, governorateId))
    .limit(1);

  if (!governorate) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'governorate' } });

  const rows = await ctx.db
    .select(CITY_COLUMNS)
    .from(cities)
    .where(eq(cities.governorateId, governorateId))
    .orderBy(asc(cities.sortOrder), asc(cities.nameAr));

  const result = selectableCities(
    rows as CityNode[],
    governorate as GovernorateNode,
    capability,
  ).map((c) => ({ id: c.id, code: c.code, nameAr: c.nameAr }));

  await writeCache(ctx, cacheKey(capability, governorateId), result);
  return result;
}

/**
 * Load a city together with its real parent.
 *
 * The governorate is read from the city row, never from the request: a client
 * that submits a mismatched pair must not be able to smuggle a city under a
 * governorate that happens to be open (plan §215 "forged city").
 */
export async function resolveCity(executor: DbExecutor, cityId: string): Promise<ResolvedCity> {
  const [row] = await executor
    .select({ city: CITY_COLUMNS, governorate: GOVERNORATE_COLUMNS })
    .from(cities)
    .innerJoin(governorates, eq(cities.governorateId, governorates.id))
    .where(eq(cities.id, cityId))
    .limit(1);

  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'city', cityId } });

  return { city: row.city as CityNode, governorate: row.governorate as GovernorateNode };
}

/**
 * Validate a governorate/city pair submitted by a client, for a capability.
 *
 * This is the server-side re-check that beats a stale client: the city was in
 * the dropdown, an Admin disabled it since, and the submit must fail with a code
 * the app can recover from (plan §11).
 */
export async function assertSelectableGeography(
  executor: DbExecutor,
  params: { governorateId: string; cityId: string; capability: GeographyCapability },
): Promise<ResolvedCity> {
  const resolved = await resolveCity(executor, params.cityId);

  if (resolved.city.governorateId !== params.governorateId) {
    throw new AppError(ERROR_CODES.CITY_GOVERNORATE_MISMATCH, {
      details: { cityId: params.cityId, governorateId: params.governorateId },
    });
  }

  assertCityCapability(resolved, params.capability);
  return resolved;
}

/** Full admin view, including rows a customer would never be offered. */
export async function listAllGovernorates(ctx: AppContext) {
  return ctx.db
    .select(GOVERNORATE_COLUMNS)
    .from(governorates)
    .orderBy(asc(governorates.sortOrder));
}

export async function listCitiesForAdmin(ctx: AppContext, governorateId?: string) {
  const query = ctx.db.select(CITY_COLUMNS).from(cities);
  if (governorateId) {
    return query.where(eq(cities.governorateId, governorateId)).orderBy(asc(cities.sortOrder));
  }
  return query.orderBy(asc(cities.governorateId), asc(cities.sortOrder));
}

/**
 * Invalidate cached geography after an Admin change (plan §115).
 *
 * "Even if invalidation temporarily fails, server-side checkout validation reads
 * authoritative current state" — so this is best-effort by design.
 */
export async function invalidateGeographyCache(ctx: AppContext): Promise<void> {
  try {
    const pattern = `${ctx.env.REDIS_NAMESPACE}:geo:*`;
    const stream = ctx.redis.scanStream({ match: pattern, count: 100 });
    const pipeline = ctx.redis.pipeline();
    let queued = 0;
    for await (const batch of stream as AsyncIterable<string[]>) {
      for (const key of batch) {
        // scanStream yields fully-qualified keys; strip the prefix ioredis re-adds.
        pipeline.del(key.slice(`${ctx.env.REDIS_NAMESPACE}:`.length));
        queued += 1;
      }
    }
    if (queued > 0) await pipeline.exec();
  } catch (error) {
    ctx.logger.warn(
      { event: 'geography.cache_invalidation_failed', err: String(error) },
      'Geography cache invalidation failed; authoritative checks are unaffected',
    );
  }
}

async function readCache(ctx: AppContext, key: string): Promise<unknown | null> {
  try {
    const raw = await ctx.redis.get(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    // A cache outage must never take geography down — fall through to the DB.
    return null;
  }
}

async function writeCache(ctx: AppContext, key: string, value: unknown): Promise<void> {
  try {
    await ctx.redis.set(key, JSON.stringify(value), 'EX', GEOGRAPHY_CACHE_TTL_SECONDS);
  } catch {
    /* cache write failures are non-fatal */
  }
}

/** Counts shown in the Admin impact preview before disabling a city (plan §114). */
export interface CoverageImpact {
  readonly activeRestaurants: number;
  readonly activeOrders: number;
  readonly customerProfiles: number;
}

export async function cityCoverageImpact(
  ctx: AppContext,
  cityId: string,
): Promise<CoverageImpact> {
  const [restaurantCount] = await ctx.db
    .select({ value: count() })
    .from(restaurantBranches)
    .where(and(eq(restaurantBranches.cityId, cityId), eq(restaurantBranches.isActive, true)));

  const [profileCount] = await ctx.db
    .select({ value: count() })
    .from(users)
    .where(eq(users.profileCityId, cityId));

  // Active orders are the reason a disable does not strand food or cash: they
  // are allowed to finish (plan §8.7), and Admin must see how many there are.
  const [orderCount] = await ctx.db
    .select({ value: count() })
    .from(orders)
    .innerJoin(restaurantBranches, eq(orders.branchId, restaurantBranches.id))
    .where(
      and(
        eq(restaurantBranches.cityId, cityId),
        inArray(orders.status, [...LIVE_ORDER_STATUSES]),
      ),
    );

  return {
    activeRestaurants: restaurantCount?.value ?? 0,
    activeOrders: orderCount?.value ?? 0,
    customerProfiles: profileCount?.value ?? 0,
  };
}

/**
 * The effective-capability rule as a SQL fragment.
 *
 * Plan §8.6 requires one canonical implementation of "a child is never stronger
 * than its parent". `@jibli/geography` owns it for in-memory rows; this is the
 * same rule for queries that must filter or project it in the database, so the
 * two can never drift. Callers must have both `cities` and `governorates` in
 * scope for the fragment to resolve.
 */
export function effectiveCapabilitySql(capability: GeographyCapability) {
  const columns = {
    customer_signup: [governorates.customerSignupEnabled, cities.customerSignupEnabled],
    restaurant_onboarding: [
      governorates.restaurantOnboardingEnabled,
      cities.restaurantOnboardingEnabled,
    ],
    ordering: [governorates.orderingEnabled, cities.orderingEnabled],
  } as const;

  const [governorateFlag, cityFlag] = columns[capability];
  return sql<boolean>`(${governorates.isEnabled} AND ${governorateFlag} AND ${cities.isEnabled} AND ${cityFlag})`;
}
