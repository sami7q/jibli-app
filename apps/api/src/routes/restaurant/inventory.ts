import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, INVENTORY_UNITS, success } from '@jibli/contracts';
import { assertRestaurantPermission } from '@jibli/auth';
import { arabicTextSchema, iqdAmountSchema, reasonSchema, uuidSchema } from '@jibli/validation';
import {
  applyMovement,
  availableQuantity,
  AUDIT_ACTIONS,
  fromMilliUnits,
  isLowStock,
  toMilliUnits,
  writeAudit,
} from '@jibli/domain';
import {
  inventoryItems,
  inventoryMovements,
  menuItems,
  recipes,
  restaurantBranches,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';

/**
 * Restaurant inventory (plan §34–§37, §72).
 *
 * "Do not expose an unrestricted endpoint such as `PATCH quantity=500`. Stock
 * changes are domain commands." Every route here is a named movement that
 * produces an auditable row, and manual adjustments carry a mandatory reason.
 */

const quantitySchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,3})?$/, 'الكمية يجب أن تكون رقماً بثلاث منازل عشرية كحد أقصى');

export function registerRestaurantInventoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/v1/restaurant-portal/inventory',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'inventory.read');

      let canSeeCost = true;
      try {
        assertRestaurantPermission(principal, restaurantId, 'inventory.cost.read');
      } catch {
        canSeeCost = false;
      }

      const rows = await ctx.db
        .select()
        .from(inventoryItems)
        .where(and(eq(inventoryItems.restaurantId, restaurantId), isNull(inventoryItems.deletedAt)))
        .orderBy(inventoryItems.nameAr);

      return reply.send(
        success(
          rows.map((row) => {
            const level = {
              onHand: row.onHandQuantity,
              reserved: row.reservedQuantity,
              allowNegativeStock: row.allowNegativeStock,
              lowStockThreshold: row.lowStockThreshold,
            };
            return {
              id: row.id,
              name_ar: row.nameAr,
              sku: row.sku,
              unit: row.unit,
              on_hand: row.onHandQuantity,
              reserved: row.reservedQuantity,
              // What can actually be sold: on-hand minus what placed orders
              // already hold (plan §36).
              available: availableQuantity(level),
              low_stock_threshold: row.lowStockThreshold,
              is_low_stock: isLowStock(level),
              is_tracked: row.isTracked,
              allow_negative_stock: row.allowNegativeStock,
              ...(canSeeCost ? { unit_cost_iqd: row.unitCostIqd } : {}),
              ...(canSeeCost && row.unitCostIqd
                ? {
                    // Stock value at cost, computed server-side.
                    stock_value_iqd: Math.round(
                      (toMilliUnits(row.onHandQuantity) / 1000) * row.unitCostIqd,
                    ),
                  }
                : {}),
            };
          }),
          { request_id: request.requestId, can_see_cost: canSeeCost },
        ),
      );
    },
  );

  app.post(
    '/api/v1/restaurant-portal/inventory',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'inventory.adjust');
      const body = z
        .object({
          name_ar: arabicTextSchema(2, 80),
          sku: z.string().max(40).optional(),
          unit: z.enum(INVENTORY_UNITS).default('PIECE'),
          opening_quantity: quantitySchema.default('0'),
          low_stock_threshold: quantitySchema.optional(),
          unit_cost_iqd: iqdAmountSchema.optional(),
          allow_negative_stock: z.boolean().default(false),
        })
        .parse(request.body);

      const id = uuidv7();

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

        await tx.insert(inventoryItems).values({
          id,
          restaurantId,
          branchId: branch.id,
          nameAr: body.name_ar,
          sku: body.sku ?? null,
          unit: body.unit,
          onHandQuantity: body.opening_quantity,
          reservedQuantity: '0',
          lowStockThreshold: body.low_stock_threshold ?? null,
          unitCostIqd: body.unit_cost_iqd ?? null,
          allowNegativeStock: body.allow_negative_stock,
        });

        // The opening balance is itself a movement: every unit of stock must be
        // attributable to something (plan §35).
        await tx.insert(inventoryMovements).values({
          id: uuidv7(),
          inventoryItemId: id,
          type: 'OPENING_BALANCE',
          quantityDelta: body.opening_quantity,
          resultingOnHand: body.opening_quantity,
          unitCostIqd: body.unit_cost_iqd ?? null,
          actorUserId: principal.userId,
        });
      });

      return reply.status(201).send(success({ id }, { request_id: request.requestId }));
    },
  );

  /**
   * Stock commands.
   *
   * receive / adjust / waste / return share one implementation because they
   * differ only in movement type, sign and whether a reason is mandatory —
   * three separate handlers would drift.
   */
  const stockCommand = (
    path: string,
    type: 'PURCHASE' | 'ADJUSTMENT' | 'WASTE' | 'RETURN',
    options: { sign: 'IN' | 'OUT' | 'SIGNED'; requiresReason: boolean },
  ) => {
    app.post(
      `/api/v1/restaurant-portal/inventory/:itemId${path}`,
      { preHandler: app.authenticate },
      async (request, reply) => {
        const { principal, restaurantId } = restaurantScope(request);
        assertRestaurantPermission(
          principal,
          restaurantId,
          type === 'WASTE' ? 'inventory.waste' : 'inventory.adjust',
        );

        const { itemId } = z.object({ itemId: uuidSchema }).parse(request.params);
        const body = z
          .object({
            quantity: quantitySchema,
            unit_cost_iqd: iqdAmountSchema.optional(),
            reason: options.requiresReason ? reasonSchema : reasonSchema.optional(),
          })
          .parse(request.body);

        const result = await ctx.db.transaction(async (tx) => {
          const [item] = await tx
            .select()
            .from(inventoryItems)
            .where(
              and(eq(inventoryItems.id, itemId), eq(inventoryItems.restaurantId, restaurantId)),
            )
            .for('update')
            .limit(1);

          if (!item) {
            throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'inventory_item' } });
          }

          // A stock count can find *more* or *less* than recorded, so an
          // adjustment keeps the sign the caller sent. Every other command has
          // one direction by definition, and forcing it there stops a typed
          // minus sign from silently turning a receipt into a write-off.
          const signed = toMilliUnits(body.quantity);
          const magnitude = Math.abs(signed);
          const deltaMilli =
            options.sign === 'SIGNED' ? signed : options.sign === 'OUT' ? -magnitude : magnitude;

          if (deltaMilli === 0) {
            throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
              details: { field: 'quantity', reason: 'ZERO_QUANTITY' },
            });
          }

          const delta = fromMilliUnits(deltaMilli);

          // Domain rules: reason required for manual movements, negative-stock
          // policy respected. Throws with an Arabic-mapped code.
          const applied = applyMovement(
            {
              onHand: item.onHandQuantity,
              reserved: item.reservedQuantity,
              allowNegativeStock: item.allowNegativeStock,
              lowStockThreshold: item.lowStockThreshold,
            },
            type,
            delta,
            body.reason ?? null,
          );

          await tx
            .update(inventoryItems)
            .set({
              onHandQuantity: applied.newOnHand,
              // A purchase updates the cost basis; other movements do not.
              ...(type === 'PURCHASE' && body.unit_cost_iqd !== undefined
                ? { unitCostIqd: body.unit_cost_iqd }
                : {}),
              version: sql`${inventoryItems.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(inventoryItems.id, itemId));

          await tx.insert(inventoryMovements).values({
            id: uuidv7(),
            inventoryItemId: itemId,
            type,
            quantityDelta: delta,
            resultingOnHand: applied.newOnHand,
            unitCostIqd: body.unit_cost_iqd ?? null,
            reason: body.reason ?? null,
            actorUserId: principal.userId,
          });

          // Large manual adjustments are audited beyond the movement row
          // (plan §35).
          if (type === 'ADJUSTMENT' || type === 'WASTE') {
            await writeAudit(tx, {
              actorUserId: principal.userId,
              action: AUDIT_ACTIONS.INVENTORY_ADJUST,
              entityType: 'inventory_item',
              entityId: itemId,
              before: { onHand: item.onHandQuantity },
              after: { onHand: applied.newOnHand, type, delta },
              reason: body.reason ?? null,
              ip: clientIp(request),
              userAgent: userAgent(request),
              requestId: request.requestId,
            });
          }

          return applied.newOnHand;
        });

        return reply.send(success({ on_hand: result }, { request_id: request.requestId }));
      },
    );
  };

  stockCommand('/receive', 'PURCHASE', { sign: 'IN', requiresReason: false });
  stockCommand('/adjust', 'ADJUSTMENT', { sign: 'SIGNED', requiresReason: true });
  stockCommand('/waste', 'WASTE', { sign: 'OUT', requiresReason: true });
  // A return sends goods back to the supplier, so stock leaves the store.
  stockCommand('/return', 'RETURN', { sign: 'OUT', requiresReason: true });

  /** Movement history — how every unit of stock got where it is (plan §35). */
  app.get(
    '/api/v1/restaurant-portal/inventory/:itemId/movements',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'inventory.read');
      const { itemId } = z.object({ itemId: uuidSchema }).parse(request.params);

      const [item] = await ctx.db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.restaurantId, restaurantId)))
        .limit(1);

      if (!item) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'inventory_item' } });
      }

      const rows = await ctx.db
        .select({
          id: inventoryMovements.id,
          type: inventoryMovements.type,
          quantityDelta: inventoryMovements.quantityDelta,
          resultingOnHand: inventoryMovements.resultingOnHand,
          reason: inventoryMovements.reason,
          orderId: inventoryMovements.orderId,
          actorName: users.fullName,
          createdAt: inventoryMovements.createdAt,
        })
        .from(inventoryMovements)
        .leftJoin(users, eq(inventoryMovements.actorUserId, users.id))
        .where(eq(inventoryMovements.inventoryItemId, itemId))
        .orderBy(desc(inventoryMovements.createdAt))
        .limit(100);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            type: row.type,
            quantity_delta: row.quantityDelta,
            resulting_on_hand: row.resultingOnHand,
            reason: row.reason,
            order_id: row.orderId,
            actor_name: row.actorName ?? 'النظام',
            created_at: row.createdAt.toISOString(),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  // ── Recipes (plan §37) ────────────────────────────────────────────────────

  app.get(
    '/api/v1/restaurant-portal/inventory/recipes',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'inventory.read');

      const rows = await ctx.db
        .select({
          menuItemId: recipes.menuItemId,
          menuItemNameAr: menuItems.nameAr,
          inventoryItemId: recipes.inventoryItemId,
          ingredientNameAr: inventoryItems.nameAr,
          quantityPerUnit: recipes.quantityPerUnit,
          unit: inventoryItems.unit,
        })
        .from(recipes)
        .innerJoin(menuItems, eq(recipes.menuItemId, menuItems.id))
        .innerJoin(inventoryItems, eq(recipes.inventoryItemId, inventoryItems.id))
        .where(eq(menuItems.restaurantId, restaurantId));

      const grouped = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const entry = grouped.get(row.menuItemId) ?? {
          menu_item_id: row.menuItemId,
          menu_item_name_ar: row.menuItemNameAr,
          ingredients: [] as unknown[],
        };
        (entry.ingredients as unknown[]).push({
          inventory_item_id: row.inventoryItemId,
          name_ar: row.ingredientNameAr,
          quantity_per_unit: row.quantityPerUnit,
          unit: row.unit,
        });
        grouped.set(row.menuItemId, entry);
      }

      return reply.send(success([...grouped.values()], { request_id: request.requestId }));
    },
  );

  app.post(
    '/api/v1/restaurant-portal/inventory/recipes',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'inventory.adjust');
      const body = z
        .object({
          menu_item_id: uuidSchema,
          inventory_item_id: uuidSchema,
          quantity_per_unit: quantitySchema,
        })
        .parse(request.body);

      if (toMilliUnits(body.quantity_per_unit) <= 0) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { message: 'الكمية يجب أن تكون أكبر من صفر' },
        });
      }

      await ctx.db.transaction(async (tx) => {
        // Both sides must belong to this restaurant: a recipe reaching another
        // restaurant's stock would let one consume the other's inventory.
        const [item] = await tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(and(eq(menuItems.id, body.menu_item_id), eq(menuItems.restaurantId, restaurantId)))
          .limit(1);

        const [ingredient] = await tx
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.id, body.inventory_item_id),
              eq(inventoryItems.restaurantId, restaurantId),
            ),
          )
          .limit(1);

        if (!item || !ingredient) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'item_or_ingredient' } });
        }

        await tx
          .insert(recipes)
          .values({
            id: uuidv7(),
            menuItemId: body.menu_item_id,
            inventoryItemId: body.inventory_item_id,
            quantityPerUnit: body.quantity_per_unit,
          })
          .onConflictDoUpdate({
            target: [recipes.menuItemId, recipes.inventoryItemId],
            set: { quantityPerUnit: body.quantity_per_unit, updatedAt: new Date() },
          });
      });

      return reply.status(201).send(success({ saved: true }, { request_id: request.requestId }));
    },
  );

  app.delete(
    '/api/v1/restaurant-portal/inventory/recipes',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'inventory.adjust');
      const body = z
        .object({ menu_item_id: uuidSchema, inventory_item_id: uuidSchema })
        .parse(request.body);

      await ctx.db
        .delete(recipes)
        .where(
          and(
            eq(recipes.menuItemId, body.menu_item_id),
            eq(recipes.inventoryItemId, body.inventory_item_id),
          ),
        );

      return reply.send(success({ deleted: true }, { request_id: request.requestId }));
    },
  );
}
