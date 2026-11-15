import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * نار وفحم (Fire & Charcoal) — Haditha, from the shop's printed menu.
 *
 * The ten dishes and prices on the «منيو نار وفحم» card the owner sent on
 * 2026-11-06, with the address and phone printed at its foot. Dish photos are
 * cropped from the shop's own flyers (see `assets/narwfahm-photos.json`).
 */

type Menu = DemoRestaurant['menu'];

const GRILLS = 'المشاوي';

const MENU: Menu = [
  {
    name: 'وجبات على رز',
    section: GRILLS,
    items: [
      { name: 'دجاجة على رز', priceIqd: 15000, popular: true },
      { name: 'دجاجة مسحب على رز', priceIqd: 15000, popular: true },
      { name: 'نفر أجنحة على رز', priceIqd: 13000 },
      { name: 'نفر تكة على رز', priceIqd: 13000 },
      { name: 'نص نفر أجنحة على رز', priceIqd: 7000 },
      { name: 'نص نفر تكة على رز', priceIqd: 7000 },
    ],
  },
  {
    name: 'تكة بدون رز',
    section: GRILLS,
    items: [
      { name: 'نفر تكة بدون رز', priceIqd: 10000 },
      { name: 'نص نفر تكة بدون رز', priceIqd: 5000 },
    ],
  },
  {
    name: 'الرز',
    section: GRILLS,
    items: [
      { name: 'رز حجم كبير', priceIqd: 5000 },
      { name: 'رز حجم وسط', priceIqd: 3000 },
    ],
  },
];

/** The orange round mark from the shop's profile. */
export const NAR_W_FAHM_LOGO_FILE = new URL('./assets/narwfahm-logo.jpg', import.meta.url);
/** The charcoal chicken platter from the shop's flyer, as the cover. */
export const NAR_W_FAHM_COVER_FILE = new URL('./assets/narwfahm-cover.jpg', import.meta.url);

export function narWFahm(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-NARWFAHM',
    name: 'نار وفحم',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'مشاوي دجاج على الفحم: دجاج ومسحب وتكة وأجنحة على رز.',
    cuisines: ['grills', 'chicken'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: null,
    ratingCount: 0,
    address: 'حديثة - شارع القائمقامية - قرب الفلكة',
    district: 'حديثة',
    phone: '+9647872484000',
    ownerUsername,
    ownerName: 'نار وفحم',
    hours,
    menu: MENU,
  };
}
