import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import {
  explodeRecipes,
  fromMilliUnits,
  reserveStock,
  toMilliUnits,
  type RecipeLine,
} from '@jibli/domain';
import {
  inventoryItems,
  inventoryMovements,
  inventoryReservations,
  recipes,
  uuidv7,
  type Transaction,
} from '@jibli/db';

/**
 * Inventory reservation during order placement (plan §36).
 *
 * "Do not reserve stock merely because an item is in a cart. Order placement
 * reserves."
 *
 * The concurrency rule the plan is explicit about: "If one cake remains and two
 * customers place orders at the same moment, an atomic conditional update or row
 * lock ensures only one reservation succeeds. Overselling cannot be solved only
 * with UI disabling."
 *
 * This module locks each inventory row FOR UPDATE inside the PlaceOrder
 * transaction, so the second order blocks until the first commits and then sees
 * the reduced availability. Checking availability and writing without the lock
 * would leave exactly the race the plan forbids.
 */

export interface ReservationLine {
  readonly menuItemId: string;
  readonly quantity: number;
}

export interface ReservationResult {
  /** How many distinct inventory items were held. */
  readonly reservedItemCount: number;
  /** Items that crossed their low-stock threshold as a result of this order. */
  readonly lowStockItemIds: string[];
}

/**
 * Load the recipe graph for the ordered items.
 *
 * Items with no recipe simply consume no tracked stock — a drink bought in and
 * resold does not need an ingredient breakdown, and forcing one would make the
 * feature unusable for most menus.
 */
async function loadRecipes(
  tx: Transaction,
  menuItemIds: readonly string[],
): Promise<Map<string, RecipeLine[]>> {
  if (menuItemIds.length === 0) return new Map();

  const rows = await tx
    .select({
      menuItemId: recipes.menuItemId,
      inventoryItemId: recipes.inventoryItemId,
      quantityPerUnit: recipes.quantityPerUnit,
    })
    .from(recipes)
    .where(inArray(recipes.menuItemId, [...menuItemIds]));

  const grouped = new Map<string, RecipeLine[]>();
  for (const row of rows) {
    const list = grouped.get(row.menuItemId) ?? [];
    list.push({
      inventoryItemId: row.inventoryItemId,
      quantityPerUnit: row.quantityPerUnit,
    });
    grouped.set(row.menuItemId, list);
  }
  return grouped;
}

/**
 * Reserve stock for an order.
 *
 * Called inside the PlaceOrder transaction, so a failure here rolls the whole
 * order back — a customer is never charged for an order the kitchen cannot make.
 */
