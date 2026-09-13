import { AppError, ERROR_CODES } from '@jibli/contracts';
import {
  calculateOrderTotals,
  iqd,
  type DiscountInput,
  type Iqd,
  type OrderTotals,
} from '@jibli/money';

/**
 * Quote building (plan §20, §22, §27).
 *
 * "The client cannot send a final trusted price. Price is always recalculated
 * from current menu configuration." Everything here works from catalog rows the
 * server loaded; the only thing taken from the request is *which* item and
 * *which* modifiers, never what they cost.
 */

export interface CatalogModifier {
  readonly id: string;
  readonly groupId: string;
  readonly nameAr: string;
  readonly priceIqd: number;
  readonly isAvailable: boolean;
}

export interface CatalogModifierGroup {
  readonly id: string;
  readonly nameAr: string;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly isRequired: boolean;
  readonly isActive: boolean;
  readonly modifiers: readonly CatalogModifier[];
}

export interface CatalogItem {
  readonly id: string;
  readonly restaurantId: string;
  readonly nameAr: string;
  readonly basePriceIqd: number;
  readonly costPriceIqd: number | null;
  readonly isActive: boolean;
  readonly isAvailable: boolean;
  readonly modifierGroups: readonly CatalogModifierGroup[];
}

/** What the client asked for — IDs and quantity only. */
export interface RequestedLine {
  readonly menuItemId: string;
  readonly quantity: number;
  readonly modifierIds: readonly string[];
  readonly notes?: string | null;
}

/** A fully priced line, ready to be snapshotted onto an order. */
export interface QuotedLine {
  readonly menuItemId: string;
  readonly nameArSnapshot: string;
  readonly unitPriceIqdSnapshot: Iqd;
  readonly costPriceIqdSnapshot: Iqd | null;
  readonly quantity: number;
  readonly lineTotalIqd: Iqd;
  readonly notes: string | null;
  readonly modifiers: readonly {
    readonly modifierId: string;
    readonly groupNameArSnapshot: string;
    readonly nameArSnapshot: string;
    readonly priceIqdSnapshot: Iqd;
  }[];
}

export interface QuoteInput {
  readonly restaurantId: string;
  readonly requestedLines: readonly RequestedLine[];
  /** Catalog rows the server loaded, keyed by item ID. */
  readonly catalog: ReadonlyMap<string, CatalogItem>;
  readonly deliveryFeeIqd: number;
  readonly platformServiceFeeIqd: number;
  readonly commissionFlatIqd: number;
  readonly minimumOrderIqd: number;
  readonly discounts?: readonly DiscountInput[];
}

export interface Quote {
  readonly lines: readonly QuotedLine[];
  readonly totals: OrderTotals;
}

/**
 * Validate a modifier selection against its group's rules.
 *
 * Plan §20: "The backend validates modifier ownership and selection rules."
 * Ownership matters as much as count — a modifier ID from another restaurant's
 * menu must not attach to this item even if the numbers happen to work out.
 */
function validateAndPriceModifiers(
  item: CatalogItem,
  requestedModifierIds: readonly string[],
): QuotedLine['modifiers'] {
  const selected = new Set(requestedModifierIds);

  // Build the set of modifiers legitimately reachable from this item.
  const reachable = new Map<string, { modifier: CatalogModifier; group: CatalogModifierGroup }>();
  for (const group of item.modifierGroups) {
    if (!group.isActive) continue;
    for (const modifier of group.modifiers) {
      reachable.set(modifier.id, { modifier, group });
    }
  }

  for (const id of selected) {
    const found = reachable.get(id);
    if (!found) {
      throw new AppError(ERROR_CODES.MODIFIER_SELECTION_INVALID, {
        details: { menuItemId: item.id, modifierId: id, reason: 'MODIFIER_NOT_ON_ITEM' },
      });
    }
    if (!found.modifier.isAvailable) {
      throw new AppError(ERROR_CODES.ITEM_UNAVAILABLE, {
        details: {
          menuItemId: item.id,
          modifierId: id,
          nameAr: found.modifier.nameAr,
          reason: 'MODIFIER_UNAVAILABLE',
        },
      });
    }
  }

  // Per-group min/max and required rules.
  for (const group of item.modifierGroups) {
    if (!group.isActive) continue;
    const chosen = group.modifiers.filter((m) => selected.has(m.id));
    if (group.isRequired && chosen.length < Math.max(1, group.minSelect)) {
      throw new AppError(ERROR_CODES.MODIFIER_SELECTION_INVALID, {
        details: {
          menuItemId: item.id,
          groupId: group.id,
          groupNameAr: group.nameAr,
          reason: 'GROUP_REQUIRED',
          minSelect: group.minSelect,
        },
      });
    }
    if (chosen.length < group.minSelect && chosen.length > 0) {
      throw new AppError(ERROR_CODES.MODIFIER_SELECTION_INVALID, {
        details: { menuItemId: item.id, groupId: group.id, reason: 'BELOW_MIN_SELECT' },
      });
    }
    if (chosen.length > group.maxSelect) {
      throw new AppError(ERROR_CODES.MODIFIER_SELECTION_INVALID, {
        details: {
          menuItemId: item.id,
          groupId: group.id,
          groupNameAr: group.nameAr,
          reason: 'ABOVE_MAX_SELECT',
          maxSelect: group.maxSelect,
        },
      });
    }
  }

  return [...selected].map((id) => {
    const { modifier, group } = reachable.get(id) as {
      modifier: CatalogModifier;
      group: CatalogModifierGroup;
    };
    return {
      modifierId: modifier.id,
      groupNameArSnapshot: group.nameAr,
      nameArSnapshot: modifier.nameAr,
      priceIqdSnapshot: iqd(modifier.priceIqd),
    };
  });
}

