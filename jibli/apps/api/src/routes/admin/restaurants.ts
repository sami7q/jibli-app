import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  AppError,
  ERROR_CODES,
  EVENT_TYPES,
  OPERATIONAL_STATUSES,
  success,
} from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { bpsPercent } from '@jibli/money';
import { displayNameSchema, iraqiPhoneSchema, reasonSchema, uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, enqueueOutboxEvent, writeAudit } from '@jibli/domain';
import {
  cities,
  governorates,
  orders,
  providers,
  restaurantBranches,
  restaurantCommissionConfigs,
  restaurantMembers,
  restaurants,
  users,
  uuidv7,
  type Transaction,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { effectiveCapabilitySql } from '../../services/geography-service.js';

/**
 * Admin restaurant management (plan §15.1, §69, §87).
 *
 * Every mutation is a named command with its own permission and audit action.
 * Suspension, commission changes and activation are distinct operations because
 * they carry different risk — a generic "update restaurant" endpoint would let
 * an Onboarding role change a commission rate.
 */

const listQuerySchema = z.object({
  q: z.string().max(80).optional(),
  status: z.enum(OPERATIONAL_STATUSES).optional(),
  city_id: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const createSchema = z.object({
  display_name: displayNameSchema(2, 120),
  owner_phone: iraqiPhoneSchema,
  owner_name: displayNameSchema(3, 80),
  governorate_id: uuidSchema,
  city_id: uuidSchema,
  address_text: z.string().min(5).max(300),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  commission_rate_bps: z.number().int().min(0).max(10_000).default(1500),
  settlement_policy: z.enum(['HALF_MONTH', 'MONTHLY']).default('HALF_MONTH'),
  minimum_order_iqd: z.number().int().min(0).default(0),
  delivery_fee_iqd: z.number().int().min(0).default(0),
  cuisine_tags: z.array(z.string().max(40)).max(10).default([]),
  /** Required when the target city is not open for onboarding (plan §15.1). */
  override_coverage: z.boolean().default(false),
  reason: reasonSchema.optional(),
});

export function registerAdminRestaurantRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Restaurant directory with live operational counts. */
  app.get('/api/v1/admin/restaurants', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'restaurant.read');
    const query = listQuerySchema.parse(request.query);

    const conditions = [isNull(restaurants.deletedAt)];
    if (query.status) conditions.push(eq(restaurants.operationalStatus, query.status));
    if (query.city_id) conditions.push(eq(restaurantBranches.cityId, query.city_id));
    if (query.q) {
      conditions.push(
        or(
          ilike(restaurants.displayName, `%${query.q}%`),
          ilike(restaurants.partnerCode, `%${query.q}%`),
        ) as never,
      );
    }

    const rows = await ctx.db
      .select({
        id: restaurants.id,
        displayName: restaurants.displayName,
        partnerCode: restaurants.partnerCode,
        onboardingStatus: restaurants.onboardingStatus,
        operationalStatus: restaurants.operationalStatus,
        ratingAverage: restaurants.ratingAverage,
        ratingCount: restaurants.ratingCount,
        createdAt: restaurants.createdAt,
        branchId: restaurantBranches.id,
        cityNameAr: cities.nameAr,
        governorateNameAr: governorates.nameAr,
        branchActive: restaurantBranches.isActive,
        acceptsOrders: restaurantBranches.acceptsOrders,
        cityOrderingEnabled: effectiveCapabilitySql('ordering'),
        commissionRateBps: restaurantCommissionConfigs.commissionRateBps,
        // Completed orders in the last 7 days — the number that says whether
        // this restaurant is actually trading.
        orders7d: sql<number>`(
          SELECT COUNT(*) FROM ${orders}
          WHERE ${orders.restaurantId} = ${restaurants.id}
            AND ${orders.status} = 'COMPLETED'
            AND ${orders.completedAt} >= now() - interval '7 days'
        )`,
      })
      .from(restaurants)
      .leftJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
      .leftJoin(cities, eq(restaurantBranches.cityId, cities.id))
      .leftJoin(governorates, eq(cities.governorateId, governorates.id))
      .leftJoin(
        restaurantCommissionConfigs,
        and(
          eq(restaurantCommissionConfigs.restaurantId, restaurants.id),
          isNull(restaurantCommissionConfigs.effectiveTo),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(restaurants.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const [total] = await ctx.db
      .select({ value: count() })
      .from(restaurants)
      .where(isNull(restaurants.deletedAt));

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          display_name: row.displayName,
          partner_code: row.partnerCode,
          onboarding_status: row.onboardingStatus,
          operational_status: row.operationalStatus,
          rating: row.ratingAverage,
          rating_count: row.ratingCount,
          city_name_ar: row.cityNameAr,
          governorate_name_ar: row.governorateNameAr,
          branch_active: row.branchActive,
          accepts_orders: row.acceptsOrders,
          // Surfaced so an operator can see why an ACTIVE restaurant is invisible.
          city_ordering_enabled: row.cityOrderingEnabled,
          commission_rate_bps: row.commissionRateBps,
          commission_display: row.commissionRateBps ? bpsPercent(row.commissionRateBps) : null,
          orders_7d: Number(row.orders7d),
          created_at: row.createdAt.toISOString(),
        })),
        { request_id: request.requestId, total: total?.value ?? 0, page_size: query.limit },
      ),
    );
  });

  /** One restaurant, with everything an operator needs on the detail screen. */
  app.get(
    '/api/v1/admin/restaurants/:restaurantId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'restaurant.read');
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

      const [row] = await ctx.db
        .select({
          restaurant: restaurants,
          branch: restaurantBranches,
          cityNameAr: cities.nameAr,
          governorateNameAr: governorates.nameAr,
          cityOrderingEnabled: effectiveCapabilitySql('ordering'),
        })
        .from(restaurants)
        .leftJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
        .leftJoin(cities, eq(restaurantBranches.cityId, cities.id))
        .leftJoin(governorates, eq(cities.governorateId, governorates.id))
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

      // Full commission history: a restaurant disputing a statement needs to see
      // which rate applied when (plan §24).
      const commissionHistory = await ctx.db
        .select()
        .from(restaurantCommissionConfigs)
        .where(eq(restaurantCommissionConfigs.restaurantId, restaurantId))
        .orderBy(desc(restaurantCommissionConfigs.effectiveFrom));

      const staff = await ctx.db
        .select({
          userId: restaurantMembers.userId,
          role: restaurantMembers.role,
          isActive: restaurantMembers.isActive,
          fullName: users.fullName,
          phone: users.phoneE164,
        })
        .from(restaurantMembers)
        .innerJoin(users, eq(restaurantMembers.userId, users.id))
        .where(eq(restaurantMembers.restaurantId, restaurantId));

      return reply.send(
        success(
          {
            id: row.restaurant.id,
            display_name: row.restaurant.displayName,
            legal_name: row.restaurant.legalName,
            partner_code: row.restaurant.partnerCode,
            description_ar: row.restaurant.descriptionAr,
            onboarding_status: row.restaurant.onboardingStatus,
            operational_status: row.restaurant.operationalStatus,
            cuisine_tags: row.restaurant.cuisineTags,
            rating: row.restaurant.ratingAverage,
            rating_count: row.restaurant.ratingCount,
            minimum_order_iqd: row.restaurant.minimumOrderIqd,
            suspended_reason: row.restaurant.suspendedReason,
            approved_at: row.restaurant.approvedAt?.toISOString() ?? null,
            branch: row.branch
              ? {
                  id: row.branch.id,
                  name: row.branch.name,
                  address_text: row.branch.addressText,
                  city_name_ar: row.cityNameAr,
                  governorate_name_ar: row.governorateNameAr,
                  latitude: row.branch.latitude,
                  longitude: row.branch.longitude,
                  phone: row.branch.phone,
                  is_active: row.branch.isActive,
                  accepts_orders: row.branch.acceptsOrders,
                  delivery_fee_iqd: row.branch.deliveryFeeIqd,
                }
              : null,
            city_ordering_enabled: row.cityOrderingEnabled,
            commission_history: commissionHistory.map((config) => ({
              rate_bps: config.commissionRateBps,
              rate_display: bpsPercent(config.commissionRateBps),
              settlement_policy: config.settlementPolicy,
              payment_term_days: config.paymentTermDays,
              effective_from: config.effectiveFrom.toISOString(),
              effective_to: config.effectiveTo?.toISOString() ?? null,
              is_current: config.effectiveTo === null,
            })),
            staff: staff.map((member) => ({
              user_id: member.userId,
              name: member.fullName,
              phone: member.phone,
              role: member.role,
              is_active: member.isActive,
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Admin-created restaurant (plan §15.1).
   *
   * Creates the provider, restaurant, branch, owner identity and membership,
   * and the initial commission config in one transaction.
   */
  app.post('/api/v1/admin/restaurants', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'restaurant.create');
    const body = createSchema.parse(request.body);

    const result = await ctx.db.transaction(async (tx) => {
      // Geography must be real and consistent; the composite FK would catch a
      // mismatch anyway, but a clear error beats a constraint violation.
      const [geo] = await tx
        .select({
          cityId: cities.id,
          governorateId: cities.governorateId,
          onboardingEnabled: effectiveCapabilitySql('restaurant_onboarding'),
        })
        .from(cities)
        .innerJoin(governorates, eq(cities.governorateId, governorates.id))
        .where(eq(cities.id, body.city_id))
        .limit(1);

      if (!geo) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'city' } });
      if (geo.governorateId !== body.governorate_id) {
        throw new AppError(ERROR_CODES.CITY_GOVERNORATE_MISMATCH, {
          details: { cityId: body.city_id },
        });
      }

      // "Only restaurant-onboarding-enabled geography may be selected under
      // normal operations. A Super Admin can configure a future location in a
      // disabled area only through an audited privileged override" (plan §15.1).
      if (!geo.onboardingEnabled) {
        if (!body.override_coverage) {
          throw new AppError(ERROR_CODES.RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY, {
            details: { cityId: body.city_id, canOverride: true },
          });
        }
        assertAdminPermission(principal, 'geography.manage');
        if (!body.reason) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            details: { field: 'reason', message: 'Coverage override requires a reason' },
          });
        }
      }

      // Reuse an existing identity if the owner already has a Jibli account —
      // one identity per phone (plan §45).
      const [existingOwner] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.phoneE164, body.owner_phone))
        .limit(1);

      let ownerUserId: string;
      if (existingOwner) {
        if (existingOwner.status !== 'ACTIVE') {
          throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED, {
            details: { reason: 'OWNER_ACCOUNT_NOT_ACTIVE' },
          });
        }
        ownerUserId = existingOwner.id;
      } else {
        ownerUserId = uuidv7();
        await tx.insert(users).values({
          id: ownerUserId,
          phoneE164: body.owner_phone,
          fullName: body.owner_name,
          status: 'ACTIVE',
        });
      }

      const providerId = uuidv7();
      const restaurantId = uuidv7();
      const branchId = uuidv7();
      const now = new Date();

      await tx.insert(providers).values({
        id: providerId,
        providerType: 'RESTAURANT',
        status: 'PENDING',
      });

      await tx.insert(restaurants).values({
        id: restaurantId,
        providerId,
        displayName: body.display_name,
        partnerCode: await nextPartnerCode(tx),
        onboardingStatus: 'APPROVED',
        // Approved on creation, but not yet trading: the readiness checklist
        // still has to pass before staff flip it to ACTIVE (plan §122).
        operationalStatus: 'PENDING',
        cuisineTags: body.cuisine_tags,
        minimumOrderIqd: body.minimum_order_iqd,
        approvedAt: now,
        approvedBy: principal.userId,
      });

      await tx.insert(restaurantBranches).values({
        id: branchId,
        restaurantId,
        name: body.display_name,
        governorateId: body.governorate_id,
        cityId: body.city_id,
        addressText: body.address_text,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        phone: body.owner_phone,
        isActive: false,
        acceptsOrders: false,
        deliveryFeeIqd: body.delivery_fee_iqd,
      });

      await tx.insert(restaurantMembers).values({
        id: uuidv7(),
        restaurantId,
        userId: ownerUserId,
        role: 'OWNER',
        isActive: true,
        invitedBy: principal.userId,
      });

      await tx.insert(restaurantCommissionConfigs).values({
        id: uuidv7(),
        restaurantId,
        commissionRateBps: body.commission_rate_bps,
        settlementPolicy: body.settlement_policy,
        effectiveFrom: now,
        createdBy: principal.userId,
      });

      await writeAudit(tx, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.RESTAURANT_CREATE,
        entityType: 'restaurant',
        entityId: restaurantId,
        after: {
          displayName: body.display_name,
          cityId: body.city_id,
          commissionRateBps: body.commission_rate_bps,
          coverageOverridden: !geo.onboardingEnabled,
        },
        reason: body.reason ?? null,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return { restaurantId, branchId, ownerUserId };
    });

    return reply.status(201).send(
      success(
        {
          restaurant_id: result.restaurantId,
          branch_id: result.branchId,
          owner_user_id: result.ownerUserId,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Change the commission rate (plan §24).
   *
   * Effective-dated: the current config is closed and a new one opened, so
   * historical orders keep the rate they were placed under. Requires a fresh
   * MFA challenge (plan §88).
   */
  app.patch(
    '/api/v1/admin/restaurants/:restaurantId/commission',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      // Step-up: assertAdminPermission raises REAUTHENTICATION_REQUIRED when the
      // session's MFA stamp is stale.
      assertAdminPermission(principal, 'restaurant.commission.update');

      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          commission_rate_bps: z.number().int().min(0).max(10_000),
          settlement_policy: z.enum(['HALF_MONTH', 'MONTHLY']).optional(),
          payment_term_days: z.number().int().min(0).max(90).optional(),
          reason: reasonSchema,
        })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(restaurantCommissionConfigs)
          .where(
            and(
              eq(restaurantCommissionConfigs.restaurantId, restaurantId),
              isNull(restaurantCommissionConfigs.effectiveTo),
            ),
          )
          .for('update')
          .limit(1);

        const now = new Date();

        // Close the open-ended config rather than editing it. The partial unique
        // index permits only one current row, so this ordering matters.
        if (current) {
          await tx
            .update(restaurantCommissionConfigs)
            .set({ effectiveTo: now })
            .where(eq(restaurantCommissionConfigs.id, current.id));
        }

        await tx.insert(restaurantCommissionConfigs).values({
          id: uuidv7(),
          restaurantId,
          commissionRateBps: body.commission_rate_bps,
          settlementPolicy: body.settlement_policy ?? current?.settlementPolicy ?? 'HALF_MONTH',
          paymentTermDays: body.payment_term_days ?? current?.paymentTermDays ?? 7,
          effectiveFrom: now,
          createdBy: principal.userId,
          note: body.reason,
        });

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.RESTAURANT_COMMISSION_UPDATE,
          entityType: 'restaurant',
          entityId: restaurantId,
          before: current ? { commissionRateBps: current.commissionRateBps } : null,
          after: { commissionRateBps: body.commission_rate_bps },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(
        success(
          {
            updated: true,
            // Stated back so the UI can reassure the operator (plan §24).
            note_ar: 'الطلبات السابقة تحتفظ بنسبة العمولة التي سُجّلت عليها ولا تتأثر بهذا التغيير.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Suspend a restaurant (plan §87). Historical data is untouched. */
  app.post(
    '/api/v1/admin/restaurants/:restaurantId/suspend',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.suspend');
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: restaurants.id,
            operationalStatus: restaurants.operationalStatus,
            displayName: restaurants.displayName,
          })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .for('update')
          .limit(1);

        if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

        await tx
          .update(restaurants)
          .set({
            operationalStatus: 'SUSPENDED',
            suspendedAt: new Date(),
            suspendedReason: body.reason,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, restaurantId));

        // Stop new orders immediately; in-flight orders are deliberately left
        // alone so food and cash are not stranded (plan §8.7 applied here).
        await tx
          .update(restaurantBranches)
          .set({ acceptsOrders: false, updatedAt: new Date() })
          .where(eq(restaurantBranches.restaurantId, restaurantId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.RESTAURANT_SUSPEND,
          entityType: 'restaurant',
          entityId: restaurantId,
          before: { operationalStatus: current.operationalStatus },
          after: { operationalStatus: 'SUSPENDED' },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.RESTAURANT_SUSPENDED,
          aggregateType: 'restaurant',
          aggregateId: restaurantId,
          requestId: request.requestId,
          payload: {
            restaurantId,
            displayName: current.displayName,
            ownerUserId: null,
            reason: body.reason,
          },
        });
      });

      return reply.send(success({ suspended: true }, { request_id: request.requestId }));
    },
  );

  /** Activate or reactivate a restaurant once readiness passes (plan §122). */
  app.post(
    '/api/v1/admin/restaurants/:restaurantId/activate',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.suspend');
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

      await ctx.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            operationalStatus: restaurants.operationalStatus,
            onboardingStatus: restaurants.onboardingStatus,
          })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .for('update')
          .limit(1);

        if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

        // The DB check constraint enforces this too; failing here gives a usable
        // Arabic message instead of a constraint violation.
        if (current.onboardingStatus !== 'APPROVED') {
          throw new AppError(ERROR_CODES.RESTAURANT_NOT_APPROVED, {
            details: { onboardingStatus: current.onboardingStatus },
          });
        }

        await tx
          .update(restaurants)
          .set({
            operationalStatus: 'ACTIVE',
            suspendedAt: null,
            suspendedReason: null,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, restaurantId));

        await tx
          .update(restaurantBranches)
          .set({ isActive: true, acceptsOrders: true, updatedAt: new Date() })
          .where(eq(restaurantBranches.restaurantId, restaurantId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.RESTAURANT_REACTIVATE,
          entityType: 'restaurant',
          entityId: restaurantId,
          before: { operationalStatus: current.operationalStatus },
          after: { operationalStatus: 'ACTIVE' },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(success({ activated: true }, { request_id: request.requestId }));
    },
  );
}

/**
 * Allocate a partner code.
 *
 * Sequential would leak how many restaurants Jibli has; random with a
 * uniqueness retry keeps it opaque. The unique index is the real guarantee.
 */
async function nextPartnerCode(tx: Transaction): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    const existing = await tx
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.partnerCode, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  // Exhausted the 4-digit space; widen rather than loop forever. The unique
  // index remains the real guarantee either way.
  return String(Math.floor(100_000 + Math.random() * 900_000));
}
