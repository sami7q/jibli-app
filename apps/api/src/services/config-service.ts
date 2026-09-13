import { eq } from 'drizzle-orm';
import { platformConfig, platformConfigHistory, uuidv7, type DbExecutor } from '@jibli/db';
import type { AppContext } from '../lib/context.js';

/**
 * Admin-managed runtime configuration (plan §118, §119).
 *
 * "The mobile application never hard-codes the amount." Service fee, minimum app
 * version, OTP timings and the global checkout switch all live here so
 * Operations can change them without a release.
 */

/** Defaults used before an Admin has ever set a value. */
export const CONFIG_DEFAULTS = {
  global_checkout_enabled: true,
  platform_service_fee_iqd: 1000,
  commission_flat_iqd: 500,
  default_settlement_policy: 'HALF_MONTH',
  default_payment_term_days: 7,
  delivery_pin_enabled: true,
  order_acceptance_timeout_minutes: 10,
  minimum_app_version: '1.0.0',
  latest_app_version: '1.0.0',
  support_phone: '+9647700000000',
  max_active_deliveries_per_driver: 1,
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;

/** In-process cache; configuration changes rarely and is read on every checkout. */
const CONFIG_CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

export async function getConfig<T>(ctx: AppContext, key: ConfigKey, fallback: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  try {
    const [row] = await ctx.db
      .select({ value: platformConfig.value })
      .from(platformConfig)
      .where(eq(platformConfig.key, key))
      .limit(1);

    const value = (row?.value ?? CONFIG_DEFAULTS[key] ?? fallback) as T;
    cache.set(key, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return value;
  } catch (error) {
    // Configuration must never be the reason checkout breaks: fall back to the
    // compiled default and say so loudly.
    ctx.logger.error(
      { event: 'config.read_failed', key, err: String(error) },
      'Falling back to default configuration value',
    );
    return fallback;
  }
}

/** Write a configuration value, keeping a versioned history (plan §118). */
export async function setConfig(
  tx: DbExecutor,
  params: {
    key: ConfigKey;
    value: unknown;
    changedBy: string | null;
    reason?: string | null;
    isSensitive?: boolean;
  },
): Promise<void> {
  const [existing] = await tx
    .select({ value: platformConfig.value })
    .from(platformConfig)
    .where(eq(platformConfig.key, params.key))
    .limit(1);

  if (existing) {
    await tx
      .update(platformConfig)
      .set({ value: params.value, updatedBy: params.changedBy, updatedAt: new Date() })
      .where(eq(platformConfig.key, params.key));
  } else {
    await tx.insert(platformConfig).values({
      id: uuidv7(),
      key: params.key,
      value: params.value,
      isSensitive: params.isSensitive ?? false,
      updatedBy: params.changedBy,
    });
  }

  await tx.insert(platformConfigHistory).values({
    id: uuidv7(),
    key: params.key,
    previousValue: existing?.value ?? null,
    newValue: params.value,
    reason: params.reason ?? null,
    changedBy: params.changedBy,
  });

  cache.delete(params.key);
}

/** Clear the in-process cache — used by tests and after a bulk config import. */
export function clearConfigCache(): void {
  cache.clear();
}

/**
 * App version gate (plan §119).
 *
 * "Never deploy a breaking API change assuming every customer immediately
 * updates mobile." The server tells the client what it needs.
 */
export interface AppVersionVerdict {
  readonly supported: boolean;
  readonly updateRequired: boolean;
  readonly updateAvailable: boolean;
  readonly minimumVersion: string;
  readonly latestVersion: string;
}

/** Compare dotted numeric versions. Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkAppVersion(
  ctx: AppContext,
  clientVersion: string | null,
): Promise<AppVersionVerdict> {
  const minimumVersion = await getConfig(ctx, 'minimum_app_version', '1.0.0');
  const latestVersion = await getConfig(ctx, 'latest_app_version', '1.0.0');

  // An unknown version is treated as supported: refusing to serve a client that
  // simply forgot the header would lock users out for a header bug.
  if (!clientVersion) {
    return {
      supported: true,
      updateRequired: false,
      updateAvailable: false,
      minimumVersion,
      latestVersion,
    };
  }

  const belowMinimum = compareVersions(clientVersion, minimumVersion) < 0;
  return {
    supported: !belowMinimum,
    updateRequired: belowMinimum,
    updateAvailable: compareVersions(clientVersion, latestVersion) < 0,
    minimumVersion,
    latestVersion,
  };
}
