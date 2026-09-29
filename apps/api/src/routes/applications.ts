import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ALL_CATEGORY_KEYS,
  AppError,
  categoriesFor,
  ERROR_CODES,
  MERCHANT_TYPES,
  success,
} from '@jibli/contracts';
import { displayNameSchema, iraqiPhoneSchema, toE164Iraq, uuidSchema } from '@jibli/validation';
import { cities, governorates, restaurantApplications, uuidv7 } from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { clientIp, userAgent } from '../lib/context.js';
import { notifyAdmins } from '../services/admin-notification-service.js';

/**
 * A restaurant applying to join, with no account and nobody to ask.
 *
 * The applications queue has existed from the first migration and Admin has
 * been able to review, approve and reject — but nothing could put a row in it.
 * The only way onto the platform was for someone at Jibli to create the
 * restaurant by hand, which means every restaurant that wanted to join had to
 * find a person first.
 *
 * This is the one route on the platform that writes without a token, so it is
 * built as that: narrow, rate-limited by address, and deliberately dull about
 * what it will tell an anonymous caller.
 */

export const applySchema = z
  .object({
    display_name: displayNameSchema(2, 120),
    applicant_name: displayNameSchema(3, 80),
    applicant_phone: iraqiPhoneSchema,
    governorate_id: uuidSchema,
    city_id: uuidSchema,
    address_text: z.string().trim().min(5).max(300),
    /**
     * Restaurant, market or cosmetics. Defaulted so a form written before
     * markets existed keeps meaning a restaurant.
     */
    merchant_type: z.enum(MERCHANT_TYPES).default('RESTAURANT'),
    cuisine_tags: z
      .array(z.enum(ALL_CATEGORY_KEYS as [string, ...string[]]))
      .max(4)
      .default([]),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((body, issue) => {
    // Each kind of shop is tagged from its own list, as in the Admin create form.
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

/** A second application within this window is the same one, sent again. */
const DUPLICATE_WINDOW_HOURS = 24;

export function registerPublicApplicationRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Where a restaurant may apply.
   *
   * Only cities open for restaurant onboarding, and only their names and ids —
   * an unauthenticated caller learns which cities Jibli is opening, which is
   * public by intent, and nothing else.
   */
  app.get('/api/v1/applications/coverage', async (request, reply) => {
    const rows = await ctx.db
      .select({
        cityId: cities.id,
        cityNameAr: cities.nameAr,
        governorateId: governorates.id,
        governorateNameAr: governorates.nameAr,
      })
      .from(cities)
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(
        and(
          eq(cities.isEnabled, true),
          eq(cities.restaurantOnboardingEnabled, true),
          eq(governorates.isEnabled, true),
          eq(governorates.restaurantOnboardingEnabled, true),
        ),
      )
      .orderBy(governorates.nameAr, cities.nameAr);

    const byGovernorate = new Map<
      string,
      { id: string; name_ar: string; cities: { id: string; name_ar: string }[] }
    >();

    for (const row of rows) {
      const entry = byGovernorate.get(row.governorateId) ?? {
        id: row.governorateId,
        name_ar: row.governorateNameAr,
        cities: [],
      };
      entry.cities.push({ id: row.cityId, name_ar: row.cityNameAr });
      byGovernorate.set(row.governorateId, entry);
    }

    return reply.send(success([...byGovernorate.values()], { request_id: request.requestId }));
  });

  app.post(
    '/api/v1/applications',
    {
      /*
       * By address, because there is no account to limit by. Generous enough
       * that a restaurant correcting a typo is never blocked, tight enough that
       * the queue cannot be filled from one machine.
       */
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const body = applySchema.parse(request.body);

      const phone = toE164Iraq(body.applicant_phone);

      /*
       * The city must be open, and it is checked here rather than trusted from
       * the form: the coverage list is public, so the ids in it are too, and a
       * closed city would otherwise accept applications nobody intends to work.
       */
      const [city] = await ctx.db
        .select({
          id: cities.id,
          governorateId: cities.governorateId,
          open: cities.restaurantOnboardingEnabled,
          cityEnabled: cities.isEnabled,
          governorateOpen: governorates.restaurantOnboardingEnabled,
          governorateEnabled: governorates.isEnabled,
        })
        .from(cities)
        .innerJoin(governorates, eq(cities.governorateId, governorates.id))
        .where(eq(cities.id, body.city_id))
        .limit(1);

      const open =
        city &&
        city.governorateId === body.governorate_id &&
        city.cityEnabled &&
        city.open &&
        city.governorateEnabled &&
        city.governorateOpen;

      if (!open) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { field: 'city_id', reason: 'CITY_NOT_OPEN' },
          messageAr: 'جيبلي لا يستقبل طلبات انضمام في هذه المدينة حالياً',
        });
      }

      /*
       * A restaurant that applies twice in a day has not heard back; it is not
       * a second restaurant. Answered as success rather than as an error: the
       * applicant did nothing wrong, and telling them "you already applied"
       * from an unauthenticated endpoint would confirm that a given phone
       * number is in our records.
       */
      const since = new Date(Date.now() - DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000);
      const [recent] = await ctx.db
        .select({ id: restaurantApplications.id })
        .from(restaurantApplications)
        .where(
          and(
            eq(restaurantApplications.contactPhoneE164, phone),
            gte(restaurantApplications.createdAt, since),
            isNull(restaurantApplications.reviewedAt),
          ),
        )
        .orderBy(desc(restaurantApplications.createdAt))
        .limit(1);

      if (recent) {
        ctx.logger.info(
          { event: 'application.duplicate_suppressed', applicationId: recent.id },
          'Repeat application within the window; not creating another row',
        );
        return reply
          .status(202)
          .send(
            success(
              { received: true, note_ar: ACKNOWLEDGEMENT },
              { request_id: request.requestId },
            ),
          );
      }

      const applicationId = uuidv7();

      await ctx.db.insert(restaurantApplications).values({
        id: applicationId,
        displayName: body.display_name,
        applicantName: body.applicant_name,
        contactPhoneE164: phone,
        applicantNote: body.note ?? null,
        governorateId: body.governorate_id,
        cityId: body.city_id,
        addressText: body.address_text,
        cuisineTags: body.cuisine_tags,
        merchantType: body.merchant_type,
        status: 'UNDER_REVIEW',
      });

      ctx.logger.info(
        {
          event: 'application.submitted',
          applicationId,
          cityId: body.city_id,
          ip: clientIp(request),
          userAgent: userAgent(request),
        },
        'Restaurant application submitted',
      );

      /*
       * No audit row: `writeAudit` records who did something, and there is no
       * actor here — an application is a fact about a stranger, and the log
       * line above is the record of it. The audit trail starts when someone at
       * Jibli reviews it.
       *
       * A bell entry is a different thing: not a record of who acted, but a
       * note that something is waiting. Without it an application sits in the
       * queue until somebody thinks to look, which on a public form is the
       * difference between a day and a fortnight.
       */
      await notifyAdmins(ctx, {
        kind: 'APPLICATION_RECEIVED',
        severity: 'ATTENTION',
        titleAr: `طلب انضمام جديد: ${body.display_name}`,
        bodyAr: `${body.applicant_name} — ${body.address_text}`,
        linkPath: '/applications',
        entityType: 'restaurant_application',
        entityId: applicationId,
      });

      return reply
        .status(202)
        .send(
          success({ received: true, note_ar: ACKNOWLEDGEMENT }, { request_id: request.requestId }),
        );
    },
  );
}

/**
 * The same sentence whether the row was written or suppressed as a repeat.
 * Two different answers would tell an anonymous caller which phone numbers are
 * already on file.
 */
const ACKNOWLEDGEMENT =
  'وصل طلبك. سيتواصل معك فريق جيبلي على الرقم الذي أدخلته خلال أيام العمل القادمة.';