export async function reserveInventoryForOrder(
  tx: Transaction,
  params: {
    orderId: string;
    branchId: string;
    lines: readonly ReservationLine[];
  },
): Promise<ReservationResult> {
  const recipesByItem = await loadRecipes(
    tx,
    params.lines.map((line) => line.menuItemId),
  );

  if (recipesByItem.size === 0) {
    return { reservedItemCount: 0, lowStockItemIds: [] };
  }

  // Turn menu quantities into ingredient quantities.
  const required = explodeRecipes(
    params.lines.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
    recipesByItem,
  );

  if (required.size === 0) {
    return { reservedItemCount: 0, lowStockItemIds: [] };
  }

  /*
   * Lock in a deterministic order.
   *
   * Two orders needing the same two ingredients in opposite orders would
   * deadlock. Sorting by ID gives every transaction the same lock sequence, so
   * one simply waits for the other.
   */
  const inventoryItemIds = [...required.keys()].sort();
  const lowStockItemIds: string[] = [];
  let reservedItemCount = 0;

  for (const inventoryItemId of inventoryItemIds) {
    const neededQuantity = required.get(inventoryItemId);
    if (!neededQuantity) continue;

    const [item] = await tx
      .select({
        id: inventoryItems.id,
        branchId: inventoryItems.branchId,
        nameAr: inventoryItems.nameAr,
        onHandQuantity: inventoryItems.onHandQuantity,
        reservedQuantity: inventoryItems.reservedQuantity,
        lowStockThreshold: inventoryItems.lowStockThreshold,
        allowNegativeStock: inventoryItems.allowNegativeStock,
        isTracked: inventoryItems.isTracked,
        version: inventoryItems.version,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, inventoryItemId))
      .for('update')
      .limit(1);

    // A recipe pointing at a deleted ingredient must not silently succeed:
    // the restaurant thinks it is tracking that stock.
    if (!item) {
      throw new AppError(ERROR_CODES.STOCK_CONFLICT, {
        details: { inventoryItemId, reason: 'INVENTORY_ITEM_MISSING' },
      });
    }

    // Ingredients belong to a branch. A recipe reaching another branch's stock
    // would let one location consume another's inventory.
    if (item.branchId !== params.branchId) {
      throw new AppError(ERROR_CODES.STOCK_CONFLICT, {
        details: { inventoryItemId, reason: 'INVENTORY_ITEM_WRONG_BRANCH' },
      });
    }

    // Untracked items are deliberately exempt: the restaurant opted out of
    // counting them, so there is nothing to reserve.
    if (!item.isTracked) continue;

    // Throws INSUFFICIENT_STOCK with the available quantity in details, which
    // is what lets the app name the item that ran out (plan §112).
    let reservation;
    try {
      reservation = reserveStock(
        {
          onHand: item.onHandQuantity,
          reserved: item.reservedQuantity,
          allowNegativeStock: item.allowNegativeStock,
          lowStockThreshold: item.lowStockThreshold,
        },
        neededQuantity,
      );
    } catch (error) {
      if (AppError.hasCode(error, ERROR_CODES.INSUFFICIENT_STOCK)) {
        throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, {
          details: { ...error.details, inventoryItemId, nameAr: item.nameAr },
        });
      }
      throw error;
    }

    await tx
      .update(inventoryItems)
      .set({
        reservedQuantity: reservation.newReserved,
        version: sql`${inventoryItems.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, item.id));

    await tx.insert(inventoryReservations).values({
      id: uuidv7(),
      inventoryItemId: item.id,
      orderId: params.orderId,
      quantityReserved: neededQuantity,
      status: 'ACTIVE',
    });

    await tx.insert(inventoryMovements).values({
      id: uuidv7(),
      inventoryItemId: item.id,
      type: 'RESERVATION',
      // A reservation moves the reserved column, not on-hand — the stock is
      // still physically present until the kitchen uses it.
      quantityDelta: neededQuantity,
      resultingOnHand: item.onHandQuantity,
      orderId: params.orderId,
      // Unique per order+item, so a retried placement cannot reserve twice.
      idempotencyKey: `reserve:${params.orderId}:${item.id}`,
    });

    reservedItemCount += 1;

    // Low stock is judged on what remains sellable, not on what is on the shelf.
    if (item.lowStockThreshold !== null) {
      const availableAfter = toMilliUnits(reservation.availableAfter);
      if (availableAfter <= toMilliUnits(item.lowStockThreshold)) {
        lowStockItemIds.push(item.id);
      }
    }
  }

  return { reservedItemCount, lowStockItemIds };
}

/**
 * Release reservations when an order will not be fulfilled (plan §36).
 *
 * Used by rejection, cancellation, and the stale-reservation sweeper.
 */
export async function releaseInventoryForOrder(
  tx: Transaction,
  orderId: string,
): Promise<number> {
  const reservations = await tx
    .select()
    .from(inventoryReservations)
    .where(
      and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, 'ACTIVE')),
    );

  let released = 0;

  for (const reservation of reservations) {
    const [item] = await tx
      .select({
        id: inventoryItems.id,
        onHandQuantity: inventoryItems.onHandQuantity,
        reservedQuantity: inventoryItems.reservedQuantity,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, reservation.inventoryItemId))
      .for('update')
      .limit(1);

    if (!item) continue;

    // GREATEST(0, …) in SQL rather than a computed value: if two releases race,
    // the reserved column must never go negative and inflate availability.
    await tx
      .update(inventoryItems)
      .set({
        reservedQuantity: sql`GREATEST(0, ${inventoryItems.reservedQuantity}::numeric - ${reservation.quantityReserved}::numeric)`,
        version: sql`${inventoryItems.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, item.id));

    await tx.insert(inventoryMovements).values({
      id: uuidv7(),
      inventoryItemId: item.id,
      type: 'RESERVATION_RELEASE',
      quantityDelta: `-${reservation.quantityReserved}`,
      resultingOnHand: item.onHandQuantity,
      orderId,
      idempotencyKey: `release:${orderId}:${item.id}`,
    });

    await tx
      .update(inventoryReservations)
      .set({ status: 'RELEASED', releasedAt: new Date() })
      .where(eq(inventoryReservations.id, reservation.id));

    released += 1;
  }

  return released;
}

/**
 * Convert reservations into consumption (plan §36).
 *
 * When this happens is the restaurant's policy — on accept, on ready, or on
 * delivery. The COD completion path calls this for anything still outstanding.
 */
export async function consumeInventoryForOrder(
  tx: Transaction,
  orderId: string,
): Promise<number> {
  const reservations = await tx
    .select()
    .from(inventoryReservations)
    .where(
      and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, 'ACTIVE')),
    );

  let consumed = 0;

  for (const reservation of reservations) {
    const [item] = await tx
      .select({
        id: inventoryItems.id,
        onHandQuantity: inventoryItems.onHandQuantity,
        reservedQuantity: inventoryItems.reservedQuantity,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, reservation.inventoryItemId))
      .for('update')
      .limit(1);

    if (!item) continue;

    const resultingOnHand = fromMilliUnits(
      toMilliUnits(item.onHandQuantity) - toMilliUnits(reservation.quantityReserved),
    );

    // On-hand falls and the hold clears together. Doing only one would either
    // double-count the stock or leave a permanent phantom reservation.
    await tx
      .update(inventoryItems)
      .set({
        onHandQuantity: resultingOnHand,
        reservedQuantity: sql`GREATEST(0, ${inventoryItems.reservedQuantity}::numeric - ${reservation.quantityReserved}::numeric)`,
        version: sql`${inventoryItems.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, item.id));

    await tx.insert(inventoryMovements).values({
      id: uuidv7(),
      inventoryItemId: item.id,
      type: 'SALE_CONSUMPTION',
      quantityDelta: `-${reservation.quantityReserved}`,
      resultingOnHand,
      orderId,
      idempotencyKey: `consume:${orderId}:${item.id}`,
    });

    await tx
      .update(inventoryReservations)
      .set({ status: 'CONSUMED', consumedAt: new Date() })
      .where(eq(inventoryReservations.id, reservation.id));

    consumed += 1;
  }

  return consumed;
}
