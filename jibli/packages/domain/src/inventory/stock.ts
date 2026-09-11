import { AppError, ERROR_CODES, type InventoryMovementType } from '@jibli/contracts';

/**
 * Stock arithmetic (plan §34–§36, §101).
 *
 * Quantities carry decimals (0.250 kg, 20.5 L) and must not go through binary
 * floating point — 0.1 + 0.2 !== 0.3 would slowly corrupt cost of goods. All
 * arithmetic here is done in integer "milli-units" (3 decimal places, matching
 * the numeric(14,3) columns) and rendered back as fixed-precision strings.
 */

export const QUANTITY_SCALE = 3;
const SCALE_FACTOR = 10 ** QUANTITY_SCALE;

/** Parse a numeric(14,3) string into integer milli-units. */
export function toMilliUnits(value: string | number): number {
  const text = typeof value === 'number' ? value.toFixed(QUANTITY_SCALE) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { field: 'quantity', message: `Invalid quantity: ${value}` },
    });
  }
  const negative = text.startsWith('-');
  const [wholePart = '0', fractionPart = ''] = text.replace('-', '').split('.');
  // Pad or truncate the fraction to exactly the column's scale.
  const fraction = (fractionPart + '000').slice(0, QUANTITY_SCALE);
  const magnitude = Number(wholePart) * SCALE_FACTOR + Number(fraction);
  return negative ? -magnitude : magnitude;
}

/** Render integer milli-units back to the string form the column stores. */
export function fromMilliUnits(milli: number): string {
  const negative = milli < 0;
  const magnitude = Math.abs(milli);
  const whole = Math.floor(magnitude / SCALE_FACTOR);
  const fraction = String(magnitude % SCALE_FACTOR).padStart(QUANTITY_SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export interface StockLevel {
  /** numeric(14,3) as returned by the driver. */
  readonly onHand: string;
  readonly reserved: string;
  readonly allowNegativeStock: boolean;
  readonly lowStockThreshold: string | null;
}

/** What is actually orderable: on hand minus what is already spoken for. */
export function availableQuantity(level: Pick<StockLevel, 'onHand' | 'reserved'>): string {
  return fromMilliUnits(toMilliUnits(level.onHand) - toMilliUnits(level.reserved));
}

export interface ReservationResult {
  readonly newReserved: string;
  readonly availableAfter: string;
}

/**
 * Reserve stock for a placed order (plan §36).
 *
 * "If one cake remains and two customers place orders at the same moment, an
 * atomic conditional update or row lock ensures only one reservation succeeds."
 * This function decides *whether* the reservation is legal; the caller must
 * apply it under a row lock or a conditional UPDATE for the race to be closed —
 * checking here and writing unguarded would still oversell.
 */
export function reserveStock(level: StockLevel, requested: string | number): ReservationResult {
  const requestedMilli = toMilliUnits(requested);
  if (requestedMilli <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { field: 'quantity', message: 'Reservation quantity must be positive' },
    });
  }

  const onHandMilli = toMilliUnits(level.onHand);
  const reservedMilli = toMilliUnits(level.reserved);
  const availableMilli = onHandMilli - reservedMilli;

  if (!level.allowNegativeStock && requestedMilli > availableMilli) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, {
      details: {
        requested: fromMilliUnits(requestedMilli),
        available: fromMilliUnits(availableMilli),
        onHand: level.onHand,
        reserved: level.reserved,
      },
    });
  }

  const newReservedMilli = reservedMilli + requestedMilli;
  return {
    newReserved: fromMilliUnits(newReservedMilli),
    availableAfter: fromMilliUnits(onHandMilli - newReservedMilli),
  };
}

/** Release a reservation when an order is rejected or cancelled before consumption. */
export function releaseReservation(level: StockLevel, quantity: string | number): string {
  const releaseMilli = toMilliUnits(quantity);
  const reservedMilli = toMilliUnits(level.reserved);
  // Never let reserved go negative: that would silently inflate availability.
  return fromMilliUnits(Math.max(0, reservedMilli - releaseMilli));
}

export interface ConsumptionResult {
  readonly newOnHand: string;
  readonly newReserved: string;
}

/**
 * Convert a reservation into consumption (plan §36).
 *
 * On-hand falls and the reservation is released together: doing only one would
 * either double-count the stock or leave a permanent phantom hold.
 */
export function consumeReservation(level: StockLevel, quantity: string | number): ConsumptionResult {
  const consumeMilli = toMilliUnits(quantity);
  const onHandMilli = toMilliUnits(level.onHand);
  const reservedMilli = toMilliUnits(level.reserved);

  const newOnHandMilli = onHandMilli - consumeMilli;
  if (!level.allowNegativeStock && newOnHandMilli < 0) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, {
      details: { requested: fromMilliUnits(consumeMilli), onHand: level.onHand },
    });
  }

  return {
    newOnHand: fromMilliUnits(newOnHandMilli),
    newReserved: fromMilliUnits(Math.max(0, reservedMilli - consumeMilli)),
  };
}

/** Apply a signed delta for receive / adjust / waste / return movements. */
export function applyMovement(
  level: StockLevel,
  type: InventoryMovementType,
  delta: string | number,
  reason?: string | null,
): { newOnHand: string } {
  // Manual movements always carry a reason (plan §35); the DB constraint
  // mirrors this, but failing here gives the user a usable Arabic message.
  if ((type === 'ADJUSTMENT' || type === 'WASTE') && !reason?.trim()) {
    throw new AppError(ERROR_CODES.INVENTORY_ADJUSTMENT_REASON_REQUIRED, {
      details: { movementType: type },
    });
  }

  const deltaMilli = toMilliUnits(delta);
  const newOnHandMilli = toMilliUnits(level.onHand) + deltaMilli;

  if (!level.allowNegativeStock && newOnHandMilli < 0) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, {
      details: { onHand: level.onHand, delta: fromMilliUnits(deltaMilli) },
    });
  }

  return { newOnHand: fromMilliUnits(newOnHandMilli) };
}

/**
 * Has the item crossed its low-stock threshold?
 *
 * Compares *available*, not on-hand: stock already reserved for placed orders
 * cannot be sold again, so counting it would delay the alert past the point of
 * usefulness.
 */
export function isLowStock(level: StockLevel): boolean {
  if (level.lowStockThreshold === null) return false;
  return toMilliUnits(availableQuantity(level)) <= toMilliUnits(level.lowStockThreshold);
}

/** Quantity of each ingredient a set of order lines consumes (plan §37). */
export interface RecipeLine {
  readonly inventoryItemId: string;
  readonly quantityPerUnit: string;
}

export function explodeRecipes(
  orderLines: readonly { menuItemId: string; quantity: number }[],
  recipesByItem: ReadonlyMap<string, readonly RecipeLine[]>,
): Map<string, string> {
  const totals = new Map<string, number>();

  for (const line of orderLines) {
    const recipe = recipesByItem.get(line.menuItemId);
    if (!recipe) continue;
    for (const ingredient of recipe) {
      const required = toMilliUnits(ingredient.quantityPerUnit) * line.quantity;
      totals.set(
        ingredient.inventoryItemId,
        (totals.get(ingredient.inventoryItemId) ?? 0) + required,
      );
    }
  }

  return new Map([...totals].map(([id, milli]) => [id, fromMilliUnits(milli)]));
}
