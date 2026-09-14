import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ACTIVE_DELIVERY_STATUSES,
  AppError,
  ERROR_CODES,
  EVENT_TYPES,
  RESTAURANT_ROLES,
  VEHICLE_TYPES,
  success,
} from '@jibli/contracts';
import {
  assertRestaurantPermission,
  generatePortalPassword,
  hashPassword,
  PASSWORD_MIN_LENGTH,
} from '@jibli/auth';
import {
  displayNameSchema,
  iraqiPhoneSchema,
  reasonSchema,
  usernameSchema,
  uuidSchema,
} from '@jibli/validation';
import { AUDIT_ACTIONS, computeCustody, enqueueOutboxEvent, writeAudit } from '@jibli/domain';
import {
  deliveryAssignments,
  driverCashEvents,
  drivers,
  restaurantBranches,
  restaurantDrivers,
  restaurantMembers,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';

/**
 * Restaurant drivers and staff (plan §45, §46, §61, §86).
 *
 * Drivers are created *by the restaurant* — there is no open driver
 * registration in Release 1. Creating one produces or links an identity, then
 * the driver activates it by OTP in the Jibli app (plan §45).
 */

export function registerRestaurantTeamRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ── Drivers ───────────────────────────────────────────────────────────────

  app.get(
    '/api/v1/restaurant-portal/drivers',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.read');

      const rows = await ctx.db
        .select({
          driverId: drivers.id,
          fullName: users.fullName,
          phone: users.phoneE164,
          status: drivers.status,
          availability: drivers.availability,
          vehicleType: drivers.defaultVehicleType,
          plateNumber: drivers.plateNumber,
          canCollectCash: restaurantDrivers.canCollectCash,
          isActive: restaurantDrivers.isActive,
          internalNote: restaurantDrivers.internalNote,
          activatedAt: drivers.activatedAt,
          lastHeartbeatAt: drivers.lastHeartbeatAt,
        })
        .from(restaurantDrivers)
        .innerJoin(drivers, eq(restaurantDrivers.driverId, drivers.id))
        .innerJoin(users, eq(drivers.userId, users.id))
        .where(eq(restaurantDrivers.restaurantId, restaurantId))
        .orderBy(desc(restaurantDrivers.createdAt));

      const driverIds = rows.map((row) => row.driverId);

      // Cash custody per driver — the restaurant's own money, which is exactly
      // why the restaurant needs to see it (plan §54).
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
          .where(
            and(
              inArray(driverCashEvents.driverId, driverIds),
              eq(driverCashEvents.restaurantId, restaurantId),
            ),
          );

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

      const activeByDriver = new Map<string, number>();
      if (driverIds.length > 0) {
        const active = await ctx.db
          .select({ driverId: deliveryAssignments.driverId, value: count() })
          .from(deliveryAssignments)
          .where(
            and(
              inArray(deliveryAssignments.driverId, driverIds),
              inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES]),
            ),
          )
          .groupBy(deliveryAssignments.driverId);

        for (const row of active) activeByDriver.set(row.driverId, row.value);
      }

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.driverId,
            full_name: row.fullName,
            phone: row.phone,
            status: row.status,
            availability: row.availability,
            vehicle_type: row.vehicleType,
            plate_number: row.plateNumber,
            can_collect_cash: row.canCollectCash,
            is_active: row.isActive,
            internal_note: row.internalNote,
            // PENDING_ACTIVATION means the driver has not yet signed in with
            // OTP — the most common "why isn't my driver working" question.
            activated: row.activatedAt !== null,
            active_assignments: activeByDriver.get(row.driverId) ?? 0,
            cash_custody_iqd: custodyByDriver.get(row.driverId) ?? 0,
            last_seen_at: row.lastHeartbeatAt?.toISOString() ?? null,
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Create a driver (plan §45).
   *
   * The restaurant enters the driver's Iraqi phone number. If that number
   * already has a Jibli identity — a customer, say — it is reused rather than
   * duplicated: one identity per phone.
   */
  app.post(
    '/api/v1/restaurant-portal/drivers',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.manage');
      const body = z
        .object({
          full_name: displayNameSchema(3, 80),
          phone: iraqiPhoneSchema,
          vehicle_type: z.enum(VEHICLE_TYPES).default('MOTORCYCLE'),
          plate_number: z.string().max(20).optional(),
          can_collect_cash: z.boolean().default(true),
          internal_note: z.string().max(200).optional(),
        })
        .parse(request.body);

      const result = await ctx.db.transaction(async (tx) => {
        const [branch] = await tx
          .select({ id: restaurantBranches.id })
          .from(restaurantBranches)
          .where(
            and(
              eq(restaurantBranches.restaurantId, restaurantId),
              isNull(restaurantBranches.deletedAt),
            ),
          )
          .limit(1);

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
            });
          }
          userId = existingUser.id;
          // Fill in a name only if the existing identity has none; overwriting
          // a customer's own name would be wrong.
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

        // A person may already be a driver for another restaurant; the driver
        // profile is per-identity, the membership is per-restaurant.
        const [existingDriver] = await tx
          .select({ id: drivers.id })
          .from(drivers)
          .where(eq(drivers.userId, userId))
          .limit(1);

        let driverId: string;
        if (existingDriver) {
          driverId = existingDriver.id;
        } else {
          driverId = uuidv7();
          await tx.insert(drivers).values({
            id: driverId,
            userId,
            // Not usable until the driver signs in with OTP (plan §45).
            status: 'PENDING_ACTIVATION',
            availability: 'OFFLINE',
            defaultVehicleType: body.vehicle_type,
            plateNumber: body.plate_number ?? null,
          });
        }

        const [existingMembership] = await tx
          .select({ id: restaurantDrivers.id })
          .from(restaurantDrivers)
          .where(
            and(
              eq(restaurantDrivers.restaurantId, restaurantId),
              eq(restaurantDrivers.driverId, driverId),
            ),
          )
          .limit(1);

        if (existingMembership) {
          throw new AppError(ERROR_CODES.CONFLICT, {
            details: { reason: 'DRIVER_ALREADY_IN_RESTAURANT' },
          });
        }

        await tx.insert(restaurantDrivers).values({
          id: uuidv7(),
          restaurantId,
          branchId: branch?.id ?? null,
          driverId,
          canCollectCash: body.can_collect_cash,
          isActive: true,
          internalNote: body.internal_note ?? null,
          createdBy: principal.userId,
        });

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.DRIVER_CREATE,
          entityType: 'driver',
          entityId: driverId,
          after: { restaurantId, canCollectCash: body.can_collect_cash },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.DRIVER_INVITED,
          aggregateType: 'driver',
          aggregateId: driverId,
          requestId: request.requestId,
          payload: { driverId, userId, restaurantId, branchId: branch?.id ?? null },
        });

        return { driverId, isNewIdentity: !existingUser };
      });

      return reply.status(201).send(
        success(
          {
            driver_id: result.driverId,
            note_ar:
              'أُنشئ حساب السائق. يفعّله السائق بنفسه بتسجيل الدخول في تطبيق جيبلي برقم هاتفه ورمز التحقق.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.patch(
    '/api/v1/restaurant-portal/drivers/:driverId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.manage');
      const { driverId } = z.object({ driverId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          can_collect_cash: z.boolean().optional(),
          is_active: z.boolean().optional(),
          internal_note: z.string().max(200).optional(),
          /**
           * On shift or not.
           *
           * Availability is the driver's own statement in Driver Mode, and for
           * a driver who uses the app it stays that way. But `assignable`
           * requires it, and a restaurant whose driver is standing in the
           * kitchen without the app installed could activate him and still not
           * hand him anything — the same dead end one layer down. The manager
           * can see who is there, so the manager may say so.
           *
           * Only the two states a person can assert about themselves. BUSY and
           * ON_DELIVERY are derived from live assignments: setting them by hand
           * would let the board lie about why somebody cannot take an order.
           */
          availability: z.enum(['AVAILABLE', 'OFFLINE']).optional(),
        })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        // Deactivating a driver mid-delivery would strand food and cash.
        if (body.is_active === false) {
          const [active] = await tx
            .select({ value: count() })
            .from(deliveryAssignments)
            .where(
              and(
                eq(deliveryAssignments.driverId, driverId),
                eq(deliveryAssignments.restaurantId, restaurantId),
                inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES]),
              ),
            );

          if ((active?.value ?? 0) > 0) {
            throw new AppError(ERROR_CODES.CONFLICT, {
              details: {
                reason: 'DRIVER_HAS_ACTIVE_DELIVERY',
                messageHint: 'أعد تعيين طلبات التوصيل النشطة قبل إيقاف السائق',
              },
            });
          }
        }

        /*
         * Membership first, and as its own check.
         *
         * It used to double as the guard: the UPDATE ran, and zero rows back
         * meant "not this restaurant's driver". That worked only while every
         * field lived on the membership row. The moment one of them did not —
         * availability is on the driver identity — a body carrying just that
         * field produced an `UPDATE ... SET` with nothing in it, which Drizzle
         * refuses, and the whole request came back as a bare INTERNAL_ERROR.
         */
        const [link] = await tx
          .select({ id: restaurantDrivers.id })
          .from(restaurantDrivers)
          .where(
            and(
              eq(restaurantDrivers.restaurantId, restaurantId),
              eq(restaurantDrivers.driverId, driverId),
            ),
          )
          .limit(1);

        if (!link) {
          throw new AppError(ERROR_CODES.DRIVER_NOT_IN_RESTAURANT, { details: { driverId } });
        }

        const membershipPatch = {
          ...(body.can_collect_cash !== undefined
            ? { canCollectCash: body.can_collect_cash }
            : {}),
          ...(body.is_active !== undefined
            ? {
                isActive: body.is_active,
                deactivatedAt: body.is_active ? null : new Date(),
              }
            : {}),
          ...(body.internal_note !== undefined ? { internalNote: body.internal_note } : {}),
        };

        if (Object.keys(membershipPatch).length > 0) {
          await tx
            .update(restaurantDrivers)
            .set(membershipPatch)
            .where(eq(restaurantDrivers.id, link.id));
        }

        /*
         * Availability lives on the driver identity, not on the membership, so
         * a driver shared between two restaurants is marked on shift for both.
         * That is what the column means — "this person is working now" is not a
         * per-restaurant fact — and release 1 has no shared drivers to trouble.
         */
        if (body.availability !== undefined) {
          await tx
            .update(drivers)
            .set({ availability: body.availability, updatedAt: new Date() })
            .where(eq(drivers.id, driverId));
        }
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  /**
   * Activate a driver the restaurant added.
   *
   * Nothing in the system set `activated_at` or moved a driver out of
   * `PENDING_ACTIVATION` — not this portal, not Admin, not the driver's own
   * sign-in. And `/drivers/eligible` filters on `status = 'ACTIVE'`, so every
   * driver ever created was invisible to the assignment picker and no order
   * could be handed to anybody. The whole delivery leg was a dead end, and the
   * symptom was an empty list with nothing to explain it.
   *
   * It belongs to the restaurant rather than to Admin. Jibli does not employ
   * these people: the restaurant recruits them, knows them, and is the party
   * asserting that this phone number belongs to somebody who has agreed to
   * carry its orders. Routing that assertion through a platform operator adds
   * a queue and no judgement — the operator has never met the driver.
   *
   * Two boundaries hold. Only `PENDING_ACTIVATION` may be activated here, so a
   * restaurant cannot lift a `SUSPENDED` that the platform imposed — that is
   * the one driver state which is not the restaurant's to decide. And the
   * driver must already be attached to this restaurant, so activation cannot
   * reach somebody else's team.
   */
  app.post(
    '/api/v1/restaurant-portal/drivers/:driverId/activate',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.manage');
      const { driverId } = z.object({ driverId: uuidSchema }).parse(request.params);

      const status = await ctx.db.transaction(async (tx) => {
        const [link] = await tx
          .select({ id: restaurantDrivers.id })
          .from(restaurantDrivers)
          .where(
            and(
              eq(restaurantDrivers.restaurantId, restaurantId),
              eq(restaurantDrivers.driverId, driverId),
            ),
          )
          .limit(1);

        if (!link) {
          throw new AppError(ERROR_CODES.DRIVER_NOT_IN_RESTAURANT, { details: { driverId } });
        }

        const [driver] = await tx
          .select({ status: drivers.status })
          .from(drivers)
          .where(eq(drivers.id, driverId))
          .limit(1);

        if (!driver) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'driver' } });

        // Already working: say so plainly rather than failing. Pressing the
        // button twice is not an error worth a red banner.
        if (driver.status === 'ACTIVE') return 'ACTIVE' as const;

        if (driver.status !== 'PENDING_ACTIVATION') {
          throw new AppError(ERROR_CODES.CONFLICT, {
            details: {
              reason: 'DRIVER_NOT_PENDING',
              status: driver.status,
              messageHint: 'هذا الحساب موقوف من إدارة جيبلي — راجع الدعم.',
            },
          });
        }

        await tx
          .update(drivers)
          .set({
            status: 'ACTIVE',
            activatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driverId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.DRIVER_ACTIVATE,
          entityType: 'driver',
          entityId: driverId,
          after: { status: 'ACTIVE', restaurantId },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        return 'ACTIVE' as const;
      });

      return reply.send(success({ status }, { request_id: request.requestId }));
    },
  );

  /**
   * Issue a driver their sign-in.
   *
   * A driver added here has a phone number and nothing else, and the only door
   * into the app was an OTP to that number. On a delivery phone that is often
   * the wrong door: the handset is shared, the code goes to whoever is holding
   * it, and a restaurant that has just hired somebody has to wait on an SMS to
   * put them to work. A username and a password the restaurant hands over in
   * person is the thing it was always going to do anyway.
   *
   * The password is generated, returned exactly once, and stored only as a
   * hash — the same contract `bootstrap-admin` has. `must_change_password` is
   * deliberately NOT set: this is read off a screen and repeated aloud to
   * somebody standing there, and forcing a change on a courier's first shift,
   * on a phone, in the street, is how the account ends up written on the wall.
   * Rotating it is one call away, and the restaurant owns that decision.
   */
  app.post(
    '/api/v1/restaurant-portal/drivers/:driverId/credentials',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.manage');
      const { driverId } = z.object({ driverId: uuidSchema }).parse(request.params);
      const body = z.object({ username: usernameSchema }).parse(request.body);

      const password = generatePortalPassword({
        minLength: PASSWORD_MIN_LENGTH,
        username: body.username,
      });
      const passwordHash = await hashPassword(password);

      await ctx.db.transaction(async (tx) => {
        const [link] = await tx
          .select({ id: restaurantDrivers.id })
          .from(restaurantDrivers)
          .where(
            and(
              eq(restaurantDrivers.restaurantId, restaurantId),
              eq(restaurantDrivers.driverId, driverId),
            ),
          )
          .limit(1);

        if (!link) {
          throw new AppError(ERROR_CODES.DRIVER_NOT_IN_RESTAURANT, { details: { driverId } });
        }

        const [driver] = await tx
          .select({ userId: drivers.userId })
          .from(drivers)
          .where(eq(drivers.id, driverId))
          .limit(1);

        if (!driver) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'driver' } });

        /*
         * A username is unique across every account in the system, so the
         * collision has to be reported as one rather than left to a constraint
         * error that reads as a server fault.
         */
        const [taken] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(sql`lower(${users.username}) = ${body.username}`, isNull(users.deletedAt)))
          .limit(1);

        if (taken && taken.id !== driver.userId) {
          throw new AppError(ERROR_CODES.CONFLICT, {
            details: {
              reason: 'USERNAME_TAKEN',
              messageHint: 'اسم المستخدم محجوز، اختر اسماً آخر',
            },
          });
        }

        await tx
          .update(users)
          .set({
            username: body.username,
            passwordHash,
            passwordChangedAt: new Date(),
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, driver.userId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.DRIVER_CREDENTIALS,
          entityType: 'driver',
          entityId: driverId,
          // Never the password, and never its hash.
          after: { username: body.username, restaurantId },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(
        success(
          {
            username: body.username,
            password,
            note_ar: 'تظهر كلمة المرور مرة واحدة فقط — سلّمها للمندوب الآن.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  // ── Staff (plan §61, §86) ─────────────────────────────────────────────────

  app.get(
    '/api/v1/restaurant-portal/staff',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'staff.read');

      const rows = await ctx.db
        .select({
          id: restaurantMembers.id,
          userId: restaurantMembers.userId,
          fullName: users.fullName,
          phone: users.phoneE164,
          role: restaurantMembers.role,
          isActive: restaurantMembers.isActive,
          createdAt: restaurantMembers.createdAt,
          invitedBy: restaurantMembers.invitedBy,
        })
        .from(restaurantMembers)
        .innerJoin(users, eq(restaurantMembers.userId, users.id))
        .where(eq(restaurantMembers.restaurantId, restaurantId))
        .orderBy(restaurantMembers.createdAt);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            user_id: row.userId,
            full_name: row.fullName,
            phone: row.phone,
            role: row.role,
            is_active: row.isActive,
            created_at: row.createdAt.toISOString(),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.post(
    '/api/v1/restaurant-portal/staff',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'staff.manage');
      const body = z
        .object({
          full_name: displayNameSchema(3, 80),
          phone: iraqiPhoneSchema,
          role: z.enum(RESTAURANT_ROLES),
        })
        .parse(request.body);

      // Only an existing OWNER may create another OWNER: otherwise a Manager
      // could escalate themselves to full financial access.
      if (body.role === 'OWNER') {
        const roles = principal.restaurantRoles[restaurantId] ?? [];
        if (!roles.includes('OWNER')) {
          throw new AppError(ERROR_CODES.FORBIDDEN, {
            details: { reason: 'ONLY_OWNER_CAN_CREATE_OWNER' },
          });
        }
      }

      const memberId = await ctx.db.transaction(async (tx) => {
        const [existingUser] = await tx
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(eq(users.phoneE164, body.phone))
          .limit(1);

        let userId: string;
        if (existingUser) {
          userId = existingUser.id;
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

        const id = uuidv7();
        try {
          await tx.insert(restaurantMembers).values({
            id,
            restaurantId,
            userId,
            role: body.role,
            isActive: true,
            invitedBy: principal.userId,
          });
        } catch (error) {
          // The unique index on (restaurant, user, role) caught a duplicate.
          if (
            typeof error === 'object' &&
            error !== null &&
            (error as { code?: string }).code === '23505'
          ) {
            throw new AppError(ERROR_CODES.CONFLICT, {
              details: { reason: 'STAFF_ALREADY_HAS_ROLE' },
            });
          }
          throw error;
        }

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.STAFF_INVITE,
          entityType: 'restaurant_member',
          entityId: id,
          after: { restaurantId, role: body.role },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        return id;
      });

      return reply.status(201).send(
        success(
          {
            id: memberId,
            note_ar: 'يسجّل الموظف الدخول إلى البوابة برقم هاتفه ورمز التحقق.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.patch(
    '/api/v1/restaurant-portal/staff/:memberId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'staff.manage');
      const { memberId } = z.object({ memberId: uuidSchema }).parse(request.params);
      const body = z
        .object({ is_active: z.boolean(), reason: reasonSchema.optional() })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [member] = await tx
          .select({
            id: restaurantMembers.id,
            role: restaurantMembers.role,
            userId: restaurantMembers.userId,
          })
          .from(restaurantMembers)
          .where(
            and(
              eq(restaurantMembers.id, memberId),
              eq(restaurantMembers.restaurantId, restaurantId),
            ),
          )
          .for('update')
          .limit(1);

        if (!member) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'member' } });

        // Never leave a restaurant without an active owner — nobody could then
        // manage staff or finance again.
        if (!body.is_active && member.role === 'OWNER') {
          const [owners] = await tx
            .select({ value: count() })
            .from(restaurantMembers)
            .where(
              and(
                eq(restaurantMembers.restaurantId, restaurantId),
                eq(restaurantMembers.role, 'OWNER'),
                eq(restaurantMembers.isActive, true),
              ),
            );

          if ((owners?.value ?? 0) <= 1) {
            throw new AppError(ERROR_CODES.CONFLICT, {
              details: {
                reason: 'LAST_OWNER',
                messageHint: 'لا يمكن إيقاف آخر مالك — عيّن مالكاً آخر أولاً',
              },
            });
          }
        }

        await tx
          .update(restaurantMembers)
          .set({
            isActive: body.is_active,
            deactivatedAt: body.is_active ? null : new Date(),
            updatedAt: new Date(),
          })
          .where(eq(restaurantMembers.id, memberId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.STAFF_DEACTIVATE,
          entityType: 'restaurant_member',
          entityId: memberId,
          after: { isActive: body.is_active },
          reason: body.reason ?? null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );
}
