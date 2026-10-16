import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, BUSY_MODES, ERROR_CODES, success } from '@jibli/contracts';
import { assertRestaurantPermission } from '@jibli/auth';
import { displayNameSchema, isoDateSchema, reasonSchema, uuidSchema } from '@jibli/validation';
import { evaluateOpenState, formatMinuteOfDay, WEEKDAY_NAMES_AR } from '@jibli/domain';
import {
  branchHourExceptions,
  branchLocationChangeRequests,
  branchWorkingHours,
  cities,
  governorates,
  restaurantBranches,
  restaurants,
  uuidv7,
} from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';

/**
 * Restaurant settings: working hours, busy mode, profile, relocation
 * (plan §17, §33, §105, §123).
 *
 * Two things are deliberately *not* editable here:
 *
 *   - **Commission** — that is a contractual term Admin owns (plan §24).
 *   - **City or governorate** — relocation is an approval workflow, not a
 *     dropdown edit, because "a restaurant cannot move from one active market
 *     to another simply by editing a dropdown after approval" (plan §123).
 */

const minuteSchema = z.number().int().min(0).max(1440);

export function registerRestaurantSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Current branch state, hours and computed open/closed status. */
  app.get(
    '/api/v1/restaurant-portal/settings',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.read');

      const [row] = await ctx.db
        .select({
          restaurant: restaurants,
          branch: restaurantBranches,
          cityNameAr: cities.nameAr,
          governorateNameAr: governorates.nameAr,
          cityOrderingEnabled: sql<boolean>`(${governorates.isEnabled} AND ${governorates.orderingEnabled} AND ${cities.isEnabled} AND ${cities.orderingEnabled})`,
        })
        .from(restaurants)
        .innerJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
        .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
        .innerJoin(governorates, eq(cities.governorateId, governorates.id))
        .where(and(eq(restaurants.id, restaurantId), isNull(restaurantBranches.deletedAt)))
        .limit(1);

      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

      const hours = await ctx.db
        .select()
        .from(branchWorkingHours)
        .where(eq(branchWorkingHours.branchId, row.branch.id))
        .orderBy(asc(branchWorkingHours.dayOfWeek), asc(branchWorkingHours.opensAtMinute));

      const exceptions = await ctx.db
        .select()
        .from(branchHourExceptions)
        .where(eq(branchHourExceptions.branchId, row.branch.id))
        .orderBy(asc(branchHourExceptions.localDate));

      // Computed server-side using server time, because the client's clock is
      // not authoritative for eligibility (plan §105).
      const openState = evaluateOpenState({
        rules: hours,
        exceptions: exceptions.map((exception) => ({
          localDate: exception.localDate,
          isClosed: exception.isClosed,
          opensAtMinute: exception.opensAtMinute,
          closesAtMinute: exception.closesAtMinute,
        })),
        busyMode: row.branch.busyMode,
        busyModeExpiresAt: row.branch.busyModeExpiresAt,
        basePreparationMinutes: row.branch.basePreparationMinutes,
      });

      return reply.send(
        success(
          {
            restaurant: {
              id: row.restaurant.id,
              display_name: row.restaurant.displayName,
              description_ar: row.restaurant.descriptionAr,
              /* URL rather than the raw id: the portal renders it, it does not look it up. */
              logo_url: row.restaurant.logoAssetId
                ? `/api/v1/assets/${row.restaurant.logoAssetId}`
                : null,
              /* The id as well: the phone stores it back on the product form's terms. */
              logo_asset_id: row.restaurant.logoAssetId,
              partner_code: row.restaurant.partnerCode,
              operational_status: row.restaurant.operationalStatus,
              cuisine_tags: row.restaurant.cuisineTags,
              minimum_order_iqd: row.restaurant.minimumOrderIqd,
            },
            branch: {
              id: row.branch.id,
              name: row.branch.name,
              address_text: row.branch.addressText,
              district_text: row.branch.districtText,
              city_name_ar: row.cityNameAr,
              governorate_name_ar: row.governorateNameAr,
              phone: row.branch.phone,
              latitude: row.branch.latitude,
              longitude: row.branch.longitude,
              is_active: row.branch.isActive,
              accepts_orders: row.branch.acceptsOrders,
              delivery_fee_iqd: row.branch.deliveryFeeIqd,
              base_preparation_minutes: row.branch.basePreparationMinutes,
              service_radius_meters: row.branch.serviceRadiusMeters,
            },
            busy_mode: openState.effectiveBusyMode,
            busy_mode_expires_at: row.branch.busyModeExpiresAt?.toISOString() ?? null,
            is_open: openState.isOpen,
            // The branch toggle is a hard gate the hours computation does not
            // know about: unticking «استقبال الطلبات» hides the shop from
            // customers, so the status line must say so rather than «يستقبل
            // الطلبات الآن» (MERCH-8).
            accepts_orders_now: row.branch.acceptsOrders && openState.acceptsOrders,
            estimated_preparation_minutes: openState.estimatedPreparationMinutes,
            closed_reason: row.branch.acceptsOrders ? openState.reason : 'NOT_ACCEPTING_ORDERS',
            city_ordering_enabled: row.cityOrderingEnabled,
            working_hours: hours.map((hour) => ({
              id: hour.id,
              day_of_week: hour.dayOfWeek,
              day_name_ar: WEEKDAY_NAMES_AR[hour.dayOfWeek],
              opens_at: formatMinuteOfDay(hour.opensAtMinute),
              closes_at: formatMinuteOfDay(hour.closesAtMinute),
              opens_at_minute: hour.opensAtMinute,
              closes_at_minute: hour.closesAtMinute,
              is_closed: hour.isClosed,
              // Overnight shifts are legitimate and must be shown as such, not
              // as a data-entry error (plan §33).
              is_overnight: hour.closesAtMinute < hour.opensAtMinute,
            })),
            hour_exceptions: exceptions.map((exception) => ({
              id: exception.id,
              local_date: exception.localDate,
              is_closed: exception.isClosed,
              opens_at:
                exception.opensAtMinute !== null
                  ? formatMinuteOfDay(exception.opensAtMinute)
                  : null,
              closes_at:
                exception.closesAtMinute !== null
                  ? formatMinuteOfDay(exception.closesAtMinute)
                  : null,
              note_ar: exception.noteAr,
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Replace the weekly schedule wholesale — simpler to reason about than diffs. */
  app.put(
    '/api/v1/restaurant-portal/settings/working-hours',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.write');
      const body = z
        .object({
          hours: z
            .array(
              z.object({
                day_of_week: z.number().int().min(0).max(6),
                opens_at_minute: minuteSchema,
                closes_at_minute: minuteSchema,
                is_closed: z.boolean().default(false),
              }),
            )
            .max(21),
        })
        .parse(request.body);

      // A zero-length window is a data error, and treating it as "always open"
      // would be the dangerous reading (mirrors the domain rule).
      for (const hour of body.hours) {
        if (!hour.is_closed && hour.opens_at_minute === hour.closes_at_minute) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            details: {
              day: hour.day_of_week,
              message: 'وقت الفتح والإغلاق متطابقان — حدّد فترة فعلية أو علّم اليوم كمغلق',
            },
          });
        }
      }

      await ctx.db.transaction(async (tx) => {
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

        if (!branch) {
          throw new AppError(ERROR_CODES.BRANCH_NOT_AVAILABLE, {
            details: { reason: 'NO_BRANCH' },
          });
        }

        await tx.delete(branchWorkingHours).where(eq(branchWorkingHours.branchId, branch.id));

        if (body.hours.length > 0) {
          await tx.insert(branchWorkingHours).values(
            body.hours.map((hour) => ({
              id: uuidv7(),
              branchId: branch.id,
              dayOfWeek: hour.day_of_week,
              opensAtMinute: hour.opens_at_minute,
              closesAtMinute: hour.closes_at_minute,
              isClosed: hour.is_closed,
            })),
          );
        }
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  /** Holiday or special-day override (plan §105). */
  app.post(
    '/api/v1/restaurant-portal/settings/hour-exceptions',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.write');
      const body = z
        .object({
          local_date: isoDateSchema,
          is_closed: z.boolean().default(true),
          opens_at_minute: minuteSchema.optional(),
          closes_at_minute: minuteSchema.optional(),
          note_ar: z.string().max(120).optional(),
        })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [branch] = await tx
          .select({ id: restaurantBranches.id })
          .from(restaurantBranches)
          .where(eq(restaurantBranches.restaurantId, restaurantId))
          .limit(1);

        if (!branch) {
          throw new AppError(ERROR_CODES.BRANCH_NOT_AVAILABLE, {
            details: { reason: 'NO_BRANCH' },
          });
        }

        await tx
          .insert(branchHourExceptions)
          .values({
            id: uuidv7(),
            branchId: branch.id,
            localDate: body.local_date,
            isClosed: body.is_closed,
            opensAtMinute: body.opens_at_minute ?? null,
            closesAtMinute: body.closes_at_minute ?? null,
            noteAr: body.note_ar ?? null,
          })
          .onConflictDoUpdate({
            target: [branchHourExceptions.branchId, branchHourExceptions.localDate],
            set: {
              isClosed: body.is_closed,
              opensAtMinute: body.opens_at_minute ?? null,
              closesAtMinute: body.closes_at_minute ?? null,
              noteAr: body.note_ar ?? null,
            },
          });
      });

      return reply.status(201).send(success({ saved: true }, { request_id: request.requestId }));
    },
  );

  app.delete(
    '/api/v1/restaurant-portal/settings/hour-exceptions/:exceptionId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.write');
      const { exceptionId } = z.object({ exceptionId: uuidSchema }).parse(request.params);

      const [branch] = await ctx.db
        .select({ id: restaurantBranches.id })
        .from(restaurantBranches)
        .where(eq(restaurantBranches.restaurantId, restaurantId))
        .limit(1);

      await ctx.db
        .delete(branchHourExceptions)
        .where(
          and(
            eq(branchHourExceptions.id, exceptionId),
            eq(branchHourExceptions.branchId, branch?.id ?? ''),
          ),
        );

      return reply.send(success({ deleted: true }, { request_id: request.requestId }));
    },
  );

  /**
   * Busy mode (plan §33).
   *
   * Auto-expiry is the point: staff switch to "very busy" during a rush and
   * forget, and without an expiry the restaurant quietly under-promises all day.
   */
  app.post(
    '/api/v1/restaurant-portal/settings/busy-mode',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'order.accept');
      const body = z
        .object({
          busy_mode: z.enum(BUSY_MODES),
          expires_in_minutes: z.number().int().min(5).max(480).optional(),
        })
        .parse(request.body);

      const expiresAt =
        body.busy_mode === 'NORMAL'
          ? null
          : new Date(Date.now() + (body.expires_in_minutes ?? 60) * 60_000);

      await ctx.db
        .update(restaurantBranches)
        .set({
          busyMode: body.busy_mode,
          busyModeExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(restaurantBranches.restaurantId, restaurantId));

      return reply.send(
        success(
          {
            busy_mode: body.busy_mode,
            expires_at: expiresAt?.toISOString() ?? null,
            note_ar:
              body.busy_mode === 'NORMAL'
                ? 'عاد المطعم إلى الوضع الطبيعي.'
                : `سيعود المطعم تلقائياً إلى الوضع الطبيعي بعد ${body.expires_in_minutes ?? 60} دقيقة.`,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Profile fields the restaurant owns. Commission and geography are excluded. */
  app.patch(
    '/api/v1/restaurant-portal/settings',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.write');
      const body = z
        .object({
          /**
           * The name, at last editable by the shop itself. Admin set it at
           * onboarding and a typo there was a support ticket; the same rule
           * as creation applies, so it cannot become empty or a novel.
           */
          display_name: displayNameSchema(2, 120).optional(),
          description_ar: z.string().max(300).optional(),
          /** Asset id from POST /api/v1/uploads. Null clears the logo. */
          logo_asset_id: uuidSchema.nullable().optional(),
          minimum_order_iqd: z.number().int().min(0).max(1_000_000).optional(),
          delivery_fee_iqd: z.number().int().min(0).max(1_000_000).optional(),
          base_preparation_minutes: z.number().int().min(5).max(240).optional(),
          service_radius_meters: z.number().int().min(500).max(50_000).nullable().optional(),
          phone: z.string().max(20).optional(),
          // Address text and pin are a correction, not a relocation (plan §123).
          address_text: z.string().min(5).max(300).optional(),
          district_text: z.string().max(120).optional(),
          accepts_orders: z.boolean().optional(),
          /** The shop's pin — accepted only while it has none; see below. */
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
        })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        /*
         * Every field that lives on the restaurant row, including the logo:
         * the guard used to name only two of them, so a request that changed
         * the picture alone — which is exactly what the picture control
         * sends — was accepted and saved nothing.
         */
        if (
          body.display_name !== undefined ||
          body.description_ar !== undefined ||
          body.logo_asset_id !== undefined ||
          body.minimum_order_iqd !== undefined
        ) {
          await tx
            .update(restaurants)
            .set({
              ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
              ...(body.description_ar !== undefined ? { descriptionAr: body.description_ar } : {}),
              ...(body.logo_asset_id !== undefined ? { logoAssetId: body.logo_asset_id } : {}),
              ...(body.minimum_order_iqd !== undefined
                ? { minimumOrderIqd: body.minimum_order_iqd }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(restaurants.id, restaurantId));
        }

        /*
         * The first pin, and only the first. A shop created without
         * coordinates may place itself on the map from the app; one that
         * already has a pin moves through the location-change request,
         * because relocating a live shop is a decision Admin reviews (§123).
         */
        const pin =
          body.latitude !== undefined && body.longitude !== undefined
            ? { latitude: body.latitude, longitude: body.longitude }
            : null;
        if (pin) {
          const [current] = await tx
            .select({
              latitude: restaurantBranches.latitude,
              longitude: restaurantBranches.longitude,
            })
            .from(restaurantBranches)
            .where(eq(restaurantBranches.restaurantId, restaurantId))
            .limit(1);
          if (current && current.latitude !== null && current.longitude !== null) {
            throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
              details: { reason: 'PIN_ALREADY_SET' },
              messageAr: 'موقع المتجر مثبّت أصلاً. لتغييره استخدم طلب تغيير الموقع من لوحة التحكم.',
            });
          }
        }

        await tx
          .update(restaurantBranches)
          .set({
            ...(pin ?? {}),
            ...(body.delivery_fee_iqd !== undefined
              ? { deliveryFeeIqd: body.delivery_fee_iqd }
              : {}),
            ...(body.base_preparation_minutes !== undefined
              ? { basePreparationMinutes: body.base_preparation_minutes }
              : {}),
            ...(body.service_radius_meters !== undefined
              ? { serviceRadiusMeters: body.service_radius_meters }
              : {}),
            ...(body.phone !== undefined ? { phone: body.phone } : {}),
            ...(body.address_text !== undefined ? { addressText: body.address_text } : {}),
            ...(body.district_text !== undefined ? { districtText: body.district_text } : {}),
            ...(body.accepts_orders !== undefined ? { acceptsOrders: body.accepts_orders } : {}),
            updatedAt: new Date(),
          })
          .where(eq(restaurantBranches.restaurantId, restaurantId));
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  /**
   * Request a move to another city (plan §17, §123).
   *
   * Submitting does not move anything — the current location stays live until
   * Admin decides, and historical orders keep their original snapshots.
   */
  app.post(
    '/api/v1/restaurant-portal/settings/location-change',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'restaurant.location.request_change');
      const body = z
        .object({
          requested_governorate_id: uuidSchema,
          requested_city_id: uuidSchema,
          requested_address_text: z.string().min(5).max(300),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
          reason: reasonSchema,
        })
        .parse(request.body);

      const id = await ctx.db.transaction(async (tx) => {
        const [branch] = await tx
          .select({
            id: restaurantBranches.id,
            governorateId: restaurantBranches.governorateId,
            cityId: restaurantBranches.cityId,
          })
          .from(restaurantBranches)
          .where(eq(restaurantBranches.restaurantId, restaurantId))
          .limit(1);

        if (!branch) {
          throw new AppError(ERROR_CODES.BRANCH_NOT_AVAILABLE, {
            details: { reason: 'NO_BRANCH' },
          });
        }

        // The composite FK would reject a mismatched pair; checking here gives
        // a usable message instead.
        const [city] = await tx
          .select({ governorateId: cities.governorateId })
          .from(cities)
          .where(eq(cities.id, body.requested_city_id))
          .limit(1);

        if (!city || city.governorateId !== body.requested_governorate_id) {
          throw new AppError(ERROR_CODES.CITY_GOVERNORATE_MISMATCH, {
            details: { cityId: body.requested_city_id },
          });
        }

        const requestId = uuidv7();
        await tx.insert(branchLocationChangeRequests).values({
          id: requestId,
          branchId: branch.id,
          requestedBy: principal.userId,
          currentGovernorateId: branch.governorateId,
          currentCityId: branch.cityId,
          requestedGovernorateId: body.requested_governorate_id,
          requestedCityId: body.requested_city_id,
          requestedAddressText: body.requested_address_text,
          requestedLatitude: body.latitude ?? null,
          requestedLongitude: body.longitude ?? null,
          status: 'PENDING',
        });

        return requestId;
      });

      return reply.status(201).send(
        success(
          {
            request_id: id,
            note_ar:
              'أُرسل طلب نقل الموقع للمراجعة. يبقى موقعك الحالي فعّالاً حتى صدور القرار، ولا تتأثر الطلبات أو التسويات السابقة.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );
}
