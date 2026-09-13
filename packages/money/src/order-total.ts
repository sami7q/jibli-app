import {
  addIqd,
  applyBps,
  clampNonNegative,
  iqd,
  minIqd,
  MoneyError,
  subtractIqd,
  ZERO_IQD,
  type Bps,
  type Iqd,
} from './money.js';

/**
 * The canonical order arithmetic. Plan §6 requires exactly one implementation of
 * the commission formula; every caller — quote endpoint, PlaceOrder transaction,
 * settlement generation, reports and exports — routes through here.
 *
 * Jibli's commission is a flat fee per order, not a percentage: the platform
 * charges the same amount whether the order is 5,000 or 50,000, because the
 * work it does for the restaurant — the listing, the order, the settlement — is
 * the same either way. The amount is one number in Admin settings.
 *
 * Worked example:
 *
 *   Items subtotal          30,000
 *   Restaurant discount     -2,000
 *   Delivery fee            +2,000
 *   Platform service fee    +1,000
 *   Customer total          31,000
 *
 *   Commission base = 30,000 - 2,000 = 28,000
 *   Commission = 500 (the flat fee, unchanged by the base)
 *
 * The base still matters, for one rule: the commission is capped at it. A flat
 * fee larger than the order would otherwise make the restaurant's net negative
 * — arithmetic should not depend on the minimum-order policy holding.
 */

/**
 * Who keeps the delivery fee. Release 1 uses restaurant-owned drivers, so the
 * default is RESTAURANT — the fee is not platform revenue and is not commissionable.
 */
export type DeliveryFeeBeneficiary = 'RESTAURANT' | 'PLATFORM';

/** Plan §60: which side funds a discount decides whether it reduces the commission base. */
export type DiscountFunding = 'PLATFORM' | 'RESTAURANT' | 'SHARED';

export interface OrderLineInput {
  /** Unit price captured from the menu at quote time, never from the client. */
  readonly unitPriceIqd: Iqd;
  readonly quantity: number;
  /** Per-unit modifier surcharges, already validated against the item's groups. */
  readonly modifierUnitPricesIqd: readonly Iqd[];
}

export interface DiscountInput {
  readonly amountIqd: Iqd;
  readonly funding: DiscountFunding;
  /** For SHARED funding: how much of the discount the restaurant carries, in bps. */
  readonly restaurantShareBps?: Bps;
}

export interface OrderTotalsInput {
  readonly lines: readonly OrderLineInput[];
  readonly discounts?: readonly DiscountInput[];
  readonly deliveryFeeIqd: Iqd;
  readonly platformServiceFeeIqd: Iqd;
  /** Jibli's flat fee for this order, frozen onto it at placement. */
  readonly commissionFlatIqd: Iqd;
  readonly deliveryFeeBeneficiary?: DeliveryFeeBeneficiary;
}

export interface OrderTotals {
  readonly itemsSubtotalIqd: Iqd;
  readonly restaurantFundedDiscountIqd: Iqd;
  readonly platformFundedDiscountIqd: Iqd;
  readonly discountTotalIqd: Iqd;
  readonly deliveryFeeIqd: Iqd;
  readonly platformServiceFeeIqd: Iqd;
  /** What the customer pays, and for COD exactly what the driver collects in cash. */
  readonly customerTotalIqd: Iqd;
  /** What the restaurant earns before commission; the commission is capped at it. */
  readonly commissionBaseIqd: Iqd;
  readonly commissionFlatIqdSnapshot: Iqd;
  /** The flat fee, or the base when the base is smaller. */
  readonly commissionAmountIqd: Iqd;
  /** What the restaurant keeps from this order once Jibli's commission is deducted. */
  readonly restaurantNetIqd: Iqd;
  /** Jibli's gross revenue from this order: commission + service fee (± fee ownership). */
  readonly platformRevenueIqd: Iqd;
}

export function lineTotal(line: OrderLineInput): Iqd {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new MoneyError(`Order line quantity must be a positive integer, got ${line.quantity}`);
  }
  const modifiersPerUnit = line.modifierUnitPricesIqd.reduce<number>((sum, m) => sum + m, 0);
  return iqd((line.unitPriceIqd + modifiersPerUnit) * line.quantity);
}

/**
 * Split a discount into the restaurant-funded and platform-funded halves.
 * Only the restaurant-funded half reduces the commission base.
 */
