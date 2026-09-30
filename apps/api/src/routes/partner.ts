import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ALL_CATEGORY_KEYS,
  AppError,
  ERROR_CODES,
  MERCHANT_TYPES,
  type MerchantType,
  type OnboardingStatus,
  success,
} from '@jibli/contracts';
import { displayNameSchema, uuidSchema } from '@jibli/validation';
import { cities, governorates, restaurantApplications, users, uuidv7 } from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { clientIp, userAgent } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';
import { notifyAdmins } from '../services/admin-notification-service.js';
import { assertOnboardingOpen, tagsFromOwnKind } from './applications.js';

/**
 * Becoming a partner from the app, as yourself.
 *
 * The public form (`applications.ts`) is for a stranger with no account, so it
 * carries only a phone number and the owner is found by that number at
 * approval. That left the app with no way in at all: someone who signed in
 * with their phone and wanted to sell on Jibli was sent to «الدخول بحساب متجر»,
 * a username and password nobody had issued them, and came back to the same
 * screen every time.
 *
 * This is the same application, filed by the signed-in account. It records
 * `applicant_user_id`, which approval already honours: the shop is created with
 * this account as its OWNER. Membership is read from the database on every
 * request, so the next time «متجري» asks, the shop is simply there — no second
 * login, no credentials to hand over, no password to forget.
 */

/** An application still waiting on Jibli. One at a time per account. */
export const OPEN_APPLICATION_STATUSES: readonly OnboardingStatus[] = [
  'DRAFT',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
];

export function isOpenApplication(status: string): boolean {
  return (OPEN_APPLICATION_STATUSES as readonly string[]).includes(status);
}

export const partnerApplySchema = z
  .object({
    display_name: displayNameSchema(2, 120),
    merchant_type: z.enum(MERCHANT_TYPES),
    /** Defaults to the account's own name. */
    applicant_name: displayNameSchema(3, 80).optional(),
    governorate_id: uuidSchema,
    city_id: uuidSchema,
    address_text: z.string().trim().min(5).max(300),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    cuisine_tags: z
      .array(z.enum(ALL_CATEGORY_KEYS as [string, ...string[]]))
      .max(4)
      .default([]),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine(tagsFromOwnKind);

const KIND_AR: Record<MerchantType, string> = {
  RESTAURANT: 'مطعم',
  MARKET: 'ماركت',
  COSMETICS: 'كوزمتك',
};

/** The account's latest application, in the shape the app shows. */
async function latestApplication(ctx: AppContext, userId: string) {
  const [row] = await ctx.db
    .select({
      id: restaurantApplications.id,
      displayName: restaurantApplications.displayName,
      merchantType: restaurantApplications.merchantType,
      status: restaurantApplications.status,
      addressText: restaurantApplications.addressText,
      createdAt: restaurantApplications.createdAt,
      reviewedAt: restaurantApplications.reviewedAt,
      rejectionReason: restaurantApplications.rejectionReason,
      restaurantId: restaurantApplications.restaurantId,
      cityNameAr: cities.nameAr,
      governorateNameAr: governorates.nameAr,
    })
    .from(restaurantApplications)
    .innerJoin(cities, eq(restaurantApplications.cityId, cities.id))
    .innerJoin(governorates, eq(restaurantApplications.governorateId, governorates.id))
    .where(eq(restaurantApplications.applicantUserId, userId))
    .orderBy(desc(restaurantApplications.createdAt))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    display_name: row.displayName,
    merchant_type: row.merchantType,
    status: row.status,
    address_text: row.addressText,
    city_name_ar: row.cityNameAr,
    governorate_name_ar: row.governorateNameAr,
    applied_at: row.createdAt.toISOString(),
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    rejection_reason: row.rejectionReason,
    restaurant_id: row.restaurantId,
  };
}

export function registerPartnerRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Where my application stands, if I have one — what «متجري» shows while I wait. */
  app.get(
    '/api/v1/partner/application',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const application = await latestApplication(ctx, principal.userId);
      return reply.send(
        success(
          application && {
            ...application,
            // Approved *and* already mine: Owner Mode will open it.
            owned: Boolean(
              application.restaurant_id && principal.restaurantRoles[application.restaurant_id],
            ),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Apply to open a shop, as the signed-in account.
   *
   * Idempotent while an application is open: the second tap is almost always
   * someone checking the first one worked, so it gets the first one back. A
   * decided application (approved or rejected) does not block a new one — a
   * rejected shop may try again, and an approved owner may open a second shop.
   */
  app.post(
    '/api/v1/partner/apply',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const body = partnerApplySchema.parse(request.body);

      const existing = await latestApplication(ctx, principal.userId);
      if (existing && isOpenApplication(existing.status)) {
        return reply.send(
          success(
            { application: { ...existing, owned: false }, already_applied: true },
            { request_id: request.requestId },
          ),
        );
      }

      const [user] = await ctx.db
        .select({ fullName: users.fullName, phoneE164: users.phoneE164 })
        .from(users)
        .where(eq(users.id, principal.userId))
        .limit(1);

      // The team calls the applicant before approving; there has to be a number.
      if (!user?.phoneE164) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { field: 'phone', reason: 'NO_PHONE_ON_ACCOUNT' },
          messageAr: 'أضف رقم هاتفك إلى حسابك أولاً، فعليه يتواصل معك فريق جيبلي.',
        });
      }

      const applicantName = body.applicant_name ?? user.fullName;
      if (!applicantName) {
        throw new AppError(ERROR_CODES.PROFILE_INCOMPLETE, {
          messageAr: 'اكتب اسمك أولاً، ثم أرسل طلب تسجيل المتجر.',
        });
      }

      await assertOnboardingOpen(ctx, body.governorate_id, body.city_id);

      const applicationId = uuidv7();
      await ctx.db.insert(restaurantApplications).values({
        id: applicationId,
        applicantUserId: principal.userId,
        displayName: body.display_name,
        applicantName,
        contactPhoneE164: user.phoneE164,
        applicantNote: body.note ?? null,
        governorateId: body.governorate_id,
        cityId: body.city_id,
        addressText: body.address_text,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        cuisineTags: body.cuisine_tags,
        merchantType: body.merchant_type,
        status: 'UNDER_REVIEW',
      });

      ctx.logger.info(
        {
          event: 'application.submitted',
          via: 'app',
          applicationId,
          merchantType: body.merchant_type,
          ip: clientIp(request),
          userAgent: userAgent(request),
        },
        'Partner application submitted from the app',
      );

      await notifyAdmins(ctx, {
        kind: 'APPLICATION_RECEIVED',
        severity: 'ATTENTION',
        titleAr: `طلب انضمام جديد (${KIND_AR[body.merchant_type]}): ${body.display_name}`,
        bodyAr: `${applicantName} — ${body.address_text} — من التطبيق`,
        linkPath: '/applications',
        entityType: 'restaurant_application',
        entityId: applicationId,
      });

      const saved = await latestApplication(ctx, principal.userId);
      return reply
        .status(201)
        .send(
          success(
            { application: saved && { ...saved, owned: false }, already_applied: false },
            { request_id: request.requestId },
          ),
        );
    },
  );
}
