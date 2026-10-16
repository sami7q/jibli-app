import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ALL_CATEGORY_KEYS,
  AppError,
  categoriesFor,
  ERROR_CODES,
  EVENT_TYPES,
  OPERATIONAL_STATUSES,
  success,
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  type MerchantType,
} from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { commissionFeeDisplay } from '@jibli/money';
import { displayNameSchema, iraqiPhoneSchema, reasonSchema, uuidSchema } from '@jibli/validation';
import {
  AUDIT_ACTIONS,
  describeWeekAr,
  enqueueOutboxEvent,
  formatMinuteOfDay,
  WEEKDAY_NAMES_AR,
  writeAudit,
} from '@jibli/domain';
import {
  branchWorkingHours,
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
import { jsonbArrayContains } from '../../lib/jsonb.js';
import { getConfig } from '../../services/config-service.js';
import { findOwnerPhone } from '../../services/owner-phone-service.js';
import { computeReadiness } from '../../services/readiness-service.js';
import {
  ensureDefaultWorkingHours,
  isSelfServeMerchant,
} from '../../services/working-hours-service.js';

/**
 * Admin restaurant management (plan §15.1, §69, §87).
 *
 * Every mutation is a named command with its own permission and audit action.
 * Suspension, commission changes and activation are distinct operations because
 * they carry different risk — a generic "update restaurant" endpoint would let
 * an Onboarding role change the commission.
 */

const listQuerySchema = z.object({
  q: z.string().max(80).optional(),
  status: z.enum(OPERATIONAL_STATUSES).optional(),
  governorate_id: uuidSchema.optional(),
  city_id: uuidSchema.optional(),
  /** One cuisine key; a restaurant matches if it carries the tag. */
  cuisine: z.string().max(40).optional(),
  /**
   * Restaurants or markets. Absent means both, which is what the directory
   * showed before markets existed and what an operator looking for a partner
   * by name still wants.
   */
  merchant_type: z.enum(MERCHANT_TYPES).optional(),
  /** Only the shops whose owner has asked, from the app, to go live. */
  activation_requested: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const createMerchantSchema = z
  .object({
    display_name: displayNameSchema(2, 120),
    /*
     * What is being created. Defaulted rather than required, because every
     * caller written before markets existed omits it and means a restaurant —
     * and because a field that must be filled in to create the common case is a
     * field that gets filled in wrongly.
     */
    merchant_type: z.enum(MERCHANT_TYPES).default('RESTAURANT'),
    owner_phone: iraqiPhoneSchema,
    owner_name: displayNameSchema(3, 80),
    governorate_id: uuidSchema,
    city_id: uuidSchema,
    address_text: z.string().min(5).max(300),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    /*
     * Optional, and normally absent. The commission is one platform-wide number
     * set in Admin > Settings; typing it again for each restaurant is how two
     * restaurants silently end up on different fees. It stays accepted so a
     * negotiated exception can still be recorded deliberately.
     */
    commission_flat_iqd: z.number().int().min(0).max(100_000).optional(),
    /** Asset id from POST /api/v1/uploads. */
    logo_asset_id: uuidSchema.optional(),
    settlement_policy: z.enum(['HALF_MONTH', 'MONTHLY']).default('HALF_MONTH'),
    minimum_order_iqd: z.number().int().min(0).default(0),
    delivery_fee_iqd: z.number().int().min(0).default(0),
    /*
     * Validated against the shipped vocabulary rather than accepting free text.
     * Free text is how "دجاج" and "الدجاج" became two categories, and how the
     * customer app's filters end up matching nothing.
     */
    cuisine_tags: z
      .array(z.enum(ALL_CATEGORY_KEYS as [string, ...string[]]))
      .max(4)
      .default([]),
    /** Required when the target city is not open for onboarding (plan §15.1). */
    override_coverage: z.boolean().default(false),
    reason: reasonSchema.optional(),
  })
  .superRefine((body, issue) => {
    /*
     * Each section tags from its own list. A cosmetics shop carrying «برغر»
     * would appear under a food filter in a storefront it is not in, which is
     * the same lie as the wrong shop in the wrong tab.
     */
    const allowed = new Set(categoriesFor(body.merchant_type).map((entry) => entry.key));
    body.cuisine_tags.forEach((tag, index) => {
      if (!allowed.has(tag)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cuisine_tags', index],
          message: `${tag} is not a category for ${body.merchant_type}`,
        });
      }
    });
  });

export function registerAdminRestaurantRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Restaurant directory with live operational counts. */
  app.get('/api/v1/admin/restaurants', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'restaurant.read');
    const query = listQuerySchema.parse(request.query);

    const conditions = [isNull(restaurants.deletedAt)];
    if (query.status) conditions.push(eq(restaurants.operationalStatus, query.status));
    if (query.merchant_type) {
      conditions.push(eq(restaurants.merchantType, query.merchant_type));
    }
    if (query.governorate_id) {
      conditions.push(eq(restaurantBranches.governorateId, query.governorate_id));
    }
    if (query.city_id) conditions.push(eq(restaurantBranches.cityId, query.city_id));
    if (query.activation_requested) {
      conditions.push(isNotNull(restaurants.activationRequestedAt));
    }
    if (query.cuisine) {
      // `cuisine_tags` is jsonb, not text[]; see lib/jsonb.ts for why that
      // distinction costs a helper.
      conditions.push(jsonbArrayContains(restaurants.cuisineTags, query.cuisine) as never);
    }
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
        merchantType: restaurants.merchantType,
        cuisineTags: restaurants.cuisineTags,
        activationRequestedAt: restaurants.activationRequestedAt,
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
        commissionFlatIqd: restaurantCommissionConfigs.commissionFlatIqd,
        /*
         * Whether anyone at this restaurant can actually sign in.
         *
         * A restaurant with no portal account is approved and invisible to its
         * own owner: it cannot set a menu, cannot see an order, cannot do
         * anything. That is not a detail of the detail screen — it belongs in
         * the row, next to the other reasons a restaurant is not trading.
         */
        hasPortalUser: sql<boolean>`EXISTS (
          SELECT 1 FROM ${restaurantMembers}
          JOIN ${users} ON ${users.id} = ${restaurantMembers.userId}
          WHERE ${restaurantMembers.restaurantId} = ${restaurants.id}
            AND ${users.username} IS NOT NULL
            AND ${users.deletedAt} IS NULL
        )`,
        /*
         * Who to call about this partner.
         *
         * The directory could say a restaurant was suspended, or had no portal
         * account, or had taken no order in a week — every one of which ends in
         * somebody picking up a phone — and the number was three clicks away on
         * the detail screen. It is one correlated subquery rather than a join
         * because a restaurant has several members and a join would multiply
         * the rows by them.
         *
         * OWNER specifically, not «any member»: a cashier's phone is not who
         * you call about a suspension. `ORDER BY created_at` so a restaurant
         * with two owners answers with the one who was there first, stably,
         * rather than with whichever row the planner happened to return.
         */
        ownerName: sql<string | null>`(
          SELECT ${users.fullName} FROM ${restaurantMembers}
          JOIN ${users} ON ${users.id} = ${restaurantMembers.userId}
          WHERE ${restaurantMembers.restaurantId} = ${restaurants.id}
            AND ${restaurantMembers.role} = 'OWNER'
            AND ${users.deletedAt} IS NULL
          ORDER BY ${restaurantMembers.createdAt}
          LIMIT 1
        )`,
        ownerPhone: sql<string | null>`(
          SELECT ${users.phoneE164} FROM ${restaurantMembers}
          JOIN ${users} ON ${users.id} = ${restaurantMembers.userId}
          WHERE ${restaurantMembers.restaurantId} = ${restaurants.id}
            AND ${restaurantMembers.role} = 'OWNER'
            AND ${users.deletedAt} IS NULL
          ORDER BY ${restaurantMembers.createdAt}
          LIMIT 1
        )`,
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
      // The queue is read oldest first: whoever has waited longest is next.
      .orderBy(
        query.activation_requested
          ? asc(restaurants.activationRequestedAt)
          : desc(restaurants.createdAt),
      )
      .limit(query.limit)
      .offset(query.offset);

    /*
     * The same joins as the page query, not a bare count of restaurants: a
     * total that ignores the filters reports 40 while the table shows 3, and
     * the pager built on it sends the operator to pages that do not exist.
     */
    const [total] = await ctx.db
      .select({ value: count() })
      .from(restaurants)
      .leftJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
      .where(and(...conditions));

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          display_name: row.displayName,
          merchant_type: row.merchantType,
          cuisine_tags: row.cuisineTags,
          activation_requested_at: row.activationRequestedAt?.toISOString() ?? null,
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
          has_portal_user: row.hasPortalUser,
          owner_name: row.ownerName,
          owner_phone: row.ownerPhone,
          commission_flat_iqd: row.commissionFlatIqd,
          commission_display:
            row.commissionFlatIqd === null ? null : commissionFeeDisplay(row.commissionFlatIqd),
          orders_7d: Number(row.orders7d),
          created_at: row.createdAt.toISOString(),
        })),
        { request_id: request.requestId, total: total?.value ?? 0, page_size: query.limit },
      ),
    );
  });

  /**
   * Restaurants by area, counted.
   *
   * "How many restaurants do we have in Karbala, and how many are actually
   * taking orders?" is a question the directory cannot answer by being paged
   * through, and it is the question that decides where to spend onboarding
   * effort. One grouped query rather than a count per city: a request per area
   * is how a coverage screen becomes slow the moment coverage grows.
   *
   * `active` here means the restaurant itself is ACTIVE. Whether it is visible
   * to customers depends on the city's ordering switch too, which is why that
   * is reported alongside rather than folded in — an operator looking at a
   * governorate with 12 active restaurants and no orders needs to see that the
   * city is closed.
   */
  app.get(
    '/api/v1/admin/restaurants/by-area',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'restaurant.read');

      const rows = await ctx.db
        .select({
          governorateId: governorates.id,
          governorateNameAr: governorates.nameAr,
          governorateEnabled: governorates.isEnabled,
          governorateOrdering: governorates.orderingEnabled,
          cityId: cities.id,
          cityNameAr: cities.nameAr,
          cityEnabled: cities.isEnabled,
          cityOrdering: cities.orderingEnabled,
          /*
           * DISTINCT because the join is on branches: a restaurant with two
           * branches in one city is one restaurant there, not two.
           */
          total: sql<number>`COUNT(DISTINCT ${restaurants.id})`,
          active: sql<number>`COUNT(DISTINCT ${restaurants.id}) FILTER (
            WHERE ${restaurants.operationalStatus} = 'ACTIVE'
          )`,
          accepting: sql<number>`COUNT(DISTINCT ${restaurants.id}) FILTER (
            WHERE ${restaurants.operationalStatus} = 'ACTIVE'
              AND ${restaurantBranches.isActive} = true
              AND ${restaurantBranches.acceptsOrders} = true
          )`,
        })
        .from(governorates)
        /*
         * Left joins all the way down, so a governorate Jibli has opened but
         * not yet filled still appears with a zero. An inner join would hide
         * exactly the areas that need attention.
         */
        .leftJoin(cities, eq(cities.governorateId, governorates.id))
        .leftJoin(
          restaurantBranches,
          and(eq(restaurantBranches.cityId, cities.id), isNull(restaurantBranches.deletedAt)),
        )
        .leftJoin(
          restaurants,
          and(eq(restaurants.id, restaurantBranches.restaurantId), isNull(restaurants.deletedAt)),
        )
        .groupBy(
          governorates.id,
          governorates.nameAr,
          governorates.isEnabled,
          governorates.orderingEnabled,
          cities.id,
          cities.nameAr,
          cities.isEnabled,
          cities.orderingEnabled,
        )
        .orderBy(governorates.nameAr, cities.nameAr);

      const byGovernorate = new Map<
        string,
        {
          id: string;
          name_ar: string;
          is_enabled: boolean;
          ordering_enabled: boolean;
          total: number;
          active: number;
          accepting: number;
          cities: {
            id: string;
            name_ar: string;
            is_enabled: boolean;
            ordering_enabled: boolean;
            total: number;
            active: number;
            accepting: number;
          }[];
        }
      >();

      for (const row of rows) {
        const entry = byGovernorate.get(row.governorateId) ?? {
          id: row.governorateId,
          name_ar: row.governorateNameAr,
          is_enabled: row.governorateEnabled,
          ordering_enabled: row.governorateOrdering,
          total: 0,
          active: 0,
          accepting: 0,
          cities: [],
        };

        const total = Number(row.total);
        const active = Number(row.active);
        const accepting = Number(row.accepting);

        entry.total += total;
        entry.active += active;
        entry.accepting += accepting;

        // A governorate with no cities yet produces one row with a null city.
        if (row.cityId) {
          entry.cities.push({
            id: row.cityId,
            name_ar: row.cityNameAr as string,
            is_enabled: row.cityEnabled as boolean,
            ordering_enabled: row.cityOrdering as boolean,
            total,
            active,
            accepting,
          });
        }

        byGovernorate.set(row.governorateId, entry);
      }

      return reply.send(success([...byGovernorate.values()], { request_id: request.requestId }));
    },
  );

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
        .where(eq(restaurantMembers.restaurantId, restaurantId))
        .orderBy(asc(restaurantMembers.createdAt));

      /*
       * The week, the number a password code would go to, and whether the
       * owner has asked to go live — the three facts the page used to lack
       * when an operator asked "why is this shop not open yet?".
       */
      const hours = row.branch
        ? await ctx.db
            .select({
              dayOfWeek: branchWorkingHours.dayOfWeek,
              opensAtMinute: branchWorkingHours.opensAtMinute,
              closesAtMinute: branchWorkingHours.closesAtMinute,
              isClosed: branchWorkingHours.isClosed,
            })
            .from(branchWorkingHours)
            .where(eq(branchWorkingHours.branchId, row.branch.id))
            .orderBy(asc(branchWorkingHours.dayOfWeek))
        : [];
      const recoveryPhone = await findOwnerPhone(ctx.db, restaurantId);

      return reply.send(
        success(
          {
            id: row.restaurant.id,
            display_name: row.restaurant.displayName,
            legal_name: row.restaurant.legalName,
            partner_code: row.restaurant.partnerCode,
            merchant_type: row.restaurant.merchantType,
            description_ar: row.restaurant.descriptionAr,
            onboarding_status: row.restaurant.onboardingStatus,
            operational_status: row.restaurant.operationalStatus,
            cuisine_tags: row.restaurant.cuisineTags,
            rating: row.restaurant.ratingAverage,
            rating_count: row.restaurant.ratingCount,
            minimum_order_iqd: row.restaurant.minimumOrderIqd,
            suspended_reason: row.restaurant.suspendedReason,
            approved_at: row.restaurant.approvedAt?.toISOString() ?? null,
            activation_requested_at: row.restaurant.activationRequestedAt?.toISOString() ?? null,
            activation_request_note: row.restaurant.activationRequestNote,
            /** Where the app sends the code when the owner changes the shop's password. */
            password_recovery_phone: recoveryPhone,
            working_hours: {
              configured: hours.length > 0,
              summary_ar: describeWeekAr(hours),
              rows: hours.map((hour) => ({
                day_of_week: hour.dayOfWeek,
                day_name_ar: WEEKDAY_NAMES_AR[hour.dayOfWeek],
                opens_at: formatMinuteOfDay(hour.opensAtMinute),
                closes_at: formatMinuteOfDay(hour.closesAtMinute),
                is_closed: hour.isClosed,
              })),
            },
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
              flat_iqd: config.commissionFlatIqd,
              commission_display: commissionFeeDisplay(config.commissionFlatIqd),
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
  app.post(
    '/api/v1/admin/restaurants',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.create');
      const body = createMerchantSchema.parse(request.body);

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
        /*
         * Resolved before the transaction opens, and falling back to the platform
         * default rather than to a number compiled into this file: an operator who
         * changes the commission in Settings expects the next restaurant to get it.
         */
        const commissionFlatIqd =
          body.commission_flat_iqd ?? (await getConfig(ctx, 'commission_flat_iqd', 500));

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
          /*
           * Which section of the app this shop sells in.
           *
           * It was written to the audit row below and never to this one, so
           * every market and cosmetics shop Admin created landed in the
           * database as a restaurant by the column's default: the customer
           * app listed it under food, and Owner Mode on the phone turned its
           * owner away with «إدارة المطاعم على المتصفّح». The form had asked
           * the right question and the answer went nowhere.
           */
          merchantType: body.merchant_type,
          onboardingStatus: 'APPROVED',
          // Approved on creation, but not yet trading: the readiness checklist
          // still has to pass before staff flip it to ACTIVE (plan §122).
          operationalStatus: 'PENDING',
          cuisineTags: body.cuisine_tags,
          minimumOrderIqd: body.minimum_order_iqd,
          approvedAt: now,
          approvedBy: principal.userId,
          ...(body.logo_asset_id ? { logoAssetId: body.logo_asset_id } : {}),
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

        // A shop opens on a default week; a kitchen still sets its own.
        if (isSelfServeMerchant(body.merchant_type)) {
          await ensureDefaultWorkingHours(tx, branchId);
        }

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
          commissionFlatIqd,
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
            merchantType: body.merchant_type,
            cityId: body.city_id,
            commissionFlatIqd,
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
    },
  );

  /**
   * Correct which section a shop sells in.
   *
   * Exists because of the bug fixed in the create route above: every market
   * and cosmetics shop Admin created before the fix is a restaurant in the
   * database, and the only way to move one was SQL. Same permission as
   * creating a shop — it is the same decision, made late.
   *
   * Tags from the old section are dropped rather than refused. The point of
   * the call is to get the shop into the right tab, and a market that was
   * filed under «برغر» by mistake should not have to be re-tagged before it
   * can stop being a restaurant. What was dropped is said back, so the
   * operator can tag it properly next.
   */
  app.patch(
    '/api/v1/admin/restaurants/:restaurantId/merchant-type',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.create');
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);
      const body = z
        .object({ merchant_type: z.enum(MERCHANT_TYPES), reason: reasonSchema })
        .parse(request.body);

      const outcome = await ctx.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            merchantType: restaurants.merchantType,
            cuisineTags: restaurants.cuisineTags,
            displayName: restaurants.displayName,
          })
          .from(restaurants)
          .where(and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)))
          .for('update')
          .limit(1);

        if (!current)
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

        const changed = current.merchantType !== body.merchant_type;
        const { kept, dropped } = tagsForMerchantType(current.cuisineTags, body.merchant_type);

        if (changed) {
          await tx
            .update(restaurants)
            .set({ merchantType: body.merchant_type, cuisineTags: kept, updatedAt: new Date() })
            .where(eq(restaurants.id, restaurantId));

          await writeAudit(tx, {
            actorUserId: principal.userId,
            action: AUDIT_ACTIONS.RESTAURANT_MERCHANT_TYPE_UPDATE,
            entityType: 'restaurant',
            entityId: restaurantId,
            before: { merchantType: current.merchantType, cuisineTags: current.cuisineTags },
            after: { merchantType: body.merchant_type, cuisineTags: kept },
            reason: body.reason,
            ip: clientIp(request),
            userAgent: userAgent(request),
            requestId: request.requestId,
          });
        }

        return { changed, dropped: changed ? dropped : [], displayName: current.displayName };
      });

      const kind = MERCHANT_TYPE_LABELS[body.merchant_type].nameAr;
      const noteAr = !outcome.changed
        ? `«${outcome.displayName}» مسجّل أصلاً بنوع ${kind}.`
        : outcome.dropped.length > 0
          ? `أصبح «${outcome.displayName}» ${kind}. أُزيلت ${outcome.dropped.length} من تصنيفاته لأنها لا تنتمي إلى هذا القسم — أضف تصنيفاته من جديد.`
          : `أصبح «${outcome.displayName}» ${kind}. يظهر الآن في القسم الصحيح داخل التطبيق، ويستطيع صاحبه إدارته من تطبيق جيبلي.`;

      return reply.send(
        success(
          {
            updated: outcome.changed,
            merchant_type: body.merchant_type,
            dropped_tags: outcome.dropped,
            note_ar: noteAr,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Change the commission (plan §24).
   *
   * Effective-dated: the current config is closed and a new one opened, so
   * historical orders keep the fee they were placed under. Requires a fresh
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
          commission_flat_iqd: z.number().int().min(0).max(100_000),
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
          commissionFlatIqd: body.commission_flat_iqd,
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
          before: current ? { commissionFlatIqd: current.commissionFlatIqd } : null,
          after: { commissionFlatIqd: body.commission_flat_iqd },
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
            note_ar:
              'الطلبات السابقة تحتفظ بقيمة العمولة التي سُجّلت عليها ولا تتأثر بهذا التغيير.',
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

        if (!current)
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

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
            merchantType: restaurants.merchantType,
          })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .for('update')
          .limit(1);

        if (!current)
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

        // The DB check constraint enforces this too; failing here gives a usable
        // Arabic message instead of a constraint violation.
        if (current.onboardingStatus !== 'APPROVED') {
          throw new AppError(ERROR_CODES.RESTAURANT_NOT_APPROVED, {
            details: { onboardingStatus: current.onboardingStatus },
          });
        }

        /*
         * The readiness checklist is the gate, not just the button (ADMIN-16).
         * Previously this endpoint activated a shop with no menu item at all,
         * which then showed in the app as open with nothing to order.
         */
        const readiness = await computeReadiness(ctx, restaurantId);
        if (readiness.blocking_failures.length > 0) {
          throw new AppError(ERROR_CODES.RESTAURANT_NOT_READY, {
            details: { blocking_failures: readiness.blocking_failures },
          });
        }

        /*
         * A market or cosmetics shop made before hours were defaulted at
         * creation goes live on the default week rather than closed.
         */
        if (isSelfServeMerchant(current.merchantType)) {
          const [branch] = await tx
            .select({ id: restaurantBranches.id })
            .from(restaurantBranches)
            .where(eq(restaurantBranches.restaurantId, restaurantId))
            .limit(1);
          if (branch) await ensureDefaultWorkingHours(tx, branch.id);
        }

        await tx
          .update(restaurants)
          .set({
            operationalStatus: 'ACTIVE',
            /* The request has been answered; leaving it set keeps a queue that never empties. */
            activationRequestedAt: null,
            activationRequestNote: null,
            suspendedAt: null,
            suspendedReason: null,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, restaurantId));

        /*
         * Enable the branch, but do not blindly force `accepts_orders` true
         * (ADMIN-16): on a reactivation that would override an owner who had
         * paused their own shop via the «استقبال الطلبات» toggle. Only a first
         * activation (operational status PENDING) turns ordering on, because a
         * fresh branch defaults to not accepting and has no other way to start.
         */
        const firstActivation = current.operationalStatus === 'PENDING';
        await tx
          .update(restaurantBranches)
          .set({
            isActive: true,
            ...(firstActivation ? { acceptsOrders: true } : {}),
            updatedAt: new Date(),
          })
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

/**
 * The tags a shop keeps when it moves to another section.
 *
 * Each section tags from its own vocabulary — `createMerchantSchema` refuses a
 * food cuisine on a cosmetics shop — so a shop that changes section keeps only
 * the tags that exist in the new one. Pure, and exported for the test beside
 * this file.
 */
export function tagsForMerchantType(
  tags: readonly string[],
  merchantType: MerchantType,
): { kept: string[]; dropped: string[] } {
  const allowed = new Set(categoriesFor(merchantType).map((entry) => entry.key));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const tag of tags) (allowed.has(tag) ? kept : dropped).push(tag);
  return { kept, dropped };
}