/**
 * Price a cart into an authoritative quote.
 *
 * Called by both `POST /checkout/quote` (to show the customer) and by
 * PlaceOrder (to decide what is actually charged). Running the same code for
 * both is what stops a displayed total from drifting away from a charged one.
 */
export function buildQuote(input: QuoteInput): Quote {
  if (input.requestedLines.length === 0) {
    throw new AppError(ERROR_CODES.CART_EMPTY);
  }

  const lines: QuotedLine[] = [];

  for (const requested of input.requestedLines) {
    const item = input.catalog.get(requested.menuItemId);
    if (!item) {
      throw new AppError(ERROR_CODES.NOT_FOUND, {
        details: { menuItemId: requested.menuItemId, entity: 'menu_item' },
      });
    }

    // Tenant check: an item ID from another restaurant must never price here,
    // even though it exists and has a valid price of its own.
    if (item.restaurantId !== input.restaurantId) {
      throw new AppError(ERROR_CODES.ITEM_NOT_IN_RESTAURANT, {
        details: { menuItemId: item.id, restaurantId: input.restaurantId },
      });
    }

    if (!item.isActive || !item.isAvailable) {
      throw new AppError(ERROR_CODES.ITEM_UNAVAILABLE, {
        details: { menuItemId: item.id, nameAr: item.nameAr },
      });
    }

    const modifiers = validateAndPriceModifiers(item, requested.modifierIds);
    const modifierUnitPrices = modifiers.map((m) => m.priceIqdSnapshot);
    const unitPrice = iqd(item.basePriceIqd);
    const perUnit = modifierUnitPrices.reduce<number>((sum, m) => sum + m, unitPrice);

    lines.push({
      menuItemId: item.id,
      nameArSnapshot: item.nameAr,
      unitPriceIqdSnapshot: unitPrice,
      costPriceIqdSnapshot: item.costPriceIqd === null ? null : iqd(item.costPriceIqd),
      quantity: requested.quantity,
      lineTotalIqd: iqd(perUnit * requested.quantity),
      notes: requested.notes ?? null,
      modifiers,
    });
  }

  const totals = calculateOrderTotals({
    lines: lines.map((line) => ({
      unitPriceIqd: line.unitPriceIqdSnapshot,
      quantity: line.quantity,
      modifierUnitPricesIqd: line.modifiers.map((m) => m.priceIqdSnapshot),
    })),
    discounts: input.discounts,
    deliveryFeeIqd: iqd(input.deliveryFeeIqd),
    platformServiceFeeIqd: iqd(input.platformServiceFeeIqd),
    commissionFlatIqd: iqd(input.commissionFlatIqd),
  });

  // Minimum order is judged on the items subtotal, not the total: adding a
  // delivery fee to reach a minimum would be misleading (plan §22).
  if (totals.itemsSubtotalIqd < input.minimumOrderIqd) {
    throw new AppError(ERROR_CODES.MINIMUM_ORDER_NOT_MET, {
      details: {
        minimumOrderIqd: input.minimumOrderIqd,
        itemsSubtotalIqd: totals.itemsSubtotalIqd,
      },
    });
  }

  return { lines, totals };
}

/**
 * Compare a client's expected total against the authoritative one.
 *
 * The client sends what it displayed; if the server computes something else the
 * customer must confirm rather than be silently charged a different amount
 * (plan §112 PRICE_CHANGED).
 */
export function assertQuoteUnchanged(
  expectedTotalIqd: number | null | undefined,
  actual: OrderTotals,
): void {
  if (expectedTotalIqd === null || expectedTotalIqd === undefined) return;
  if (expectedTotalIqd !== actual.customerTotalIqd) {
    throw new AppError(ERROR_CODES.PRICE_CHANGED, {
      details: {
        expectedTotalIqd,
        currentTotalIqd: actual.customerTotalIqd,
        itemsSubtotalIqd: actual.itemsSubtotalIqd,
        deliveryFeeIqd: actual.deliveryFeeIqd,
        platformServiceFeeIqd: actual.platformServiceFeeIqd,
      },
    });
  }
}

/** Resolve the commission fee in force at a moment (plan §24). */
export interface CommissionConfig {
  readonly commissionFlatIqd: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export function resolveCommissionFee(
  configs: readonly CommissionConfig[],
  at: Date = new Date(),
): Iqd {
  const active = configs.find(
    (c) =>
      c.effectiveFrom.getTime() <= at.getTime() &&
      (c.effectiveTo === null || c.effectiveTo.getTime() > at.getTime()),
  );
  if (!active) {
    throw new AppError(ERROR_CODES.COMMISSION_CONFIG_MISSING, {
      details: { at: at.toISOString() },
    });
  }
  return iqd(active.commissionFlatIqd);
}
