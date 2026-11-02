import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * عجينة (Ajeena) — Haditha, from the shop's own published delivery menu.
 *
 * Read on 2026-11-02 from the menu site the shop runs (delivery prices, which
 * are what a Jibli customer pays). Its drink lists repeat the same names at
 * four sizes, so each drink carries its size in its name — a cart line that
 * says only «سبرايت موهيتو» could be any of four bottles. Hours and fees follow
 * the platform defaults set for every Haditha shop.
 */

type Menu = DemoRestaurant['menu'];
type Item = Menu[number]['items'][number];

function item(name: string, priceIqd: number, description?: string): Item {
  return description ? { name, priceIqd, description } : { name, priceIqd };
}

const PASTRY = 'المعجنات';
const DRINKS = 'المشروبات';

const MENU: Menu = [
  {
    name: 'لحم بعجين',
    section: PASTRY,
    items: [
      item('لحم بعجين كلاسك', 1500),
      item('لحم بعجين كلاسك (دبل)', 3000),
      item('لحم بعجين جبن', 2000),
      item('لحم بعجين جبن (دبل)', 4000),
      item('لحم بعجين سبايسي', 1500),
      item('لحم بعجين سبايسي (دبل)', 3000),
      item('لحم بعجين بيض', 1500),
      item('لحم بعجين بيض (دبل)', 3000),
      item('مناقيش زعتر', 1000),
      item('دجاج بعجينه', 1250),
      item('دجاج بعجينه (دبل)', 2500),
    ],
  },
  {
    name: 'عروك تنور',
    section: PASTRY,
    items: [item('عروك تنور', 1500, 'لحم عراقي خالص')],
  },
  {
    name: 'مشروبات — عائلي',
    section: DRINKS,
    items: [
      item('كولا عائلي', 1250),
      item('كولا سبرايت — عائلي', 1250, 'سفن'),
      item('سبرايت موهيتو — عائلي', 1250, 'ليمون ونعناع'),
      item('فانتا تفاح عائلي', 1250),
      item('فانتا برتقال عائلي', 1250),
    ],
  },
  {
    name: 'مشروبات — جوال',
    section: DRINKS,
    items: [
      item('سبرايت جوال', 750, 'سفن'),
      item('سبرايت موهيتو — جوال', 750, 'ليمون ونعناع'),
      item('فانتا برتقال — جوال', 750),
      item('فانتا فواكه — جوال', 750),
    ],
  },
  {
    name: 'مشروبات — 500',
    section: DRINKS,
    items: [
      item('كولا دبل — 500', 500),
      item('سبرايت (سفن) — 500', 500),
      item('كولا دايت — 500', 500),
      item('سبرايت موهيتو — 500', 500, 'ليمون ونعناع'),
      item('فانتا برتقال — 500', 500, 'ميرندا'),
    ],
  },
  {
    name: 'مشروبات — 250',
    section: DRINKS,
    items: [
      item('سبرايت — 250', 250, 'سفن'),
      item('سبرايت موهيتو — 250', 250, 'ليمون ونعناع'),
      item('فانتا برتقال — 250', 250, 'ميرندا'),
      item('فانتا توت — 250', 250, 'فواكه'),
      item('فانتا تفاح — 250', 250),
    ],
  },
];

/** The shop's own pictures, from its menu site. */
export const AJEENA_LOGO_URL =
  'https://eamftwektcrokdhgulys.supabase.co/storage/v1/object/public/restaurant-images/1787782104858_ksl7zay0c8.jpg';
export const AJEENA_COVER_URL =
  'https://eamftwektcrokdhgulys.supabase.co/storage/v1/object/public/restaurant-images/1787782106306_hwudwwcvvo4.jpg';

export function ajeena(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-AJEENA',
    name: 'عجينة',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'لحم بعجين ومعجنات وعروك تنور في حديثة، ومشروبات.',
    cuisines: ['bakery', 'fast_food'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: null,
    ratingCount: 0,
    address: 'حديثة - شارع القائمقامية القديمة - قرب مطعم فالح أبو العمبة',
    district: 'حديثة',
    phone: '+9647878788551',
    ownerUsername,
    ownerName: 'عجينة',
    hours,
    menu: MENU,
  };
}
