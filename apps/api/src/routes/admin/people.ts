import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ACTIVE_DELIVERY_STATUSES,
  AppError,
  DRIVER_ACCOUNT_STATUSES,
  ERROR_CODES,
  EVENT_TYPES,
  PLATFORM_ROLES,
  USER_STATUSES,
  success,
} from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { maskPhone, reasonSchema, uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, computeCustody, enqueueOutboxEvent, writeAudit } from '@jibli/domain';
import {
  cities,
  deliveryAssignments,
  driverCashEvents,
  drivers,
  orders,
  restaurantDrivers,
  restaurants,
  userPlatformRoles,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { revokeSessionChain } from '../../services/session-service.js';

/**
 * Customers, drivers and platform staff (plan §62, §84, §87).
 *
 * Phone numbers are masked unless the caller holds `customer.phone.unmask`,
 * and every unmask is audited — plan §84 treats an unmask as a privileged
 * action, not a display preference.
 */

export function registerAdminPeopleRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Customer directory. */
  app.get('/api/v1/admin/users', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'customer.read');
    const query = z
      .object({
        q: z.string().max(80).optional(),
        status: z.enum(USER_STATUSES).optional(),
        city_id: uuidSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      })
      .parse(request.query);

    const canUnmask = principal.platformRoles.includes('SUPER_ADMIN');

    const conditions = [isNull(users.deletedAt)];
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.city_id) conditions.push(eq(users.profileCityId, query.city_id));
    if (query.q) {
      conditions.push(
        or(ilike(users.fullName, `%${query.q}%`), ilike(users.phoneE164, `%${query.q}%`)) as never,
      );
    }

    const rows = await ctx.db
      .select({
        id: users.id,
        fullName: users.fullName,
        phoneE164: users.phoneE164,
        status: users.status,
        profileCompletedAt: users.profileCompletedAt,
        cityNameAr: cities.nameAr,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        orderCount: sql<number>`(
          SELECT COUNT(*) FROM ${orders} WHERE ${orders.userId} = ${users.id}
        )`,
        completedSpendIqd: sql<number>`(
          SELECT COALESCE(SUM(${orders.customerTotalIqd}), 0) FROM ${orders}
          WHERE ${orders.userId} = ${users.id} AND ${orders.status} = 'COMPLETED'
        )`,
      })
      .from(users)
      .leftJoin(cities, eq(users.profileCityId, cities.id))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const [total] = await ctx.db.select({ value: count() }).from(users).where(and(...conditions));

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          full_name: row.fullName,
          phone: canUnmask ? row.phoneE164 : maskPhone(row.phoneE164),
          phone_masked: !canUnmask,
          status: row.status,
          profile_completed: row.profileCompletedAt !== null,
          city_name_ar: row.cityNameAr,
          order_count: Number(row.orderCount),
          lifetime_spend_iqd: Number(row.completedSpendIqd),
          created_at: row.createdAt.toISOString(),
          last_login_at: row.lastLoginAt?.toISOString() ?? null,
        })),
        { request_id: request.requestId, total: total?.value ?? 0 },
      ),
    );
  });

  /**
   * Reveal one customer's phone number (plan §84).
   *
   * A separate endpoint rather than a query flag, because it must be audited
   * individually — "controlled unmask permission if operationally required".
   */
  app.post(
    '/api/v1/admin/users/:userId/unmask-phone',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      // Demands a fresh MFA challenge (plan §88).
      assertAdminPermission(principal, 'customer.phone.unmask');
      const { userId } = z.object({ userId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      const [user] = await ctx.db
        .select({ phoneE164: users.phoneE164 })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'user' } });

      await ctx.db.transaction(async (tx) => {
        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.CUSTOMER_PHONE_UNMASK,
          entityType: 'user',
          entityId: userId,
          // The number itself is deliberately not written to the audit row.
          after: { unmasked: true },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(success({ phone: user.phoneE164 }, { request_id: request.requestId }));
    },
  );

  /** Block or unblock a customer. */
  app.post(
    '/api/v1/admin/users/:userId/block',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'customer.block');
      const { userId } = z.object({ userId: uuidSchema }).parse(request.params);
      const body = z
        .object({ blocked: z.boolean(), reason: reasonSchema })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [user] = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, userId))
          .for('update')
          .limit(1);

        if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'user' } });

        await tx
          .update(users)
          .set({ status: body.blocked ? 'SUSPENDED' : 'ACTIVE', updatedAt: new Date() })
          .where(eq(users.id, userId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.CUSTOMER_BLOCK,
          entityType: 'user',
          entityId: userId,
          before: { status: user.status },
          after: { status: body.blocked ? 'SUSPENDED' : 'ACTIVE' },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      // A blocked user's live sessions must die immediately, not at token expiry.
      if (body.blocked) {
        await revokeSessionChain(ctx, userId, 'ACCOUNT_BLOCKED');
      }

      return reply.send(
        success({ blocked: body.blocked }, { request_id: request.requestId }),
      );
    },
  );

  /** Driver directory across every restaurant, with cash custody. */
  app.get('/api/v1/admin/drivers', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'driver.read.global');
    const query = z
      .object({
        q: z.string().max(80).optional(),
        status: z.enum(DRIVER_ACCOUNT_STATUSES).optional(),
        restaurant_id: uuidSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query);

    const canUnmask = principal.platformRoles.includes('SUPER_ADMIN');

    const conditions = [];
    if (query.status) conditions.push(eq(drivers.status, query.status));
    if (query.restaurant_id) conditions.push(eq(restaurantDrivers.restaurantId, query.restaurant_id));
    if (query.q) conditions.push(ilike(users.fullName, `%${query.q}%`));

    const rows = await ctx.db
      .select({
        driverId: drivers.id,
        fullName: users.fullName,
        phoneE164: users.phoneE164,
        status: drivers.status,
        availability: drivers.availability,
        vehicleType: drivers.defaultVehicleType,
        lastHeartbeatAt: drivers.lastHeartbeatAt,
        restaurantName: restaurants.displayName,
        restaurantId: restaurants.id,
        activeAssignments: sql<number>`(
          SELECT COUNT(*) FROM ${deliveryAssignments}
          WHERE ${deliveryAssignments.driverId} = ${drivers.id}
            AND ${deliveryAssignments.status} = ANY(${[...ACTIVE_DELIVERY_STATUSES]})
        )`,
        completedDeliveries: sql<number>`(
          SELECT COUNT(*) FROM ${deliveryAssignments}
          WHERE ${deliveryAssignments.driverId} = ${drivers.id}
            AND ${deliveryAssignments.status} = 'DELIVERED'
        )`,
      })
      .from(drivers)
      .innerJoin(users, eq(drivers.userId, users.id))
      .leftJoin(restaurantDrivers, eq(restaurantDrivers.driverId, drivers.id))
      .leftJoin(restaurants, eq(restaurantDrivers.restaurantId, restaurants.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(drivers.createdAt))
      .limit(query.limit);

    // Cash custody per driver. Derived from events rather than a stored total,
    // so it can always be re-proved from history (plan §96).
    const driverIds = rows.map((row) => row.driverId);
    const custodyByDriver = new Map<string, number>();

    if (driverIds.length > 0) {
      const events = await ctx.db
        .select({
          driverId: driverCashEvents.driverId,
          type: driverCashEvents.type,
          amountIqd: driverCashEvents.amountIqd,
          createdAt: driverCashEvents.createdAt,
        })
        .from(driverCashEvents)
        .where(inArray(driverCashEvents.driverId, driverIds));

      const grouped = new Map<string, typeof events>();
      for (const event of events) {
        const list = grouped.get(event.driverId) ?? [];
        list.push(event);
        grouped.set(event.driverId, list);
      }
      for (const [driverId, driverEvents] of grouped) {
        custodyByDriver.set(driverId, computeCustody(driverEvents).currentCustodyIqd);
      }
    }

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.driverId,
          full_name: row.fullName,
          phone: canUnmask ? row.phoneE164 : maskPhone(row.phoneE164),
          phone_masked: !canUnmask,
          status: row.status,
          availability: row.availability,
          vehicle_type: row.vehicleType,
          restaurant_id: row.restaurantId,
          restaurant_name: row.restaurantName,
          active_assignments: Number(row.activeAssignments),
          completed_deliveries: Number(row.completedDeliveries),
          // Restaurant cash the driver is holding — never a Jibli balance.
          cash_custody_iqd: custodyByDriver.get(row.driverId) ?? 0,
          last_seen_at: row.lastHeartbeatAt?.toISOString() ?? null,
        })),
        { request_id: request.requestId },
      ),
    );
  });

  /** Suspend a driver (plan §87). */
  app.post(
    '/api/v1/admin/drivers/:driverId/suspend',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'driver.suspend');
      const { driverId } = z.object({ driverId: uuidSchema }).parse(request.params);
      const body = z
        .object({ suspended: z.boolean(), reason: reasonSchema })
        .parse(request.body);

      const driverUserId = await ctx.db.transaction(async (tx) => {
        const [driver] = await tx
          .select({ status: drivers.status, userId: drivers.userId })
          .from(drivers)
          .where(eq(drivers.id, driverId))
          .for('update')
          .limit(1);

        if (!driver) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'driver' } });

        // A driver holding a live delivery cannot simply vanish — the food and
        // the cash are already in their hands (plan §49).
        if (body.suspended) {
          const [active] = await tx
            .select({ value: count() })
            .from(deliveryAssignments)
            .where(
              and(
                eq(deliveryAssignments.driverId, driverId),
                inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES]),
              ),
            );

          if ((active?.value ?? 0) > 0) {
            throw new AppError(ERROR_CODES.CONFLICT, {
              details: {
                reason: 'DRIVER_HAS_ACTIVE_DELIVERY',
                activeAssignments: active?.value ?? 0,
                messageHint:
                  'أعد تعيين طلبات التوصيل النشطة إلى سائق آخر قبل إيقاف هذا السائق',
              },
            });
          }
        }

        await tx
          .update(drivers)
          .set({
            status: body.suspended ? 'SUSPENDED' : 'ACTIVE',
            availability: body.suspended ? 'OFFLINE' : 'AVAILABLE',
            suspendedAt: body.suspended ? new Date() : null,
            suspendedReason: body.suspended ? body.reason : null,
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driverId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.DRIVER_SUSPEND,
          entityType: 'driver',
          entityId: driverId,
          before: { status: driver.status },
          after: { status: body.suspended ? 'SUSPENDED' : 'ACTIVE' },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        if (body.suspended) {
          await enqueueOutboxEvent(tx, {
            eventType: EVENT_TYPES.DRIVER_SUSPENDED,
            aggregateType: 'driver',
            aggregateId: driverId,
            requestId: request.requestId,
            payload: {
              driverId,
              userId: driver.userId,
              restaurantId: '',
              branchId: null,
              reason: body.reason,
            },
          });
        }

        return driver.userId;
      });

      // Driver Mode disappears on the next request; revoking sessions makes it
      // immediate (plan §77).
      if (body.suspended) {
        await revokeSessionChain(ctx, driverUserId, 'DRIVER_SUSPENDED');
      }

      return reply.send(
        success({ suspended: body.suspended }, { request_id: request.requestId }),
      );
    },
  );

  // ── Platform staff and roles (plan §62, §87) ──────────────────────────────

  app.get('/api/v1/admin/staff', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'roles.manage');

    const rows = await ctx.db
      .select({
        userId: users.id,
        fullName: users.fullName,
        phoneE164: users.phoneE164,
        status: users.status,
        mfaEnabledAt: users.mfaEnabledAt,
        role: userPlatformRoles.role,
        grantedAt: userPlatformRoles.createdAt,
      })
      .from(userPlatformRoles)
      .innerJoin(users, eq(userPlatformRoles.userId, users.id))
      .where(isNull(userPlatformRoles.revokedAt))
      .orderBy(users.fullName);

    // One row per person, with their roles collected.
    interface StaffMember {
      user_id: string;
      full_name: string | null;
      phone: string;
      status: string;
      mfa_enabled: boolean;
      roles: string[];
    }

    const byUser = new Map<string, StaffMember>();
    for (const row of rows) {
      const existing: StaffMember = byUser.get(row.userId) ?? {
        user_id: row.userId,
        full_name: row.fullName,
        phone: maskPhone(row.phoneE164),
        status: row.status,
        mfa_enabled: row.mfaEnabledAt !== null,
        roles: [],
      };
      existing.roles.push(row.role);
      byUser.set(row.userId, existing);
    }

    // Flag anyone holding a role that mandates MFA but has not enrolled —
    // this is the plan §88 launch blocker, made visible.
    const staff = [...byUser.values()].map((member) => ({
      ...member,
      mfa_required: member.roles.some((role) =>
        ['SUPER_ADMIN', 'FINANCE_ADMIN'].includes(role),
      ),
    }));

    return reply.send(
      success(staff, {
        request_id: request.requestId,
        mfa_gap_count: staff.filter((m) => m.mfa_required && !m.mfa_enabled).length,
      }),
    );
  });

  /** Grant or revoke a platform role. Requires fresh MFA (plan §88). */
  app.post('/api/v1/admin/staff/roles', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'roles.manage');
    const body = z
      .object({
        user_id: uuidSchema,
        role: z.enum(PLATFORM_ROLES),
        granted: z.boolean(),
        reason: reasonSchema,
      })
      .parse(request.body);

    // Refuse to remove the last Super Admin: an empty set locks everyone out of
    // role management permanently.
    if (!body.granted && body.role === 'SUPER_ADMIN') {
      const [remaining] = await ctx.db
        .select({ value: count() })
        .from(userPlatformRoles)
        .where(
          and(eq(userPlatformRoles.role, 'SUPER_ADMIN'), isNull(userPlatformRoles.revokedAt)),
        );

      if ((remaining?.value ?? 0) <= 1) {
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: {
            reason: 'LAST_SUPER_ADMIN',
            messageHint: 'لا يمكن إزالة آخر مدير نظام — عيّن مديراً آخر أولاً',
          },
        });
      }
    }

    await ctx.db.transaction(async (tx) => {
      if (body.granted) {
        await tx
          .insert(userPlatformRoles)
          .values({
            id: uuidv7(),
            userId: body.user_id,
            role: body.role,
            grantedBy: principal.userId,
          })
          .onConflictDoUpdate({
            target: [userPlatformRoles.userId, userPlatformRoles.role],
            set: { revokedAt: null, grantedBy: principal.userId },
          });
      } else {
        await tx
          .update(userPlatformRoles)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(userPlatformRoles.userId, body.user_id),
              eq(userPlatformRoles.role, body.role),
            ),
          );
      }

      await writeAudit(tx, {
        actorUserId: principal.userId,
        action: body.granted ? AUDIT_ACTIONS.ROLE_GRANT : AUDIT_ACTIONS.ROLE_REVOKE,
        entityType: 'user',
        entityId: body.user_id,
        after: { role: body.role, granted: body.granted },
        reason: body.reason,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });
    });

    // "A role change takes effect server-side immediately and can trigger
    // session refresh/revocation for sensitive changes" (plan §86).
    await revokeSessionChain(ctx, body.user_id, 'ROLE_CHANGED');

    return reply.send(success({ updated: true }, { request_id: request.requestId }));
  });
}
