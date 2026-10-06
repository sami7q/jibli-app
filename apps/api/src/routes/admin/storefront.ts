import { and, asc, count, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, MERCHANT_TYPES, success } from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import { appBanners, appCategories, restaurants, uuidv7 } from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { getConfig } from '../../services/config-service.js';
import { jsonbArrayContains, jsonbArrayContainsColumn } from '../../lib/jsonb.js';

/**
 * How the customer app looks: its categories, its banners, their order.
 *
 * All of it behind `config.write`, because it is merchandising rather than
 * tenant data — a category reordered here changes what every customer sees on
 * open, and that is the same kind of decision as changing the service fee.
 *
 * Ordering is sent as a whole list rather than as "move up" / "move down". A
 * per-row nudge needs one request per step and races itself when two operators
 * drag at once; a list is one intent, applied in one transaction.
 */

/** Gaps between saved positions, so a later insert has room between two rows. */
const ORDER_STEP = 10;

/**
 * Which storefront a merchandising screen is working on.
 *
 * Optional, and absent means both — an older caller asked for "the
 * categories" when there was only one set of them, and still gets all of them
 * rather than an empty list.
 *
 * Every row now says which side it belongs to whether or not it was filtered,
 * because a list mixing «برجر» with «خضار وفواكه» and labelling neither is
 * worse than either list alone.
 */
const merchantFilterSchema = z.object({
  merchant_type: z.enum(MERCHANT_TYPES).optional(),
});

/** Restrict a query to one storefront, or to neither if none was named. */
const ofType = (
  column: typeof appCategories.merchantType | typeof appBanners.merchantType,
  merchantType: (typeof MERCHANT_TYPES)[number] | undefined,
) => (merchantType ? eq(column, merchantType) : undefined);

const keySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lowercase letters, digits and underscore');

