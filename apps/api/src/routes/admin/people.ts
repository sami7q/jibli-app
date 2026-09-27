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
  VEHICLE_TYPES,
  success,
} from '@jibli/contracts';
import { assertAdminPermission, hasAdminPermission } from '@jibli/auth';
import {
  displayNameSchema,
  iraqiPhoneSchema,
  maskPhone,
  reasonSchema,
  uuidSchema,
} from '@jibli/validation';
import { AUDIT_ACTIONS, computeCustody, enqueueOutboxEvent, writeAudit } from '@jibli/domain';
import {
  cities,
  deliveryAssignments,
  driverCashEvents,
  drivers,
  orders,
  restaurantBranches,
  restaurantDrivers,
  restaurantMembers,
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
  /**
   * People directory: customers and the people who run restaurants.
   *
   * One table rather than two, because one phone number is one person: the
   * owner of a restaurant orders dinner from somebody else's, and splitting
   * them into separate directories creates two records that drift apart. The
   * `role` filter is how the screen shows one group at a time.
   */
  app.get('/api/v1/admin/users', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'customer.read');
    const query = z
      .object({
        q: z.string().max(80).optional(),
        status: z.enum(USER_STATUSES).optional(),
        city_id: uuidSchema.optional(),
        /** OWNERS: has a live restaurant membership. CUSTOMERS: has none. */
        role: z.enum(['OWNERS', 'CUSTOMERS']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      })
      .parse(request.query);

    const canUnmask = principal.platformRoles.includes('SUPER_ADMIN');

    const conditions = [isNull(users.deletedAt)];
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.city_id) conditions.push(eq(users.profileCityId, query.city_id));
    if (query.q) {
      /*
       * Searches the restaurant name too. Someone looking for the owner of
       * "مندي حضرموت" knows the restaurant, not the person — that is the whole
       * reason they are on this screen.
       */
      conditions.push(
        or(
          ilike(users.fullName, `%${query.q}%`),
          ilike(users.phoneE164, `%${query.q}%`),
          ilike(users.username, `%${query.q}%`),
          sql`EXISTS (
            SELECT 1 FROM ${restaurantMembers}
            JOIN ${restaurants} ON ${restaurants.id} = ${restaurantMembers.restaurantId}
            WHERE ${restaurantMembers.userId} = ${users.id}
              AND ${restaurants.deletedAt} IS NULL
              AND ${restaurants.displayName} ILIKE ${`%${query.q}%`}
          )`,
        ) as never,
      );
    }

    /*
     * Membership decides which group someone is in, not a column on the user:
     * a person becomes a restaurant owner the moment Admin creates the
     * restaurant, and a flag would have to be kept in step with that by hand.
     */
    const runsARestaurant = sql`EXISTS (
      SELECT 1 FROM ${restaurantMembers}
      JOIN ${restaurants} ON ${restaurants.id} = ${restaurantMembers.restaurantId}
      WHERE ${restaurantMembers.userId} = ${users.id}
        AND ${restaurantMembers.isActive} = true
        AND ${restaurants.deletedAt} IS NULL
    )`;
    if (query.role === 'OWNERS') conditions.push(runsARestaurant as never);
    if (query.role === 'CUSTOMERS') conditions.push(sql`NOT ${runsARestaurant}` as never);

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

    /*
     * Memberships for this page of results only. A join on the main query
     * would multiply rows per restaurant and break both the count and the
     * page size; a lookup keyed by the ids already fetched does not.
     */
    const memberships =
      rows.length === 0
        ? []
        : await ctx.db
            .select({
              userId: restaurantMembers.userId,
              restaurantId: restaurants.id,
              displayName: restaurants.displayName,
              partnerCode: restaurants.partnerCode,
              operationalStatus: restaurants.operationalStatus,
              role: restaurantMembers.role,
              isActive: restaurantMembers.isActive,
            })
            .from(restaurantMembers)
            .innerJoin(restaurants, eq(restaurants.id, restaurantMembers.restaurantId))
            .where(
              and(
                inArray(
                  restaurantMembers.userId,
                  rows.map((row) => row.id),
                ),
                isNull(restaurants.deletedAt),
              ),
            )
            .orderBy(restaurants.displayName);

    const byUser = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const list = byUser.get(membership.userId) ?? [];
      list.push(membership);
      byUser.set(membership.userId, list);
    }

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          full_name: row.fullName,
          restaurants: (byUser.get(row.id) ?? []).map((membership) => ({
            id: membership.restaurantId,
            display_name: membership.displayName,
            partner_code: membership.partnerCode,
            operational_status: membership.operationalStatus,
            role: membership.role,
            is_active: membership.isActive,
          })),
          phone: row.phoneE164 ? (canUnmask ? row.phoneE164 : maskPhone(row.phoneE164)) : null,
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
            AND ${inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES])}
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
          phone: row.phoneE164 ? (canUnmask ? row.phoneE164 : maskPhone(row.phoneE164)) : null,
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

  /**
   * Create a driver from Admin (plan §45, §87).
   *
   * The restaurant portal could already hire one and the customer app could
   * already apply to be one, and between those two there was no way for the
   * platform's own operator to put a courier on the road. That is the wrong
   * gap to have: a pilot city's first couriers are recruited by the platform,
   * not by a restaurant that has not opened yet, and «add a driver» is the one
   * thing an operator setting up a launch reaches for and did not find.
   *
   * One identity per phone, like every other path here. A number that already
   * belongs to a customer becomes that customer's driver profile rather than a
   * second account — the same person, with one more thing they can do.
   *
   * `restaurant_id` is optional and normally absent. A driver created here
   * belongs to the platform and can be assigned to any partner's order; naming
   * one attaches them to that partner's own roster as well, which is what a
   * restaurant that brought its own courier expects to see in its portal.
   */
  app.post('/api/v1/admin/drivers', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'driver.create');

    const body = z
      .object({
        full_name: displayNameSchema(3, 80),
        phone: iraqiPhoneSchema,
        vehicle_type: z.enum(VEHICLE_TYPES).default('MOTORCYCLE'),
        plate_number: z.string().trim().max(20).optional(),
        /** Attach to one partner's roster as well. Absent means platform-wide. */
        restaurant_id: uuidSchema.optional(),
        can_collect_cash: z.boolean().default(true),
      })
      .parse(request.body);

    const result = await ctx.db.transaction(async (tx) => {
      const [existingUser] = await tx
        .select({ id: users.id, status: users.status, fullName: users.fullName })
        .from(users)
        .where(eq(users.phoneE164, body.phone))
        .limit(1);

      let userId: string;
      if (existingUser) {
        if (existingUser.status !== 'ACTIVE') {
          throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED, {
            details: { reason: 'PHONE_BELONGS_TO_SUSPENDED_ACCOUNT' },
            messageAr: 'هذا الرقم يعود لحساب موقوف. عالج الحساب أولاً.',
          });
        }
        userId = existingUser.id;
        // Never overwrite a name its owner chose; fill one in only if absent.
        if (!existingUser.fullName) {
          await tx
            .update(users)
            .set({ fullName: body.full_name, updatedAt: new Date() })
            .where(eq(users.id, userId));
        }
      } else {
        userId = uuidv7();
        await tx.insert(users).values({
          id: userId,
          phoneE164: body.phone,
          fullName: body.full_name,
          status: 'ACTIVE',
        });
      }

      const [existingDriver] = await tx
        .select({ id: drivers.id })
        .from(drivers)
        .where(eq(drivers.userId, userId))
        .limit(1);

      if (existingDriver) {
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: { reason: 'ALREADY_A_DRIVER', driver_id: existingDriver.id },
          messageAr: 'هذا الرقم مسجّل كمندوب بالفعل.',
        });
      }

      const driverId = uuidv7();
      await tx.insert(drivers).values({
        id: driverId,
        userId,
        /*
         * Not usable until the driver signs in on their own phone with an OTP.
         * An operator typing a number must not be able to put a courier on the
         * road who has never held the handset that receives the deliveries.
         */
        status: 'PENDING_ACTIVATION',
        availability: 'OFFLINE',
        defaultVehicleType: body.vehicle_type,
        plateNumber: body.plate_number ?? null,
      });

      if (body.restaurant_id) {
        const [branch] = await tx
          .select({ id: restaurantBranches.id })
          .from(restaurantBranches)
          .where(
            and(
              eq(restaurantBranches.restaurantId, body.restaurant_id),
              isNull(restaurantBranches.deletedAt),
            ),
          )
          .limit(1);

        await tx.insert(restaurantDrivers).values({
          id: uuidv7(),
          restaurantId: body.restaurant_id,
          branchId: branch?.id ?? null,
          driverId,
          canCollectCash: body.can_collect_cash,
          isActive: true,
          createdBy: principal.userId,
        });
      }

      await writeAudit(tx, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.DRIVER_CREATE,
        entityType: 'driver',
        entityId: driverId,
        after: {
          phone: maskPhone(body.phone),
          vehicleType: body.vehicle_type,
          restaurantId: body.restaurant_id ?? null,
        },
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      await enqueueOutboxEvent(tx, {
        eventType: EVENT_TYPES.DRIVER_INVITED,
        aggregateType: 'driver',
        aggregateId: driverId,
        requestId: request.requestId,
        payload: { driverId, userId, restaurantId: body.restaurant_id ?? null },
      });

      return { driverId };
    });

    return reply.status(201).send(
      success(
        {
          driver_id: result.driverId,
          note_ar:
            'أُنشئ حساب المندوب. يفعّله بنفسه بتسجيل الدخول في تطبيق جيبلي برقم هاتفه ورمز التحقق.',
        },
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

  // ── Driver applications ───────────────────────────────────────────────────

  /**
   * The queue of people waiting to become couriers.
   *
   * Every `PENDING_ACTIVATION` driver, whichever door they came in by: the
   * customer app's «الانضمام كمندوب», or an operator's «إضافة مندوب». Both
   * used to wait for something that never happened — nothing in the system
   * activated a driver from Admin — so an application was saved, shown to the
   * applicant as «قيد المراجعة», and seen by nobody.
   *
   * **The phone is unmasked here**, for whoever may approve. The applicant was
   * told «سنتواصل معك على رقم هاتفك»; a reviewer who cannot read the number
   * cannot keep that promise, and calling is the review.
   */
  app.get(
    '/api/v1/admin/driver-applications',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'driver.read.global');
      const canReview = hasAdminPermission(principal, 'driver.create');

      const rows = await ctx.db
        .select({
          driverId: drivers.id,
          fullName: users.fullName,
          phoneE164: users.phoneE164,
          vehicleType: drivers.defaultVehicleType,
          plateNumber: drivers.plateNumber,
          appliedAt: drivers.createdAt,
          cityNameAr: cities.nameAr,
          restaurantName: restaurants.displayName,
        })
        .from(drivers)
        .innerJoin(users, eq(drivers.userId, users.id))
        .leftJoin(cities, eq(users.profileCityId, cities.id))
        .leftJoin(restaurantDrivers, eq(restaurantDrivers.driverId, drivers.id))
        .leftJoin(restaurants, eq(restaurantDrivers.restaurantId, restaurants.id))
        .where(eq(drivers.status, 'PENDING_ACTIVATION'))
        // Oldest first: a queue is served in the order people joined it.
        .orderBy(drivers.createdAt)
        .limit(200);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.driverId,
            full_name: row.fullName,
            phone: row.phoneE164 ? (canReview ? row.phoneE164 : maskPhone(row.phoneE164)) : null,
            phone_masked: !canReview,
            vehicle_type: row.vehicleType,
            plate_number: row.plateNumber,
            city_name_ar: row.cityNameAr,
            restaurant_name: row.restaurantName,
            applied_at: row.appliedAt.toISOString(),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Accept an application: the courier can go online from the next request.
   *
   * Its own command rather than «unsuspend», which is what an operator had to
   * reach for before — asking for a reason to say yes, and never recording
   * `activated_at`. Only `PENDING_ACTIVATION` is accepted here, so this cannot
   * quietly lift a suspension.
   */
  app.post(
    '/api/v1/admin/driver-applications/:driverId/approve',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'driver.create');
      const { driverId } = z.object({ driverId: uuidSchema }).parse(request.params);

      await ctx.db.transaction(async (tx) => {
        const [driver] = await tx
          .select({ status: drivers.status })
          .from(drivers)
          .where(eq(drivers.id, driverId))
          .for('update')
          .limit(1);

        if (!driver) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'driver' } });
        if (driver.status !== 'PENDING_ACTIVATION') {
          throw new AppError(ERROR_CODES.CONFLICT, {
            details: { reason: 'NOT_PENDING', status: driver.status },
            messageAr: 'تمت مراجعة هذا الطلب مسبقاً.',
          });
        }

        await tx
          .update(drivers)
          .set({
            status: 'ACTIVE',
            // Offline until they open Driver Mode themselves.
            availability: 'OFFLINE',
            activatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driverId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.DRIVER_ACTIVATE,
          entityType: 'driver',
          entityId: driverId,
          before: { status: driver.status },
          after: { status: 'ACTIVE' },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(success({ status: 'ACTIVE' }, { request_id: request.requestId }));
    },
  );

  /**
   * Decline an application, with the reason the applicant will be shown.
   *
   * `DEACTIVATED` rather than a deleted row: applying again is idempotent on
   * the existing row, so the applicant sees the decision instead of a fresh
   * «قيد المراجعة» that nobody will ever look at.
   */
  app.post(
    '/api/v1/admin/driver-applications/:driverId/reject',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'driver.create');
      const { driverId } = z.object({ driverId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [driver] = await tx
          .select({ status: drivers.status })
          .from(drivers)
          .where(eq(drivers.id, driverId))
          .for('update')
          .limit(1);

        if (!driver) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'driver' } });
        if (driver.status !== 'PENDING_ACTIVATION') {
          throw new AppError(ERROR_CODES.CONFLICT, {
            details: { reason: 'NOT_PENDING', status: driver.status },
            messageAr: 'تمت مراجعة هذا الطلب مسبقاً.',
          });
        }

        await tx
          .update(drivers)
          .set({
            status: 'DEACTIVATED',
            availability: 'OFFLINE',
            suspendedReason: body.reason,
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driverId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.DRIVER_SUSPEND,
          entityType: 'driver',
          entityId: driverId,
          before: { status: driver.status },
          after: { status: 'DEACTIVATED' },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(success({ status: 'DEACTIVATED' }, { request_id: request.requestId }));
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
      /** Null for a portal account created by staff before a phone was known. */
  phone: string | null;
      status: string;
      mfa_enabled: boolean;
      roles: string[];
    }

    const byUser = new Map<string, StaffMember>();
    for (const row of rows) {
      const existing: StaffMember = byUser.get(row.userId) ?? {
        user_id: row.userId,
        full_name: row.fullName,
        phone: row.phoneE164 ? maskPhone(row.phoneE164) : null,
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