function splitDiscount(discount: DiscountInput): { restaurant: Iqd; platform: Iqd } {
  switch (discount.funding) {
    case 'RESTAURANT':
      return { restaurant: discount.amountIqd, platform: ZERO_IQD };
    case 'PLATFORM':
      return { restaurant: ZERO_IQD, platform: discount.amountIqd };
    case 'SHARED': {
      if (discount.restaurantShareBps === undefined) {
        throw new MoneyError('SHARED discount requires restaurantShareBps');
      }
      const restaurant = applyBps(discount.amountIqd, discount.restaurantShareBps);
      // The platform absorbs the remainder so the two halves always re-sum exactly.
      return { restaurant, platform: subtractIqd(discount.amountIqd, restaurant) };
    }
  }
}

export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  if (input.lines.length === 0) {
    throw new MoneyError('An order must contain at least one line');
  }
  if (input.deliveryFeeIqd < 0 || input.platformServiceFeeIqd < 0) {
    throw new MoneyError('Fees cannot be negative');
  }
  if (input.commissionFlatIqd < 0) {
    throw new MoneyError('Commission cannot be negative');
  }

  const itemsSubtotalIqd = addIqd(...input.lines.map(lineTotal));

  let restaurantFundedDiscountIqd = ZERO_IQD;
  let platformFundedDiscountIqd = ZERO_IQD;
  for (const discount of input.discounts ?? []) {
    if (discount.amountIqd < 0) throw new MoneyError('Discount amounts must be non-negative');
    const split = splitDiscount(discount);
    restaurantFundedDiscountIqd = addIqd(restaurantFundedDiscountIqd, split.restaurant);
    platformFundedDiscountIqd = addIqd(platformFundedDiscountIqd, split.platform);
  }

  // A discount can never exceed what it discounts; cap the restaurant-funded share
  // at the subtotal so the commission base can never go negative.
  if (restaurantFundedDiscountIqd > itemsSubtotalIqd) {
    restaurantFundedDiscountIqd = itemsSubtotalIqd;
  }
  const discountTotalIqd = addIqd(restaurantFundedDiscountIqd, platformFundedDiscountIqd);

  const commissionBaseIqd = clampNonNegative(
    subtractIqd(itemsSubtotalIqd, restaurantFundedDiscountIqd),
  );
  const commissionAmountIqd = minIqd(input.commissionFlatIqd, commissionBaseIqd);

  const customerTotalIqd = clampNonNegative(
    iqd(
      itemsSubtotalIqd -
        discountTotalIqd +
        input.deliveryFeeIqd +
        input.platformServiceFeeIqd,
    ),
  );

  const beneficiary: DeliveryFeeBeneficiary = input.deliveryFeeBeneficiary ?? 'RESTAURANT';
  const restaurantDeliveryShare = beneficiary === 'RESTAURANT' ? input.deliveryFeeIqd : ZERO_IQD;
  const platformDeliveryShare = beneficiary === 'PLATFORM' ? input.deliveryFeeIqd : ZERO_IQD;

  const restaurantNetIqd = iqd(
    commissionBaseIqd - commissionAmountIqd + restaurantDeliveryShare,
  );
  const platformRevenueIqd = iqd(
    commissionAmountIqd +
      input.platformServiceFeeIqd +
      platformDeliveryShare -
      platformFundedDiscountIqd,
  );

  return {
    itemsSubtotalIqd,
    restaurantFundedDiscountIqd,
    platformFundedDiscountIqd,
    discountTotalIqd,
    deliveryFeeIqd: input.deliveryFeeIqd,
    platformServiceFeeIqd: input.platformServiceFeeIqd,
    customerTotalIqd,
    commissionBaseIqd,
    commissionFlatIqdSnapshot: input.commissionFlatIqd,
    commissionAmountIqd,
    restaurantNetIqd,
    platformRevenueIqd,
  };
}

/**
 * Re-derive commission from an immutable order snapshot.
 *
 * Settlement generation must never re-read the restaurant's *current* fee
 * (plan §24, §224) — it reads the fee frozen onto the order. This helper exists
 * so that rule is expressed in code rather than left to each caller's discipline.
 */
export function commissionFromSnapshot(snapshot: {
  commissionBaseIqd: Iqd;
  commissionFlatIqdSnapshot: Iqd;
}): Iqd {
  return minIqd(snapshot.commissionFlatIqdSnapshot, snapshot.commissionBaseIqd);
}
