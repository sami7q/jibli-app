import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * أن لاكاسا للوجبات السريعة (En LaCasa) — Haditha, from the shop's own menu.
 *
 * Transcribed from the eight menu pictures the shop publishes, which the owner
 * sent on 2026-11-03, section by section and price by price. Pizza comes in
 * three sizes and each size is its own item («بيتزا لحم — صغير»), the way the
 * other partners' sized dishes are entered; drinks carry their size the same
 * way. Sauces are sold as items of their own because the menu prices them on
 * their own, and again as an optional «صوص إضافي» on the dishes that take one.
 * Hours and fees follow the platform defaults for Haditha shops.
 */

type Menu = DemoRestaurant['menu'];
type Item = Menu[number]['items'][number];

function item(name: string, priceIqd: number, description?: string): Item {
  return description ? { name, priceIqd, description } : { name, priceIqd };
}

function sized(name: string, small: number, medium: number, large: number): Item[] {
  return [
    item(`${name} — صغير`, small),
    item(`${name} — وسط`, medium),
    item(`${name} — كبير`, large),
  ];
}

const FOOD = 'الوجبات السريعة';
const EXTRAS = 'الصوصات والمشروبات';
const DRINKS = EXTRAS;

/** Sauces on the side of a dish, the same eight the menu sells on their own. */
const EXTRA_SAUCE = 'صوص إضافي';
const SAUCES = ['كلاسك', 'مدخن', 'جبن', 'باربيكيو', 'ثومية', 'سبايسي', 'كجب', 'أعشاب'];

/** Dishes a customer adds a sauce to: burgers, sandwiches, riso and fingers. */
function withSauce(items: Item[]): Item[] {
  return items.map((entry) => ({ ...entry, options: [EXTRA_SAUCE] }));
}

const MENU: Menu = [
  {
    name: 'البركر',
    section: FOOD,
    items: withSauce([
      item('بركر محلي بالجبن', 2500),
      item('بركر محلي أن لاكاسا', 4000),
      item('بركر لحم أن لاكاسا', 7000),
      item('بركر لحم باربيكيو', 6000),
      item('بركر لحم بالجبن', 5500),
      item('بركر لحم مدخن', 5000),
      item('بركر لحم كلاسك', 4500),
      item('بركر دجاج محلي', 2500),
      item('بركر دجاج بالجبن', 5000),
      item('بركر دجاج مدخن', 4500),
      item('بركر دجاج كلاسك', 4000),
    ]),
  },
  {
    name: 'شاورما',
    section: FOOD,
    items: [
      item('صاج شاورما', 2000),
      item('وجبة شاورما', 3500),
      item('صمون شاورما', 2000),
      item('نص نفر شاورما', 5000),
      item('نفر شاورما', 10000),
      item('ستيك دجاج', 2500),
      item('صاج إيطالي لحم', 6000),
      item('صاج إيطالي دجاج', 5000),
    ],
  },
  {
    name: 'ريزو',
    section: FOOD,
    items: withSauce([
      item('طبق رز', 2000),
      item('ريزو كلاسك', 5000),
      item('ريزو سبايسي', 5000),
      item('ريزو بدون صلصة', 5000),
      item('ريزو مدخن', 5500),
      item('ريزو أن لاكاسا', 6000),
      item('ريزو شاورما', 6000),
      item('ريزو بالجبن', 6000),
      item('ريزو باربيكيو', 6000),
      item('ريزو أعشاب', 5500),
      item('تشكن فرايز كلاسك', 5000),
      item('تشكن فرايز مدخن', 6000),
    ]),
  },
  {
    name: 'ساندويتش',
    section: FOOD,
    items: withSauce([
      item('ساندويش زنجر', 3500),
      item('ساندويش زنجر سبايسي', 3500),
      item('ساندويش زنجر بالجبن', 4000),
      item('وجبة ساندويش زنجر', 5000),
      item('تويستر', 3500),
      item('تويستر سبايسي', 3500),
      item('وجبة تويستر', 5000),
    ]),
  },
  {
    name: 'الوجبات',
    section: FOOD,
    items: [
      item('وجبة ستربس 3 قطع', 6000),
      item('وجبة ستربس 4 قطع', 8000),
      item('وجبة ستربس 5 قطع', 10000),
      item('وجبة ستربس 9 قطع', 15000),
      item('وجبة ستربس 15 قطعة', 20000),
    ],
  },
  {
    name: 'البيتزا',
    section: FOOD,
    items: [
      ...sized('بيتزا لحم', 7000, 9000, 12000),
      ...sized('بيتزا دجاج', 6000, 8000, 10000),
      ...sized('بيتزا خضار', 5000, 7000, 8000),
      ...sized('بيتزا الفصول الأربعة', 7000, 9000, 12000),
      ...sized('بيتزا ببروني', 7000, 9000, 12000),
      ...sized('بيتزا مارغريتا', 5000, 6000, 7000),
    ],
  },
  {
    name: 'الفنكر',
    section: FOOD,
    items: withSauce([
      item('فنكر كوب', 1000),
      item('فنكر طبق وسط', 2000),
      item('فنكر طبق وسط بالأعشاب', 2500),
      item('فنكر طبق وسط بالجبن', 3000),
      item('فنكر طبق كبير', 4000),
    ]),
  },
  {
    name: 'الصوص',
    section: EXTRAS,
    items: [
      item('صوص كلاسك', 500),
      item('صوص مدخن', 500),
      item('صوص جبن', 500),
      item('صوص باربيكيو', 500),
      item('صوص ثومية', 500),
      item('صوص سبايسي', 500),
      item('صوص كجب', 500),
      item('صوص أعشاب', 500),
    ],
  },
  {
    name: 'المشروبات',
    section: DRINKS,
    items: [
      item('بيبسي — صغير', 250),
      item('بيبسي — دبل', 500),
      item('بيبسي — بطل', 1000),
      item('بيبسي — عائلي', 1250),
      item('سبرايت — صغير', 250),
      item('سبرايت — دبل', 500),
      item('سبرايت — عائلي', 1250),
    ],
  },
];

/** The shop's logo, cropped from the first picture of its published menu. */
export const LACASA_LOGO_FILE = new URL('./assets/lacasa-logo.jpg', import.meta.url);

/** The same picture, uncropped, as the shop's cover. */
export const LACASA_COVER_FILE = new URL('./assets/lacasa-cover.jpg', import.meta.url);

export function lacasa(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-LACASA',
    name: 'أن لاكاسا',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'وجبات سريعة في حديثة: بركر، شاورما، ريزو، زنجر، ستربس وبيتزا.',
    cuisines: ['fast_food', 'burger', 'shawarma', 'chicken', 'pizza'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: null,
    ratingCount: 0,
    address: 'حديثة',
    district: 'حديثة',
    // Not on the menu; the shop sets it from «إعدادات المتجر».
    phone: '',
    ownerUsername,
    ownerName: 'أن لاكاسا',
    hours,
    modifierGroups: [
      {
        name: EXTRA_SAUCE,
        required: false,
        minSelect: 0,
        maxSelect: SAUCES.length,
        options: SAUCES.map((sauce) => ({ name: `صوص ${sauce}`, priceIqd: 500 })),
      },
    ],
    menu: MENU,
  };
}
