import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, EVENT_TYPES, success } from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { reasonSchema, uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, enqueueOutboxEvent, writeAudit } from '@jibli/domain';
import {
  auditLogs,
  cities,
  governorates,
  providers,
  restaurantApplications,
  restaurantBranches,
  restaurantCommissionConfigs,
  restaurantMembers,
  restaurants,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { getConfig } from '../../services/config-service.js';
import { computeReadiness } from '../../services/readiness-service.js';
import {
  ensureDefaultWorkingHours,
  isSelfServeMerchant,
} from '../../services/working-hours-service.js';
import {
  cityCoverageImpact,
  effectiveCapabilitySql,
  invalidateGeographyCache,
  listAllGovernorates,
  listCitiesForAdmin,
} from '../../services/geography-service.js';

/**
 * Admin Portal API (plan §67, §69, §73, §127).
 *
 * Every mutation here is a named command with its own permission and audit
 * action. There is no generic "patch any field" endpoint.
 */

const capabilityPatchSchema = z.object({
  is_enabled: z.boolean().optional(),
  customer_signup_enabled: z.boolean().optional(),
  restaurant_onboarding_enabled: z.boolean().optional(),
  ordering_enabled: z.boolean().optional(),
  reason: reasonSchema.optional(),
});

/**
 * Turning a capability OFF is high-impact and needs a written reason
 * (plan §8.8, §114). Turning one ON does not.
 */
function requiresReason(
  patch: z.infer<typeof capabilityPatchSchema>,
  current: Record<string, unknown>,
): boolean {
  const fields = [
    ['is_enabled', 'isEnabled'],
    ['customer_signup_enabled', 'customerSignupEnabled'],
    ['restaurant_onboarding_enabled', 'restaurantOnboardingEnabled'],
    ['ordering_enabled', 'orderingEnabled'],
  ] as const;

  return fields.some(([bodyKey, rowKey]) => {
    const next = patch[bodyKey];
    return next === false && current[rowKey] === true;
  });
}

export function registerAdminGeographyRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ── Geography (plan §8.8, §67) ────────────────────────────────────────────

  app.get(
    '/api/v1/admin/geography/governorates',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'geography.read');
      const rows = await listAllGovernorates(ctx);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            code: row.code,
            name_ar: row.nameAr,
            is_enabled: row.isEnabled,
            customer_signup_enabled: row.customerSignupEnabled,
            restaurant_onboarding_enabled: row.restaurantOnboardingEnabled,
            ordering_enabled: row.orderingEnabled,
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.get(
    '/api/v1/admin/geography/cities',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'geography.read');
      const query = z.object({ governorate_id: uuidSchema.optional() }).parse(request.query);

      const rows = await listCitiesForAdmin(ctx, query.governorate_id);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            governorate_id: row.governorateId,
            code: row.code,
            name_ar: row.nameAr,
            is_enabled: row.isEnabled,
            customer_signup_enabled: row.customerSignupEnabled,
            restaurant_onboarding_enabled: row.restaurantOnboardingEnabled,
            ordering_enabled: row.orderingEnabled,
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Impact preview shown before a disable is confirmed (plan §114). */
  app.get(
    '/api/v1/admin/geography/cities/:cityId/impact',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'geography.read');
      const { cityId } = z.object({ cityId: uuidSchema }).parse(request.params);
      const impact = await cityCoverageImpact(ctx, cityId);

      return reply.send(
        success(
          {
            active_restaurants: impact.activeRestaurants,
            active_orders: impact.activeOrders,
            customer_profiles: impact.customerProfiles,
            // Stated plainly so the confirmation dialog can quote it (plan §114).
            note_ar:
              'تعطيل الطلبات لا يحذف أي بيانات. الطلبات النشطة الحالية تكمل مسارها بشكل طبيعي.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.patch(
    '/api/v1/admin/geography/governorates/:governorateId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'geography.manage');
      const { governorateId } = z.object({ governorateId: uuidSchema }).parse(request.params);
      const body = capabilityPatchSchema.parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(governorates)
          .where(eq(governorates.id, governorateId))
          .limit(1);

        if (!current) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'governorate' } });
        }

        if (requiresReason(body, current) && !body.reason) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            details: { field: 'reason', message: 'Disabling coverage requires a reason' },
          });
        }

        const patch = {
          ...(body.is_enabled !== undefined ? { isEnabled: body.is_enabled } : {}),
          ...(body.customer_signup_enabled !== undefined
            ? { customerSignupEnabled: body.customer_signup_enabled }
            : {}),
          ...(body.restaurant_onboarding_enabled !== undefined
            ? { restaurantOnboardingEnabled: body.restaurant_onboarding_enabled }
            : {}),
          ...(body.ordering_enabled !== undefined
            ? { orderingEnabled: body.ordering_enabled }
            : {}),
          updatedAt: new Date(),
        };

        await tx.update(governorates).set(patch).where(eq(governorates.id, governorateId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.GEOGRAPHY_GOVERNORATE_UPDATE,
          entityType: 'governorate',
          entityId: governorateId,
          before: current,
          after: { ...current, ...patch },
          reason: body.reason ?? null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.GEOGRAPHY_CAPABILITY_CHANGED,
          aggregateType: 'geography',
          aggregateId: governorateId,
          requestId: request.requestId,
          payload: {
            entityType: 'governorate',
            entityId: governorateId,
            code: current.code,
            nameAr: current.nameAr,
            changes: diffCapabilities(current, patch),
            reason: body.reason ?? null,
          },
        });
      });

      await invalidateGeographyCache(ctx);

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  app.patch(
    '/api/v1/admin/geography/cities/:cityId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'geography.manage');
      const { cityId } = z.object({ cityId: uuidSchema }).parse(request.params);
      const body = capabilityPatchSchema.parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [current] = await tx.select().from(cities).where(eq(cities.id, cityId)).limit(1);
        if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'city' } });

        if (requiresReason(body, current) && !body.reason) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            details: { field: 'reason', message: 'Disabling coverage requires a reason' },
          });
        }

        const patch = {
          ...(body.is_enabled !== undefined ? { isEnabled: body.is_enabled } : {}),
          ...(body.customer_signup_enabled !== undefined
            ? { customerSignupEnabled: body.customer_signup_enabled }
            : {}),
          ...(body.restaurant_onboarding_enabled !== undefined
            ? { restaurantOnboardingEnabled: body.restaurant_onboarding_enabled }
            : {}),
          ...(body.ordering_enabled !== undefined
            ? { orderingEnabled: body.ordering_enabled }
            : {}),
          updatedAt: new Date(),
        };

        await tx.update(cities).set(patch).where(eq(cities.id, cityId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.GEOGRAPHY_CITY_UPDATE,
          entityType: 'city',
          entityId: cityId,
          before: current,
          after: { ...current, ...patch },
          reason: body.reason ?? null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.GEOGRAPHY_CAPABILITY_CHANGED,
          aggregateType: 'geography',
          aggregateId: cityId,
          requestId: request.requestId,
          payload: {
            entityType: 'city',
            entityId: cityId,
            code: current.code,
            nameAr: current.nameAr,
            changes: diffCapabilities(current, patch),
            reason: body.reason ?? null,
          },
        });
      });

      await invalidateGeographyCache(ctx);

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  /** Coverage matrix (plan §127). */
  app.get(
    '/api/v1/admin/geography/coverage-summary',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'geography.read');

      const rows = await ctx.db
        .select({
          governorateNameAr: governorates.nameAr,
          cityId: cities.id,
          cityNameAr: cities.nameAr,
          customerSignup: effectiveCapabilitySql('customer_signup'),
          restaurantOnboarding: effectiveCapabilitySql('restaurant_onboarding'),
          ordering: effectiveCapabilitySql('ordering'),
          approvedRestaurants: sql<number>`(
            SELECT COUNT(*) FROM ${restaurantBranches}
            INNER JOIN ${restaurants} ON ${restaurants.id} = ${restaurantBranches.restaurantId}
            WHERE ${restaurantBranches.cityId} = ${cities.id}
              AND ${restaurants.onboardingStatus} = 'APPROVED'
          )`,
          activeRestaurants: sql<number>`(
            SELECT COUNT(*) FROM ${restaurantBranches}
            INNER JOIN ${restaurants} ON ${restaurants.id} = ${restaurantBranches.restaurantId}
            WHERE ${restaurantBranches.cityId} = ${cities.id}
              AND ${restaurants.operationalStatus} = 'ACTIVE'
              AND ${restaurantBranches.isActive} = true
          )`,
          customers: sql<number>`(
            SELECT COUNT(*) FROM ${users} WHERE ${users.profileCityId} = ${cities.id}
          )`,
        })
        .from(cities)
        .innerJoin(governorates, eq(cities.governorateId, governorates.id))
        .orderBy(governorates.sortOrder, cities.sortOrder);

      return reply.send(
        success(
          rows.map((row) => ({
            governorate_name_ar: row.governorateNameAr,
            city_id: row.cityId,
            city_name_ar: row.cityNameAr,
            // Effective values: the parent override is already applied in SQL.
            customer_signup: row.customerSignup,
            restaurant_onboarding: row.restaurantOnboarding,
            ordering: row.ordering,
            approved_restaurants: Number(row.approvedRestaurants),
            active_restaurants: Number(row.activeRestaurants),
            customers: Number(row.customers),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  // ── Restaurant onboarding (plan §69) ──────────────────────────────────────

  app.get(
    '/api/v1/admin/restaurants/applications',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'restaurant.read');
      const query = z
        .object({
          status: z
            .enum(['DRAFT', 'UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED'])
            .optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        })
        .parse(request.query);

      const rows = await ctx.db
        .select({
          application: restaurantApplications,
          cityNameAr: cities.nameAr,
          governorateNameAr: governorates.nameAr,
          cityOnboardingEnabled: effectiveCapabilitySql('restaurant_onboarding'),
        })
        .from(restaurantApplications)
        .innerJoin(cities, eq(restaurantApplications.cityId, cities.id))
        .innerJoin(governorates, eq(restaurantApplications.governorateId, governorates.id))
        .where(query.status ? eq(restaurantApplications.status, query.status) : undefined)
        .orderBy(desc(restaurantApplications.createdAt))
        .limit(query.limit);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.application.id,
            display_name: row.application.displayName,
            contact_phone: row.application.contactPhoneE164,
            // Present on self-service applications; null on rows Admin created.
            applicant_name: row.application.applicantName,
            applicant_note: row.application.applicantNote,
            cuisine_tags: row.application.cuisineTags,
            merchant_type: row.application.merchantType,
            governorate_name_ar: row.governorateNameAr,
            city_name_ar: row.cityNameAr,
            address_text: row.application.addressText,
            status: row.application.status,
            created_at: row.application.createdAt.toISOString(),
            // Approval is blocked by default if the city closed since submission
            // (plan §15.2) — surface it as a coverage warning in the list.
            coverage_warning: !row.cityOnboardingEnabled,
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Approve an application (plan §69).
   *
   * Approval is a command, not a status patch: it creates the provider,
   * restaurant, branch, owner membership, commission config and audit entry.
   */
  app.post(
    '/api/v1/admin/restaurants/applications/:applicationId/approve',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.approve');
      const { applicationId } = z.object({ applicationId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          commission_flat_iqd: z.number().int().min(0).max(100_000).optional(),
          settlement_policy: z.enum(['HALF_MONTH', 'MONTHLY']).default('HALF_MONTH'),
          override_coverage: z.boolean().default(false),
          reason: reasonSchema.optional(),
        })
        .parse(request.body ?? {});

      /*
       * Read before the transaction opens: the approved restaurant starts on
       * the platform-wide commission unless this approval negotiates its own.
       */
      const commissionFlatIqd =
        body.commission_flat_iqd ?? (await getConfig(ctx, 'commission_flat_iqd', 500));

      const result = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            application: restaurantApplications,
            cityOnboardingEnabled: effectiveCapabilitySql('restaurant_onboarding'),
          })
          .from(restaurantApplications)
          .innerJoin(cities, eq(restaurantApplications.cityId, cities.id))
          .innerJoin(governorates, eq(restaurantApplications.governorateId, governorates.id))
          .where(eq(restaurantApplications.id, applicationId))
          .for('update')
          .limit(1);

        if (!row) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'application' } });
        }

        const application = row.application;
        if (application.status === 'APPROVED') {
          throw new AppError(ERROR_CODES.RESTAURANT_APPLICATION_INVALID_STATE, {
            details: { status: application.status },
          });
        }

        // "If a city is disabled after application but before approval, approval
        // is blocked by default" (plan §15.2). A Super Admin may override with
        // a reason, and the restaurant still cannot take orders while the city
        // is closed — eligibility is evaluated independently at checkout.
        if (!row.cityOnboardingEnabled && !body.override_coverage) {
          throw new AppError(ERROR_CODES.RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY, {
            details: { cityId: application.cityId, canOverride: true },
          });
        }
        if (!row.cityOnboardingEnabled && body.override_coverage && !body.reason) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            details: { field: 'reason', message: 'Coverage override requires a reason' },
          });
        }

        const now = new Date();
        const providerId = uuidv7();
        const restaurantId = uuidv7();
        const branchId = uuidv7();

        await tx.insert(providers).values({
          id: providerId,
          providerType: 'RESTAURANT',
          status: 'PENDING',
        });

        await tx.insert(restaurants).values({
          id: restaurantId,
          providerId,
          displayName: application.displayName,
          partnerCode: String(Math.floor(1000 + Math.random() * 9000)),
          onboardingStatus: 'APPROVED',
          // Approved, but not orderable until the readiness checklist passes
          // and staff activate it (plan §122).
          operationalStatus: 'PENDING',
          cuisineTags: application.cuisineTags,
          // The tab it appears in is the one it applied for.
          merchantType: application.merchantType,
          approvedAt: now,
          approvedBy: principal.userId,
        });

        await tx.insert(restaurantBranches).values({
          id: branchId,
          restaurantId,
          name: application.displayName,
          governorateId: application.governorateId,
          cityId: application.cityId,
          addressText: application.addressText,
          latitude: application.latitude,
          longitude: application.longitude,
          phone: application.contactPhoneE164,
          isActive: false,
          acceptsOrders: false,
        });

        // A shop opens on a default week; a kitchen still sets its own.
        if (isSelfServeMerchant(application.merchantType)) {
          await ensureDefaultWorkingHours(tx, branchId);
        }

        /*
         * Who owns this restaurant.
         *
         * An application created by Admin carries the applicant; a self-service
         * one carries only a phone number, because requiring an account to ask
         * for an account is the loop the public form exists to break.
         *
         * Resolved by phone, with the same rule the restaurant portal applies
         * when it adds a driver: one number is one person. A restaurant owner
         * who already orders from Jibli keeps the identity they have.
         */
        let ownerUserId = application.applicantUserId;

        if (!ownerUserId) {
          const [existing] = await tx
            .select({ id: users.id, fullName: users.fullName, status: users.status })
            .from(users)
            .where(eq(users.phoneE164, application.contactPhoneE164))
            .limit(1);

          if (existing) {
            if (existing.status !== 'ACTIVE') {
              throw new AppError(ERROR_CODES.CONFLICT, {
                details: { reason: 'APPLICANT_ACCOUNT_SUSPENDED' },
                messageAr: 'الرقم المرتبط بالطلب يعود لحساب موقوف',
              });
            }
            ownerUserId = existing.id;
            // Only fills a gap; a name the person chose is never overwritten.
            if (!existing.fullName && application.applicantName) {
              await tx
                .update(users)
                .set({ fullName: application.applicantName, updatedAt: new Date() })
                .where(eq(users.id, ownerUserId));
            }
          } else {
            ownerUserId = uuidv7();
            await tx.insert(users).values({
              id: ownerUserId,
              phoneE164: application.contactPhoneE164,
              fullName: application.applicantName,
              status: 'ACTIVE',
            });
          }
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

        await tx
          .update(restaurantApplications)
          .set({
            status: 'APPROVED',
            restaurantId,
            reviewedBy: principal.userId,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(restaurantApplications.id, applicationId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.RESTAURANT_APPROVE,
          entityType: 'restaurant',
          entityId: restaurantId,
          before: { applicationId, status: application.status },
          after: { restaurantId, branchId, coverageOverridden: !row.cityOnboardingEnabled },
          reason: body.reason ?? null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.RESTAURANT_APPROVED,
          aggregateType: 'restaurant',
          aggregateId: restaurantId,
          requestId: request.requestId,
          payload: {
            restaurantId,
            displayName: application.displayName,
            ownerUserId,
          },
        });

        return { restaurantId, branchId };
      });

      return reply
        .status(201)
        .send(
          success(
            { restaurant_id: result.restaurantId, branch_id: result.branchId },
            { request_id: request.requestId },
          ),
        );
    },
  );

  app.post(
    '/api/v1/admin/restaurants/applications/:applicationId/reject',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.reject');
      const { applicationId } = z.object({ applicationId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [application] = await tx
          .select()
          .from(restaurantApplications)
          .where(eq(restaurantApplications.id, applicationId))
          .limit(1);

        if (!application) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'application' } });
        }

        // Only a live application can be rejected (ADMIN-13). Rejecting an
        // already-APPROVED one told the applicant «لم يُقبل» while the shop they
        // now own existed.
        if (!['UNDER_REVIEW', 'INFO_REQUESTED'].includes(application.status)) {
          throw new AppError(ERROR_CODES.RESTAURANT_APPLICATION_INVALID_STATE, {
            details: { status: application.status },
          });
        }

        await tx
          .update(restaurantApplications)
          .set({
            status: 'REJECTED',
            rejectionReason: body.reason,
            reviewedBy: principal.userId,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(restaurantApplications.id, applicationId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.RESTAURANT_REJECT,
          entityType: 'restaurant_application',
          entityId: applicationId,
          before: { status: application.status },
          after: { status: 'REJECTED' },
          reason: body.reason,
          requestId: request.requestId,
        });

        // The applicant is told, as the dialog promises (ADMIN-13).
        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.RESTAURANT_REJECTED,
          aggregateType: 'restaurant',
          aggregateId: applicationId,
          requestId: request.requestId,
          payload: {
            restaurantId: applicationId,
            displayName: application.displayName,
            ownerUserId: application.applicantUserId,
            reason: body.reason,
          },
        });
      });

      return reply.send(success({ rejected: true }, { request_id: request.requestId }));
    },
  );

  /**
   * Ask the applicant for more information (ADMIN-13).
   *
   * The app already handles INFO_REQUESTED («نحتاج معلومة إضافية») but no admin
   * route set it. Moves the application into that state, records the note, and
   * tells the applicant.
   */
  app.post(
    '/api/v1/admin/restaurants/applications/:applicationId/request-info',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.reject');
      const { applicationId } = z.object({ applicationId: uuidSchema }).parse(request.params);
      const body = z.object({ message: z.string().trim().min(3).max(500) }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [application] = await tx
          .select()
          .from(restaurantApplications)
          .where(eq(restaurantApplications.id, applicationId))
          .limit(1);

        if (!application) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'application' } });
        }
        if (!['UNDER_REVIEW', 'INFO_REQUESTED'].includes(application.status)) {
          throw new AppError(ERROR_CODES.RESTAURANT_APPLICATION_INVALID_STATE, {
            details: { status: application.status },
          });
        }

        await tx
          .update(restaurantApplications)
          .set({
            status: 'INFO_REQUESTED',
            applicantNote: body.message,
            reviewedBy: principal.userId,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(restaurantApplications.id, applicationId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.RESTAURANT_REJECT,
          entityType: 'restaurant_application',
          entityId: applicationId,
          before: { status: application.status },
          after: { status: 'INFO_REQUESTED' },
          reason: body.message,
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.RESTAURANT_INFO_REQUESTED,
          aggregateType: 'restaurant',
          aggregateId: applicationId,
          requestId: request.requestId,
          payload: {
            restaurantId: applicationId,
            displayName: application.displayName,
            ownerUserId: application.applicantUserId,
            reason: body.message,
          },
        });
      });

      return reply.send(success({ status: 'INFO_REQUESTED' }, { request_id: request.requestId }));
    },
  );

  /** Readiness checklist shown on the approval screen (plan §122). */
  app.get(
    '/api/v1/admin/restaurants/:restaurantId/readiness',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'restaurant.read');
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

      // Shared with the restaurant's own view of the same checklist.
      const readiness = await computeReadiness(ctx, restaurantId);
      return reply.send(success(readiness, { request_id: request.requestId }));
    },
  );

  app.get('/api/v1/admin/audit-logs', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'audit.read');
    const query = z
      .object({
        entity_type: z.string().max(50).optional(),
        entity_id: z.string().max(64).optional(),
        action: z.string().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    const conditions = [
      query.entity_type ? eq(auditLogs.entityType, query.entity_type) : undefined,
      query.entity_id ? eq(auditLogs.entityId, query.entity_id) : undefined,
      query.action ? eq(auditLogs.action, query.action) : undefined,
    ].filter(Boolean);

    const rows = await ctx.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        actorUserId: auditLogs.actorUserId,
        actorName: users.fullName,
        reason: auditLogs.reason,
        createdAt: auditLogs.createdAt,
        requestId: auditLogs.requestId,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(conditions.length > 0 ? and(...(conditions as never[])) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(query.limit);

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          action: row.action,
          entity_type: row.entityType,
          entity_id: row.entityId,
          actor: row.actorName ?? row.actorUserId,
          reason: row.reason,
          created_at: row.createdAt.toISOString(),
          request_id: row.requestId,
        })),
        { request_id: request.requestId },
      ),
    );
  });
}

/** Describe which capability flags a patch actually changed, for the event payload. */
function diffCapabilities(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, { from: boolean; to: boolean }> {
  const changes: Record<string, { from: boolean; to: boolean }> = {};
  for (const key of [
    'isEnabled',
    'customerSignupEnabled',
    'restaurantOnboardingEnabled',
    'orderingEnabled',
  ]) {
    if (patch[key] !== undefined && patch[key] !== current[key]) {
      changes[key] = { from: Boolean(current[key]), to: Boolean(patch[key]) };
    }
  }
  return changes;
}
