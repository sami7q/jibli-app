import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * فلافل عمروش (Amroush Falafel) — Haditha, from the price list the owner sent.
 *
 * Fourteen prices as given on 2026-11-15. The three «مقبلات» sizes are one
 * item at the small's price with a required «الحجم» choice (+1,000 medium,
 * +2,000 large), the way the sized pizzas are elsewhere. Two order phones were
 * given; the first is the shop's phone here, the second is 07810849451.
 */

type Menu = DemoRestaurant['menu'];

const SIZE = 'الحجم';

const MENU: Menu = [
  {
    name: 'الفلافل',
    items: [
      { name: 'فلافل مشكل', priceIqd: 1000, popular: true },
      { name: 'فلافل عادي', priceIqd: 1000 },
      { name: 'صاج فلافل', priceIqd: 1500 },
      { name: 'حبات فلافل 10 قطع', priceIqd: 1000 },
    ],
  },
  {
    name: 'البركر',
    items: [
      { name: 'بركر لحم', priceIqd: 3000 },
      { name: 'بركر دجاج', priceIqd: 3000 },
    ],
  },
  {
    name: 'الريزو',
    items: [
      { name: 'ريزو مدخن', priceIqd: 5000 },
      { name: 'ريزو كلاسك', priceIqd: 5000 },
      { name: 'ريزو سبايسي', priceIqd: 5000 },
    ],
  },
  {
    name: 'الدجاج',
    items: [
      { name: 'صاج دجاج', priceIqd: 3000 },
      { name: 'شاورما دجاج', priceIqd: 2500 },
    ],
  },
  {
    name: 'المقبلات',
    items: [{ name: 'مقبلات', priceIqd: 1000, options: [SIZE] }],
  },
];

/** The chef mascot from the shop's profile picture. */
export const AMROUSH_LOGO_FILE = new URL('./assets/amroush-logo.jpg', import.meta.url);

export function amroush(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-AMROUSH',
    name: 'فلافل عمروش',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'فلافل وصاج وبركر وريزو وشاورما في حديثة.',
    cuisines: ['sandwiches', 'fast_food', 'burger', 'shawarma'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 25,
    rating: null,
    ratingCount: 0,
    address: 'حديثة',
    district: 'حديثة',
    phone: '+9647830529381',
    ownerUsername,
    ownerName: 'فلافل عمروش',
    hours,
    modifierGroups: [
      {
        name: SIZE,
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'صغير', priceIqd: 0 },
          { name: 'وسط', priceIqd: 1000 },
          { name: 'كبير', priceIqd: 2000 },
        ],
      },
    ],
    menu: MENU,
  };
}
