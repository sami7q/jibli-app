import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { assertRestaurantPermission } from '@jibli/auth';
import { arabicTextSchema, iqdAmountSchema, uuidSchema } from '@jibli/validation';
import {
  itemModifierGroups,
  menuCategories,
  menuItems,
  modifierGroups,
  modifiers,
  restaurants,
  uuidv7,
} from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';

/**
 * Restaurant menu management (plan §19, §20, §116).
 *
 * Menu edits never touch historical orders — an order carries its own name and
 * price snapshots. What they do touch is `menu_version`, which lets a customer's
 * cart notice it is stale before checkout rather than at it.
 *
 * Cost price is written and read here but is permission-gated: a Cashier can
 * manage availability without seeing margin (plan §38, §86).
 */

const categorySchema = z.object({
  name_ar: arabicTextSchema(2, 60),
  description_ar: z.string().max(200).optional(),
  sort_order: z.number().int().min(0).max(999).default(0),
});

const itemSchema = z.object({
  category_id: uuidSchema,
  name_ar: arabicTextSchema(2, 100),
  description_ar: z.string().max(300).optional(),
  base_price_iqd: iqdAmountSchema,
  cost_price_iqd: iqdAmountSchema.optional(),
  sku: z.string().max(40).optional(),
  preparation_minutes_override: z.number().int().min(1).max(240).optional(),
  is_popular: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(999).default(0),
  /**
   * A picture of the dish, uploaded through `/api/v1/uploads`.
   *
   * The column has existed since the schema was written and the customer app
   * has always read `image_asset_id` — nothing ever wrote one, so every card
   * in the app fell back to a grey block. Nullable on purpose: passing `null`
   * is how an item goes back to having no photo, which a bare `optional()`
   * could not express.
   */
  image_asset_id: uuidSchema.nullable().optional(),
});

/** Bump the menu version so open carts can detect staleness (plan §116). */
async function bumpMenuVersion(
  tx: Parameters<Parameters<AppContext['db']['transaction']>[0]>[0],
  restaurantId: string,
): Promise<void> {
  await tx
    .update(restaurants)
    .set({ menuVersion: sql`${restaurants.menuVersion} + 1`, updatedAt: new Date() })
    .where(eq(restaurants.id, restaurantId));
}

