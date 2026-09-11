import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_PERMISSIONS,
  AppError,
  ERROR_CODES,
  PLATFORM_ROLES,
  REAUTHENTICATION_REQUIRED_PERMISSIONS,
  RESTAURANT_ROLE_PERMISSIONS,
  RESTAURANT_ROLES,
  success,
} from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { reasonSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import { platformConfig, platformConfigHistory, users } from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { CONFIG_DEFAULTS, setConfig, type ConfigKey } from '../../services/config-service.js';

/**
 * Platform configuration and the role matrix (plan §85–§87, §118).
 *
 * Configuration is versioned: every change records the previous value, the new
 * value, who made it and why, because a mis-set service fee is visible to every
 * customer within seconds.
 */

/**
 * Validation per key.
 *
 * A config store that accepts any JSON would let someone set the service fee to
 * a string and take checkout down. Each key declares its own shape.
 */
const CONFIG_SCHEMAS: Record<ConfigKey, z.ZodTypeAny> = {
  global_checkout_enabled: z.boolean(),
  platform_service_fee_iqd: z.number().int().min(0).max(100_000),
  default_commission_rate_bps: z.number().int().min(0).max(10_000),
  default_settlement_policy: z.enum(['HALF_MONTH', 'MONTHLY']),
  default_payment_term_days: z.number().int().min(0).max(90),
  delivery_pin_enabled: z.boolean(),
  order_acceptance_timeout_minutes: z.number().int().min(1).max(120),
  minimum_app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  latest_app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  support_phone: z.string().min(8).max(20),
  max_active_deliveries_per_driver: z.number().int().min(1).max(10),
};

/** Keys whose change is high-impact enough to demand a written reason. */
const REASON_REQUIRED: ReadonlySet<ConfigKey> = new Set([
  'global_checkout_enabled',
  'platform_service_fee_iqd',
  'default_commission_rate_bps',
  'delivery_pin_enabled',
  'minimum_app_version',
]);

export function registerAdminSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/admin/config', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'config.read');

    const stored = await ctx.db.select().from(platformConfig);
    const byKey = new Map(stored.map((row) => [row.key, row]));

    // Report every known key, falling back to its compiled default, so the UI
    // shows the complete surface rather than only what someone has already set.
    const entries = (Object.keys(CONFIG_DEFAULTS) as ConfigKey[]).map((key) => {
      const row = byKey.get(key);
      return {
        key,
        value: row?.value ?? CONFIG_DEFAULTS[key],
        is_default: row === undefined,
        description_ar: row?.descriptionAr ?? null,
        is_sensitive: row?.isSensitive ?? REASON_REQUIRED.has(key),
        reason_required: REASON_REQUIRED.has(key),
        updated_at: row?.updatedAt?.toISOString() ?? null,
      };
    });

    return reply.send(success(entries, { request_id: request.requestId }));
  });

  app.patch('/api/v1/admin/config', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'config.write');

    const body = z
      .object({
        key: z.enum(Object.keys(CONFIG_DEFAULTS) as [ConfigKey, ...ConfigKey[]]),
        value: z.unknown(),
        reason: reasonSchema.optional(),
      })
      .parse(request.body);

    const schema = CONFIG_SCHEMAS[body.key];
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        details: { key: body.key, issues: parsed.error.issues.map((i) => i.message) },
      });
    }

    if (REASON_REQUIRED.has(body.key) && !body.reason) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        details: { field: 'reason', message: 'This setting requires a written reason' },
      });
    }

    await ctx.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ value: platformConfig.value })
        .from(platformConfig)
        .where(eq(platformConfig.key, body.key))
        .limit(1);

      await setConfig(tx, {
        key: body.key,
        value: parsed.data,
        changedBy: principal.userId,
        reason: body.reason ?? null,
        isSensitive: REASON_REQUIRED.has(body.key),
      });

      await writeAudit(tx, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.CONFIG_UPDATE,
        entityType: 'platform_config',
        entityId: body.key,
        before: { value: existing?.value ?? CONFIG_DEFAULTS[body.key] },
        after: { value: parsed.data },
        reason: body.reason ?? null,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });
    });

    return reply.send(success({ updated: true }, { request_id: request.requestId }));
  });

  /** Change history for one key, so a bad value can be traced and reverted. */
  app.get(
    '/api/v1/admin/config/:key/history',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'config.read');
      const { key } = z.object({ key: z.string().max(64) }).parse(request.params);

      const rows = await ctx.db
        .select({
          previousValue: platformConfigHistory.previousValue,
          newValue: platformConfigHistory.newValue,
          reason: platformConfigHistory.reason,
          changedBy: users.fullName,
          createdAt: platformConfigHistory.createdAt,
        })
        .from(platformConfigHistory)
        .leftJoin(users, eq(platformConfigHistory.changedBy, users.id))
        .where(eq(platformConfigHistory.key, key))
        .orderBy(desc(platformConfigHistory.createdAt))
        .limit(50);

      return reply.send(
        success(
          rows.map((row) => ({
            previous_value: row.previousValue,
            new_value: row.newValue,
            reason: row.reason,
            changed_by: row.changedBy,
            at: row.createdAt.toISOString(),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * The role matrix (plan §86, §87).
   *
   * Read-only: roles are defined in code, not data. A role whose permissions can
   * be edited at runtime is a role whose security properties nobody can reason
   * about — and "default is deny; introducing a new permission does not
   * automatically grant it to every existing role" (plan §85) only holds if the
   * matrix is reviewed in source.
   */
  app.get('/api/v1/admin/roles', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'roles.manage');

    return reply.send(
      success(
        {
          platform_roles: PLATFORM_ROLES.map((role) => ({
            role,
            permissions: ADMIN_ROLE_PERMISSIONS[role],
            permission_count: ADMIN_ROLE_PERMISSIONS[role].length,
            mfa_mandatory: ['SUPER_ADMIN', 'FINANCE_ADMIN'].includes(role),
          })),
          restaurant_roles: RESTAURANT_ROLES.map((role) => ({
            role,
            permissions: RESTAURANT_ROLE_PERMISSIONS[role],
            permission_count: RESTAURANT_ROLE_PERMISSIONS[role].length,
          })),
          all_admin_permissions: ADMIN_PERMISSIONS,
          // Surfaced so the UI can mark which actions will prompt for MFA.
          reauthentication_required: REAUTHENTICATION_REQUIRED_PERMISSIONS,
          note_ar:
            'مصفوفة الصلاحيات معرّفة في الكود ولا تُعدَّل من الواجهة. أي تغيير يتطلب مراجعة ونشر.',
        },
        { request_id: request.requestId },
      ),
    );
  });
}
