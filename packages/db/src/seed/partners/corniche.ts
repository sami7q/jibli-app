import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * مشويات كورنيش (Corniche Grills) — Haditha, from the shop's own flyer.
 *
 * The five dishes and prices on the flyer the owner sent on 2026-11-02, read
 * in thousands of dinars as the flyer prints them («بـ 15» is 15,000). The
 * phone is the one printed at its foot.
 */

type Menu = DemoRestaurant['menu'];

const GRILLS = 'المشويات';

const MENU: Menu = [
  {
    name: 'مشويات الدجاج',
    section: GRILLS,
    items: [
      { name: 'وجبة كاملة أجنحة 16 قطعة', priceIqd: 15000 },
      { name: 'نفر تكة دجاج', priceIqd: 10000 },
      { name: 'وجبة كاملة دجاج ع الفحم', priceIqd: 15000 },
    ],
  },
  {
    name: 'السمك',
    section: GRILLS,
    items: [
      { name: 'قلي سمك نفر', priceIqd: 8000 },
      { name: 'وجبة سمك أحواض (كيلو)', priceIqd: 10000 },
    ],
  },
];

/** The wooden sign from the top of the flyer. */
export const CORNICHE_LOGO_FILE = new URL('./assets/corniche-logo.jpg', import.meta.url);
/** The flyer's grilled dishes, as the cover. */
export const CORNICHE_COVER_FILE = new URL('./assets/corniche-cover.jpg', import.meta.url);

export function corniche(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-CORNICHE',
    name: 'مشويات كورنيش',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'مشويات دجاج على الفحم وسمك في حديثة.',
    cuisines: ['grills', 'chicken'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: null,
    ratingCount: 0,
    address: 'حديثة',
    district: 'حديثة',
    phone: '+9647826723224',
    ownerUsername,
    ownerName: 'مشويات كورنيش',
    hours,
    menu: MENU,
  };
}