export function registerAdminStorefrontRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ── Categories ────────────────────────────────────────────────────────────

  /** Every category, in app order, with how many restaurants sit in each. */
  app.get('/api/v1/admin/categories', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'restaurant.read');
    const { merchant_type: merchantType } = merchantFilterSchema.parse(request.query);

    const rows = await ctx.db
      .select({
        id: appCategories.id,
        key: appCategories.key,
        nameAr: appCategories.nameAr,
        merchantType: appCategories.merchantType,
        emoji: appCategories.emoji,
        imageAssetId: appCategories.imageAssetId,
        sortOrder: appCategories.sortOrder,
        isActive: appCategories.isActive,
        /*
         * Counted here rather than in the browser: the categories screen used
         * to fetch every restaurant and tally the tags client-side, which is
         * fine at one restaurant and a page-sized download at a thousand.
         *
         * Correlated rather than joined, because a restaurant carries several
         * tags and a join would multiply the category rows by them.
         */
        restaurantCount: sql<number>`(
          SELECT COUNT(*) FROM ${restaurants}
          WHERE ${restaurants.deletedAt} IS NULL
            AND ${restaurants.merchantType} = ${appCategories.merchantType}
            AND ${jsonbArrayContainsColumn(restaurants.cuisineTags, appCategories.key)}
        )`,
      })
      .from(appCategories)
      .where(ofType(appCategories.merchantType, merchantType))
      .orderBy(asc(appCategories.sortOrder), asc(appCategories.nameAr));

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          key: row.key,
          name_ar: row.nameAr,
          merchant_type: row.merchantType,
          emoji: row.emoji,
          image_asset_id: row.imageAssetId,
          sort_order: row.sortOrder,
          is_active: row.isActive,
          restaurant_count: Number(row.restaurantCount),
        })),
        { request_id: request.requestId },
      ),
    );
  });

  app.post('/api/v1/admin/categories', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'config.write');

    const body = z
      .object({
        key: keySchema,
        name_ar: z.string().trim().min(1).max(60),
        /*
         * Which storefront this category belongs to.
         *
         * Without it, Admin could only ever create restaurant categories —
         * the column existed, the customer app filtered on it, and the one
         * screen that creates categories always wrote RESTAURANT. So the
         * market half of the app could be given aisles by a migration and
         * never by a person, which is the same as saying it could not be
         * merchandised at all.
         *
         * Defaulted, so a caller written before markets keeps its meaning.
         */
        merchant_type: z.enum(MERCHANT_TYPES).default('RESTAURANT'),
        emoji: z.string().trim().max(8).optional(),
        image_asset_id: uuidSchema.optional(),
      })
      .parse(request.body);

    const [existing] = await ctx.db
      .select({ id: appCategories.id })
      .from(appCategories)
      .where(eq(appCategories.key, body.key))
      .limit(1);

    if (existing) {
      throw new AppError(ERROR_CODES.CONFLICT, {
        details: { field: 'key', reason: 'KEY_TAKEN' },
        messageAr: 'هذا المعرّف مستخدم في تصنيف آخر',
      });
    }

    /*
     * Last within its own storefront, with a gap. Nothing renumbers to make
     * room at the end. Scoped to the type because the two lists are ordered
     * independently: a new market aisle placed after the last *restaurant*
     * category would sort below aisles it should sit beside.
     */
    const [last] = await ctx.db
      .select({ value: sql<number>`COALESCE(MAX(${appCategories.sortOrder}), 0)` })
      .from(appCategories)
      .where(eq(appCategories.merchantType, body.merchant_type));

    const id = uuidv7();
    await ctx.db.insert(appCategories).values({
      id,
      key: body.key,
      nameAr: body.name_ar,
      merchantType: body.merchant_type,
      emoji: body.emoji ?? null,
      imageAssetId: body.image_asset_id ?? null,
      sortOrder: Number(last?.value ?? 0) + ORDER_STEP,
      createdBy: principal.userId,
    });

    await writeAudit(ctx.db, {
      actorUserId: principal.userId,
      action: AUDIT_ACTIONS.CATEGORY_CREATE,
      entityType: 'app_category',
      entityId: id,
      after: { key: body.key, nameAr: body.name_ar, merchantType: body.merchant_type },
      ip: clientIp(request),
      userAgent: userAgent(request),
      requestId: request.requestId,
    });

    return reply.status(201).send(success({ id }, { request_id: request.requestId }));
  });

  app.patch(
    '/api/v1/admin/categories/:categoryId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'config.write');
      const { categoryId } = z.object({ categoryId: uuidSchema }).parse(request.params);

      /*
       * `key` is absent on purpose. A restaurant carries it in `cuisine_tags`,
       * so renaming it here would leave every restaurant in the category
       * tagged with a key nothing matches — the category would simply empty
       * itself, silently. The Arabic name is the one people read.
       */
      const body = z
        .object({
          name_ar: z.string().trim().min(1).max(60).optional(),
          emoji: z.string().trim().max(8).nullable().optional(),
          image_asset_id: uuidSchema.nullable().optional(),
          is_active: z.boolean().optional(),
        })
        .parse(request.body);

      const [before] = await ctx.db
        .select()
        .from(appCategories)
        .where(eq(appCategories.id, categoryId))
        .limit(1);

      if (!before) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'category' } });
      }

      await ctx.db
        .update(appCategories)
        .set({
          ...(body.name_ar !== undefined ? { nameAr: body.name_ar } : {}),
          ...(body.emoji !== undefined ? { emoji: body.emoji } : {}),
          ...(body.image_asset_id !== undefined ? { imageAssetId: body.image_asset_id } : {}),
          ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(appCategories.id, categoryId));

      await writeAudit(ctx.db, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.CATEGORY_UPDATE,
        entityType: 'app_category',
        entityId: categoryId,
        before: { nameAr: before.nameAr, isActive: before.isActive },
        after: body,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  /**
   * Remove a category.
   *
   * Only when it is empty. A category with restaurants in it cannot be deleted
   * without leaving their tags pointing at nothing, and "hide it" is what an
   * operator actually means nine times out of ten — so that is what they are
   * told to do instead.
   */
  app.delete(
    '/api/v1/admin/categories/:categoryId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'config.write');
      const { categoryId } = z.object({ categoryId: uuidSchema }).parse(request.params);

      const [category] = await ctx.db
        .select()
        .from(appCategories)
        .where(eq(appCategories.id, categoryId))
        .limit(1);

      if (!category) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'category' } });
      }

      /*
       * Scoped to the category's own storefront, like the count on the list.
       * Keys are globally unique so this cannot currently differ — but the
       * count that decides whether a delete is refused should ask the same
       * question the screen showing the count asked.
       */
      const [inUse] = await ctx.db
        .select({ value: count() })
        .from(restaurants)
        .where(
          and(
            eq(restaurants.merchantType, category.merchantType),
            jsonbArrayContains(restaurants.cuisineTags, category.key),
            isNull(restaurants.deletedAt),
          ),
        );

      if (Number(inUse?.value ?? 0) > 0) {
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: { reason: 'CATEGORY_IN_USE', restaurants: Number(inUse?.value ?? 0) },
          messageAr: `لا يمكن حذف تصنيف فيه ${inUse?.value} مطعم. أخفِه بدلاً من ذلك ليختفي من التطبيق مع بقاء المطاعم كما هي.`,
        });
      }

      await ctx.db.delete(appCategories).where(eq(appCategories.id, categoryId));

      await writeAudit(ctx.db, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.CATEGORY_DELETE,
        entityType: 'app_category',
        entityId: categoryId,
        before: { key: category.key, nameAr: category.nameAr },
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return reply.send(success({ deleted: true }, { request_id: request.requestId }));
    },
  );

  /** The whole order at once. See the note at the top of this file. */
  app.post(
    '/api/v1/admin/categories/order',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'config.write');
      const body = z.object({ ids: z.array(uuidSchema).min(1).max(200) }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        for (const [index, id] of body.ids.entries()) {
          await tx
            .update(appCategories)
            .set({ sortOrder: (index + 1) * ORDER_STEP, updatedAt: new Date() })
            .where(eq(appCategories.id, id));
        }
      });

      return reply.send(success({ ordered: body.ids.length }, { request_id: request.requestId }));
    },
  );

  // ── Banners ───────────────────────────────────────────────────────────────

  app.get('/api/v1/admin/banners', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'restaurant.read');
    const { merchant_type: merchantType } = merchantFilterSchema.parse(request.query);

    const rows = await ctx.db
      .select()
      .from(appBanners)
      .where(ofType(appBanners.merchantType, merchantType))
      .orderBy(asc(appBanners.sortOrder), asc(appBanners.createdAt));

    const now = Date.now();

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          title_ar: row.titleAr,
          subtitle_ar: row.subtitleAr,
          merchant_type: row.merchantType,
          image_asset_id: row.imageAssetId,
          link_type: row.linkType,
          link_value: row.linkValue,
          sort_order: row.sortOrder,
          is_active: row.isActive,
          starts_at: row.startsAt?.toISOString() ?? null,
          ends_at: row.endsAt?.toISOString() ?? null,
          /*
           * Whether it is on screen *right now*, which is not the same as
           * `is_active`: a scheduled banner is active and invisible, and an
           * operator looking at the list needs to see which.
           */
          is_live:
            row.isActive &&
            (!row.startsAt || row.startsAt.getTime() <= now) &&
            (!row.endsAt || row.endsAt.getTime() > now),
        })),
        { request_id: request.requestId },
      ),
    );
  });

  const bannerBody = z.object({
    title_ar: z.string().trim().min(1).max(80),
    /*
     * Which storefront the placement runs in. A banner is the one paid slot in
     * the app and it is sold for one half of it — a Ramadan offer from a
     * restaurant has no business rotating above a grocery basket. The column
     * has existed since markets shipped; this is the field that lets anyone
     * set it.
     */
    merchant_type: z.enum(MERCHANT_TYPES).default('RESTAURANT'),
    subtitle_ar: z.string().trim().max(140).nullable().optional(),
    image_asset_id: uuidSchema.nullable().optional(),
    link_type: z.enum(['NONE', 'CATEGORY', 'RESTAURANT', 'URL']).default('NONE'),
    link_value: z.string().trim().max(300).nullable().optional(),
    is_active: z.boolean().optional(),
    starts_at: z.string().datetime().nullable().optional(),
    ends_at: z.string().datetime().nullable().optional(),
  });

  /** A link type that names a destination must have one, and NONE must not. */
  const assertLinkCoherent = (linkType: string, linkValue: string | null | undefined) => {
    if (linkType === 'NONE' && linkValue) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        details: { field: 'link_value', reason: 'UNEXPECTED' },
        messageAr: 'اخترت «بدون وجهة» لكنك أدخلت وجهة',
      });
    }
    if (linkType !== 'NONE' && !linkValue) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        details: { field: 'link_value', reason: 'REQUIRED' },
        messageAr: 'حدّد وجهة البنر',
      });
    }
  };

  app.post('/api/v1/admin/banners', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'config.write');
    const body = bannerBody.parse(request.body);
    assertLinkCoherent(body.link_type, body.link_value);

    // Last within its own storefront — see the note on category ordering.
    const [last] = await ctx.db
      .select({ value: sql<number>`COALESCE(MAX(${appBanners.sortOrder}), 0)` })
      .from(appBanners)
      .where(eq(appBanners.merchantType, body.merchant_type));

    const id = uuidv7();
    await ctx.db.insert(appBanners).values({
      id,
      titleAr: body.title_ar,
      subtitleAr: body.subtitle_ar ?? null,
      merchantType: body.merchant_type,
      imageAssetId: body.image_asset_id ?? null,
      linkType: body.link_type,
      linkValue: body.link_value ?? null,
      isActive: body.is_active ?? true,
      startsAt: body.starts_at ? new Date(body.starts_at) : null,
      endsAt: body.ends_at ? new Date(body.ends_at) : null,
      sortOrder: Number(last?.value ?? 0) + ORDER_STEP,
      createdBy: principal.userId,
    });

    await writeAudit(ctx.db, {
      actorUserId: principal.userId,
      action: AUDIT_ACTIONS.BANNER_CREATE,
      entityType: 'app_banner',
      entityId: id,
      after: { titleAr: body.title_ar, linkType: body.link_type },
      ip: clientIp(request),
      userAgent: userAgent(request),
      requestId: request.requestId,
    });

    return reply.status(201).send(success({ id }, { request_id: request.requestId }));
  });

  app.patch(
    '/api/v1/admin/banners/:bannerId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'config.write');
      const { bannerId } = z.object({ bannerId: uuidSchema }).parse(request.params);
      const body = bannerBody.partial().parse(request.body);

      const [before] = await ctx.db
        .select()
        .from(appBanners)
        .where(eq(appBanners.id, bannerId))
        .limit(1);

      if (!before) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'banner' } });
      }

      // Checked against the merged result, not the patch: sending only a new
      // link type would otherwise pass while leaving an incoherent row.
      assertLinkCoherent(
        body.link_type ?? before.linkType,
        body.link_value !== undefined ? body.link_value : before.linkValue,
      );

      await ctx.db
        .update(appBanners)
        .set({
          ...(body.title_ar !== undefined ? { titleAr: body.title_ar } : {}),
          ...(body.subtitle_ar !== undefined ? { subtitleAr: body.subtitle_ar } : {}),
          // Moving a placement between storefronts is a real operation — a
          // slot sold for the wrong half has to be correctable without
          // rebuilding the banner.
          ...(body.merchant_type !== undefined ? { merchantType: body.merchant_type } : {}),
          ...(body.image_asset_id !== undefined ? { imageAssetId: body.image_asset_id } : {}),
          ...(body.link_type !== undefined ? { linkType: body.link_type } : {}),
          ...(body.link_value !== undefined ? { linkValue: body.link_value } : {}),
          ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
          ...(body.starts_at !== undefined
            ? { startsAt: body.starts_at ? new Date(body.starts_at) : null }
            : {}),
          ...(body.ends_at !== undefined
            ? { endsAt: body.ends_at ? new Date(body.ends_at) : null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(appBanners.id, bannerId));

      await writeAudit(ctx.db, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.BANNER_UPDATE,
        entityType: 'app_banner',
        entityId: bannerId,
        before: { titleAr: before.titleAr, isActive: before.isActive },
        after: body,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  app.delete(
    '/api/v1/admin/banners/:bannerId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'config.write');
      const { bannerId } = z.object({ bannerId: uuidSchema }).parse(request.params);

      const deleted = await ctx.db
        .delete(appBanners)
        .where(eq(appBanners.id, bannerId))
        .returning({ titleAr: appBanners.titleAr });

      if (deleted.length === 0) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'banner' } });
      }

      await writeAudit(ctx.db, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.BANNER_DELETE,
        entityType: 'app_banner',
        entityId: bannerId,
        before: { titleAr: deleted[0]?.titleAr },
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return reply.send(success({ deleted: true }, { request_id: request.requestId }));
    },
  );

  app.post(
    '/api/v1/admin/banners/order',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'config.write');
      const body = z.object({ ids: z.array(uuidSchema).min(1).max(100) }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        for (const [index, id] of body.ids.entries()) {
          await tx
            .update(appBanners)
            .set({ sortOrder: (index + 1) * ORDER_STEP, updatedAt: new Date() })
            .where(eq(appBanners.id, id));
        }
      });

      return reply.send(success({ ordered: body.ids.length }, { request_id: request.requestId }));
    },
  );

  /**
   * Which storefront the app is asking for.
   *
   * Defaulted rather than required: the parameter did not exist before markets
   * did, and a caller that omits it wants the food half — which is what it has
   * always been given.
   */
  const storefrontQuerySchema = z.object({
    merchant_type: z.enum(MERCHANT_TYPES).default('RESTAURANT'),
  });

  // ── What the app reads ────────────────────────────────────────────────────

  /**
   * The storefront, as the customer app sees it.
   *
   * Unauthenticated, because it is the first request the app makes and it has
   * no session yet — a home screen that requires sign-in to show a category
   * strip is a home screen nobody reaches.
   *
   * Scheduling is applied here rather than in the client: a banner whose window
   * has closed should not be on the phone at all, and leaving that decision to
   * the client means it depends on the phone's clock.
   */
  app.get('/api/v1/storefront', async (request, reply) => {
    const now = new Date();

    /*
     * Which storefront is asking.
     *
     * Absent means the restaurant one, not both — because merging the two
     * would put grocery aisles in the food category strip, which is the exact
     * confusion the column exists to end. A caller written before markets
     * existed wanted food, and still gets it.
     */
    const { merchant_type: merchantType } = storefrontQuerySchema.parse(request.query);

    const categories = await ctx.db
      .select({
        key: appCategories.key,
        nameAr: appCategories.nameAr,
        emoji: appCategories.emoji,
        imageAssetId: appCategories.imageAssetId,
      })
      .from(appCategories)
      .where(and(eq(appCategories.isActive, true), eq(appCategories.merchantType, merchantType)))
      .orderBy(asc(appCategories.sortOrder), asc(appCategories.nameAr));

    const banners = await ctx.db
      .select()
      .from(appBanners)
      .where(
        and(
          eq(appBanners.isActive, true),
          eq(appBanners.merchantType, merchantType),
          // Null means "no boundary", so each side is "unset, or satisfied".
          or(isNull(appBanners.startsAt), lte(appBanners.startsAt, now)),
          or(isNull(appBanners.endsAt), gt(appBanners.endsAt, now)),
        ),
      )
      .orderBy(asc(appBanners.sortOrder), asc(appBanners.createdAt));

    return reply.send(
      success(
        {
          categories: categories.map((row) => ({
            key: row.key,
            name_ar: row.nameAr,
            emoji: row.emoji,
            image_asset_id: row.imageAssetId,
          })),
          banners: banners.map((row) => ({
            id: row.id,
            title_ar: row.titleAr,
            subtitle_ar: row.subtitleAr,
            image_asset_id: row.imageAssetId,
            link_type: row.linkType,
            link_value: row.linkValue,
          })),
          /** How long each banner holds the screen, in seconds. */
          banner_rotation_seconds: await getConfig(ctx, 'banner_rotation_seconds', 5),
          /**
           * What the customer pays Jibli per order, on top of the food and the
           * delivery — «رسوم الخدمة».
           *
           * Sent here so the cart can show the real number before an address
           * exists, because a total that grows by 500 between the cart and the
           * checkout is the kind of surprise that loses the order. The
           * authoritative figure is still the one `POST /checkout/quote`
           * returns; this is the same value, read from the same setting.
           *
           * Not to be confused with `commission_flat_iqd`, which is what Jibli
           * takes from the *restaurant* and which no customer ever sees.
           */
          service_fee_iqd: await getConfig(ctx, 'platform_service_fee_iqd', 500),
        },
        { request_id: request.requestId },
      ),
    );
  });
}