export function registerRestaurantMenuRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Full menu for the portal editor, including inactive rows. */
  app.get(
    '/api/v1/restaurant-portal/menu',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.read');

      // Cost and margin are restricted (plan §86): a Cashier sees the menu but
      // not what each item costs the restaurant.
      const canSeeCost = (() => {
        try {
          assertRestaurantPermission(principal, restaurantId, 'inventory.cost.read');
          return true;
        } catch {
          return false;
        }
      })();

      const categories = await ctx.db
        .select()
        .from(menuCategories)
        .where(and(eq(menuCategories.restaurantId, restaurantId), isNull(menuCategories.deletedAt)))
        .orderBy(asc(menuCategories.sortOrder));

      const items = await ctx.db
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.restaurantId, restaurantId), isNull(menuItems.deletedAt)))
        .orderBy(asc(menuItems.sortOrder));

      const [restaurant] = await ctx.db
        .select({ menuVersion: restaurants.menuVersion })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      return reply.send(
        success(
          {
            menu_version: restaurant?.menuVersion ?? 1,
            can_see_cost: canSeeCost,
            categories: categories.map((category) => ({
              id: category.id,
              name_ar: category.nameAr,
              description_ar: category.descriptionAr,
              sort_order: category.sortOrder,
              is_active: category.isActive,
              items: items
                .filter((item) => item.categoryId === category.id)
                .map((item) => ({
                  id: item.id,
                  name_ar: item.nameAr,
                  description_ar: item.descriptionAr,
                  base_price_iqd: item.basePriceIqd,
                  ...(canSeeCost ? { cost_price_iqd: item.costPriceIqd } : {}),
                  // Margin is derived server-side so the client never has to do
                  // money arithmetic (plan §100).
                  ...(canSeeCost && item.costPriceIqd
                    ? { margin_iqd: item.basePriceIqd - item.costPriceIqd }
                    : {}),
                  sku: item.sku,
                  image_asset_id: item.imageAssetId,
                  is_active: item.isActive,
                  is_available: item.isAvailable,
                  // Distinguishes "staff turned this off" from "stock ran out",
                  // which decides whether restock may re-enable it (plan §37).
                  unavailable_by_inventory: item.unavailableByInventory,
                  is_popular: item.isPopular,
                  preparation_minutes_override: item.preparationMinutesOverride,
                  sort_order: item.sortOrder,
                })),
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.post(
    '/api/v1/restaurant-portal/menu/categories',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const body = categorySchema.parse(request.body);

      const id = uuidv7();
      await ctx.db.transaction(async (tx) => {
        await tx.insert(menuCategories).values({
          id,
          restaurantId,
          nameAr: body.name_ar,
          descriptionAr: body.description_ar ?? null,
          sortOrder: body.sort_order,
        });
        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.status(201).send(success({ id }, { request_id: request.requestId }));
    },
  );

  app.patch(
    '/api/v1/restaurant-portal/menu/categories/:categoryId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const { categoryId } = z.object({ categoryId: uuidSchema }).parse(request.params);
      const body = categorySchema
        .partial()
        .extend({ is_active: z.boolean().optional() })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        // Tenant guard: the WHERE clause includes the restaurant, so another
        // restaurant's category ID simply matches nothing (plan §63).
        const updated = await tx
          .update(menuCategories)
          .set({
            ...(body.name_ar ? { nameAr: body.name_ar } : {}),
            ...(body.description_ar !== undefined ? { descriptionAr: body.description_ar } : {}),
            ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
            ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(eq(menuCategories.id, categoryId), eq(menuCategories.restaurantId, restaurantId)),
          )
          .returning({ id: menuCategories.id });

        if (updated.length === 0) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'category' } });
        }
        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  app.delete(
    '/api/v1/restaurant-portal/menu/categories/:categoryId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const { categoryId } = z.object({ categoryId: uuidSchema }).parse(request.params);

      await ctx.db.transaction(async (tx) => {
        // A category holding items cannot be removed: historical orders
        // reference those items, and the FK is RESTRICT (plan §4.7).
        const [itemCount] = await tx
          .select({ value: count() })
          .from(menuItems)
          .where(and(eq(menuItems.categoryId, categoryId), isNull(menuItems.deletedAt)));

        if ((itemCount?.value ?? 0) > 0) {
          throw new AppError(ERROR_CODES.CONFLICT, {
            details: {
              reason: 'CATEGORY_NOT_EMPTY',
              itemCount: itemCount?.value ?? 0,
              messageHint: 'انقل الأصناف إلى تصنيف آخر أو عطّلها قبل حذف التصنيف',
            },
          });
        }

        // Soft delete, so any report referencing it still resolves.
        await tx
          .update(menuCategories)
          .set({ deletedAt: new Date(), isActive: false })
          .where(
            and(eq(menuCategories.id, categoryId), eq(menuCategories.restaurantId, restaurantId)),
          );

        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.send(success({ deleted: true }, { request_id: request.requestId }));
    },
  );

  app.post(
    '/api/v1/restaurant-portal/menu/items',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const body = itemSchema.parse(request.body);

      const id = uuidv7();
      await ctx.db.transaction(async (tx) => {
        // The category must belong to this restaurant — otherwise an item could
        // be attached to a competitor's menu tree.
        const [category] = await tx
          .select({ id: menuCategories.id })
          .from(menuCategories)
          .where(
            and(
              eq(menuCategories.id, body.category_id),
              eq(menuCategories.restaurantId, restaurantId),
            ),
          )
          .limit(1);

        if (!category) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'category' } });
        }

        await tx.insert(menuItems).values({
          id,
          restaurantId,
          categoryId: body.category_id,
          nameAr: body.name_ar,
          descriptionAr: body.description_ar ?? null,
          basePriceIqd: body.base_price_iqd,
          costPriceIqd: body.cost_price_iqd ?? null,
          sku: body.sku ?? null,
          preparationMinutesOverride: body.preparation_minutes_override ?? null,
          imageAssetId: body.image_asset_id ?? null,
          isPopular: body.is_popular,
          sortOrder: body.sort_order,
        });

        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.status(201).send(success({ id }, { request_id: request.requestId }));
    },
  );

  app.patch(
    '/api/v1/restaurant-portal/menu/items/:itemId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const { itemId } = z.object({ itemId: uuidSchema }).parse(request.params);
      const body = itemSchema
        .partial()
        .extend({ is_active: z.boolean().optional() })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const updated = await tx
          .update(menuItems)
          .set({
            ...(body.category_id ? { categoryId: body.category_id } : {}),
            ...(body.name_ar ? { nameAr: body.name_ar } : {}),
            ...(body.description_ar !== undefined ? { descriptionAr: body.description_ar } : {}),
            ...(body.base_price_iqd !== undefined ? { basePriceIqd: body.base_price_iqd } : {}),
            ...(body.cost_price_iqd !== undefined ? { costPriceIqd: body.cost_price_iqd } : {}),
            ...(body.sku !== undefined ? { sku: body.sku } : {}),
            ...(body.preparation_minutes_override !== undefined
              ? { preparationMinutesOverride: body.preparation_minutes_override }
              : {}),
            ...(body.image_asset_id !== undefined ? { imageAssetId: body.image_asset_id } : {}),
            ...(body.is_popular !== undefined ? { isPopular: body.is_popular } : {}),
            ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
            ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
          .returning({ id: menuItems.id });

        if (updated.length === 0) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'menu_item' } });
        }
        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  /**
   * Availability toggle — the action staff use most, kept separate from the
   * full edit so a Kitchen role can mark something sold out without menu.write.
   */
  app.post(
    '/api/v1/restaurant-portal/menu/items/:itemId/availability',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.read');
      const { itemId } = z.object({ itemId: uuidSchema }).parse(request.params);
      const body = z.object({ is_available: z.boolean() }).parse(request.body);

      const updated = await ctx.db
        .update(menuItems)
        .set({
          isAvailable: body.is_available,
          // A manual toggle clears the inventory flag, so a later restock does
          // not silently re-enable something staff deliberately turned off
          // (plan §37).
          unavailableByInventory: false,
          updatedAt: new Date(),
        })
        .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
        .returning({ id: menuItems.id });

      if (updated.length === 0) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'menu_item' } });
      }

      return reply.send(
        success({ is_available: body.is_available }, { request_id: request.requestId }),
      );
    },
  );

  app.delete(
    '/api/v1/restaurant-portal/menu/items/:itemId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const { itemId } = z.object({ itemId: uuidSchema }).parse(request.params);

      await ctx.db.transaction(async (tx) => {
        // Soft delete: historical order lines reference this row (plan §4.7).
        const deleted = await tx
          .update(menuItems)
          .set({ deletedAt: new Date(), isActive: false, isAvailable: false })
          .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
          .returning({ id: menuItems.id });

        if (deleted.length === 0) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'menu_item' } });
        }
        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.send(success({ deleted: true }, { request_id: request.requestId }));
    },
  );

  // ── Modifier groups (plan §20) ────────────────────────────────────────────

  app.get(
    '/api/v1/restaurant-portal/menu/modifier-groups',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.read');

      const rows = await ctx.db
        .select({
          groupId: modifierGroups.id,
          groupNameAr: modifierGroups.nameAr,
          minSelect: modifierGroups.minSelect,
          maxSelect: modifierGroups.maxSelect,
          isRequired: modifierGroups.isRequired,
          isActive: modifierGroups.isActive,
          modifierId: modifiers.id,
          modifierNameAr: modifiers.nameAr,
          modifierPriceIqd: modifiers.priceIqd,
          modifierAvailable: modifiers.isAvailable,
        })
        .from(modifierGroups)
        .leftJoin(modifiers, eq(modifiers.groupId, modifierGroups.id))
        .where(eq(modifierGroups.restaurantId, restaurantId))
        .orderBy(asc(modifierGroups.sortOrder), asc(modifiers.sortOrder));

      const grouped = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const group = grouped.get(row.groupId) ?? {
          id: row.groupId,
          name_ar: row.groupNameAr,
          min_select: row.minSelect,
          max_select: row.maxSelect,
          is_required: row.isRequired,
          is_active: row.isActive,
          modifiers: [] as unknown[],
        };
        if (row.modifierId) {
          (group.modifiers as unknown[]).push({
            id: row.modifierId,
            name_ar: row.modifierNameAr,
            price_iqd: row.modifierPriceIqd,
            is_available: row.modifierAvailable,
          });
        }
        grouped.set(row.groupId, group);
      }

      return reply.send(success([...grouped.values()], { request_id: request.requestId }));
    },
  );

  app.post(
    '/api/v1/restaurant-portal/menu/modifier-groups',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const body = z
        .object({
          name_ar: arabicTextSchema(2, 60),
          min_select: z.number().int().min(0).max(20).default(0),
          max_select: z.number().int().min(1).max(20).default(1),
          is_required: z.boolean().default(false),
          modifiers: z
            .array(
              z.object({
                name_ar: arabicTextSchema(1, 60),
                price_iqd: iqdAmountSchema.default(0),
              }),
            )
            .min(1)
            .max(20),
        })
        .parse(request.body);

      // Mirrors the DB check constraints so the user gets an Arabic message
      // rather than a constraint violation.
      if (body.max_select < body.min_select) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { message: 'الحد الأقصى للاختيار لا يمكن أن يقل عن الحد الأدنى' },
        });
      }
      if (body.is_required && body.min_select < 1) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { message: 'المجموعة الإلزامية يجب أن تسمح باختيار واحد على الأقل' },
        });
      }

      const groupId = uuidv7();
      await ctx.db.transaction(async (tx) => {
        await tx.insert(modifierGroups).values({
          id: groupId,
          restaurantId,
          nameAr: body.name_ar,
          minSelect: body.min_select,
          maxSelect: body.max_select,
          isRequired: body.is_required,
        });

        await tx.insert(modifiers).values(
          body.modifiers.map((modifier, index) => ({
            id: uuidv7(),
            groupId,
            nameAr: modifier.name_ar,
            priceIqd: modifier.price_iqd,
            sortOrder: index,
          })),
        );

        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.status(201).send(success({ id: groupId }, { request_id: request.requestId }));
    },
  );

  /** Attach or detach a modifier group from an item. */
  app.post(
    '/api/v1/restaurant-portal/menu/items/:itemId/modifier-groups',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'menu.write');
      const { itemId } = z.object({ itemId: uuidSchema }).parse(request.params);
      const body = z.object({ group_id: uuidSchema, attached: z.boolean() }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        // Both sides must belong to this restaurant.
        const [item] = await tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
          .limit(1);
        const [group] = await tx
          .select({ id: modifierGroups.id })
          .from(modifierGroups)
          .where(
            and(
              eq(modifierGroups.id, body.group_id),
              eq(modifierGroups.restaurantId, restaurantId),
            ),
          )
          .limit(1);

        if (!item || !group) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'item_or_group' } });
        }

        if (body.attached) {
          await tx
            .insert(itemModifierGroups)
            .values({ id: uuidv7(), itemId, groupId: body.group_id })
            .onConflictDoNothing();
        } else {
          await tx
            .delete(itemModifierGroups)
            .where(
              and(
                eq(itemModifierGroups.itemId, itemId),
                eq(itemModifierGroups.groupId, body.group_id),
              ),
            );
        }

        await bumpMenuVersion(tx, restaurantId);
      });

      return reply.send(success({ attached: body.attached }, { request_id: request.requestId }));
    },
  );
}
