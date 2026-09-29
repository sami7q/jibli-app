/**
 * The delivery fee as the customer sees it.
 *
 * The platform service fee used to be its own line — «رسوم الخدمة ٥٠٠» — under
 * the delivery fee on every total. It is now shown inside the delivery fee
 * instead: one number for "getting it to you", which is how a customer thinks
 * of both. Nothing about the money changes. The order still stores the two
 * separately, the service fee is still the platform's, and Admin collects it
 * from the shop as profit alongside the commission.
 *
 * Every screen that shows a delivery fee goes through this, so the card, the
 * cart, the checkout and the receipt can never disagree by the service fee.
 */
export function customerDeliveryFee(deliveryFeeIqd: number, serviceFeeIqd: number): number {
  return Math.max(0, deliveryFeeIqd) + Math.max(0, serviceFeeIqd);
}
