import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * مستر ديك (Mr. Deek) — Haditha, from the shop's printed and diet menus.
 *
 * Transcribed from the three menu pictures the owner sent on 2026-11-03,
 * section by section and price by price. Every sized pizza costs 2,000 more
 * for a medium and 4,000 more for a large than its small, so each is one item
 * priced at the small with a required «الحجم» choice, rather than three
 * items. The four sauces are sold on their own and as an optional «صوص إضافي»
 * on the dishes that take one. «ساندويش فلر» is spelled as printed.
 */

type Menu = DemoRestaurant['menu'];
type Item = Menu[number]['items'][number];

function item(name: string, priceIqd: number, description?: string): Item {
  return description ? { name, priceIqd, description } : { name, priceIqd };
}

const FAST_FOOD = 'الوجبات السريعة';
const DIET = 'الدايت';
const EXTRAS = 'الصوصات والمشروبات';

const SIZE = 'الحجم';
const EXTRA_SAUCE = 'صوص إضافي';
const SAUCES = ['صوص ثومية', 'صوص باربكيو', 'صوص جبن شيدر', 'صوص مستر ديك'];

function sizedPizza(name: string, smallIqd: number): Item {
  return { name, priceIqd: smallIqd, options: [SIZE, EXTRA_SAUCE] };
}

/** Dishes a customer adds a sauce to. */
function withSauce(items: Item[]): Item[] {
  return items.map((entry) => ({ ...entry, options: [EXTRA_SAUCE] }));
}

const MENU: Menu = [
  {
    name: 'البيتزا',
    section: FAST_FOOD,
    items: [
      sizedPizza('بيتزا لحم', 6000),
      sizedPizza('بيتزا دجاج', 5500),
      sizedPizza('بيتزا خضار', 5000),
      sizedPizza('بيتزا ببروني', 5500),
      sizedPizza('بيتزا الفصول الأربعة', 6000),
      sizedPizza('بيتزا مارغريتا', 5000),
      ...withSauce([
        item('بيتزا مستر ديك', 12000),
        item('بيتزا محشية الأطراف', 10000),
        item('كساديا', 5000),
      ]),
    ],
  },
  {
    name: 'البركر',
    section: FAST_FOOD,
    items: withSauce([
      item('كلاسك بركر', 4000),
      item('جكن بركر', 3500),
      item('بركر لحم دبل', 8000),
      item('مشروم بركر لحم', 5000),
      item('جيز بركر لحم', 5000),
      item('مشروم جكن بركر', 4500),
      item('جيز جكن بركر', 4500),
      item('جكن بركر دبل', 7000),
      item('كرانشي بركر', 6000),
      item('بريك بركر', 6000),
      item('بركر مستر ديك', 8000),
    ]),
  },
  {
    name: 'الكنتاكي والستربس',
    section: FAST_FOOD,
    items: withSauce([
      item('كنتاكي 3 قطع', 7000),
      item('كنتاكي 5 قطع', 9000),
      item('كنتاكي 10 قطع', 16000),
      item('كنتاكي 15 قطعة', 23000),
      item('ستربس 3 قطع', 6000),
      item('ستربس 5 قطع', 8000),
      item('ستربس 10 قطع', 15000),
      item('ستربس 15 قطعة', 22000),
    ]),
  },
  {
    name: 'السندويشات',
    section: FAST_FOOD,
    items: withSauce([
      item('شاورما دجاج', 2500),
      item('ساندويش فلر', 4000),
      item('فاهيتا', 4000),
      item('تويستر', 4000),
      item('زنجر', 5000),
    ]),
  },
  {
    name: 'صاج ايطالي',
    section: FAST_FOOD,
    items: [
      item('صاج ايطالي لحم', 6000),
      item('صاج ايطالي دجاج', 5000),
      item('صاج ايطالي خضار', 4500),
    ],
  },
  {
    name: 'الريزو',
    section: FAST_FOOD,
    items: [
      item('ريزو مدخن', 5000),
      item('ريزو كلاسك', 5000),
      item('ريزو بالجبن', 5000),
      item('ريزو سبايسي', 5000),
      item('ريزو دبل', 7000),
      item('ريزو مستر ديك', 7000),
    ],
  },
  {
    name: 'أطباق البطاطا',
    section: FAST_FOOD,
    items: withSauce([
      item('كرسبي بوكس دوريتوس', 5000),
      item('كرسبي بوكس ليز', 5000),
      item('كرسبي بوكس', 5000),
      item('قدح فنكر عادي', 1000),
      item('صحن فنكر عادي', 1500),
      item('صحن فنكر بالصوص', 2000),
      item('صحن فنكر بالجبن', 2000),
    ]),
  },
  {
    name: 'المقبلات',
    section: FAST_FOOD,
    items: [
      item('مقبلات صحن صغير', 2000),
      item('مقبلات صحن كبير', 3000),
      item('سلطة سيزر', 3500),
    ],
  },
  {
    name: 'منيو الدايت',
    section: DIET,
    items: [
      item('وجبة سلطة سيزر', 4000),
      item('وجبة سلطة خضار', 3500),
      item('ستيك دجاج دايت', 5000),
      item('اكسترا دجاج دايت', 6000),
      item('فاهيتا دجاج دايت', 5000),
      item('صاج دجاج دايت', 3000),
      item('دايت مستر', 8000),
    ],
  },
  {
    name: 'الصوصات',
    section: EXTRAS,
    items: SAUCES.map((sauce) => item(sauce, 500)),
  },
  {
    name: 'المشروبات',
    section: EXTRAS,
    items: [
      item('بيبسي كبير', 500),
      item('بيبسي صغير', 250),
      item('سبرايت كبير', 500),
      item('سبرايت صغير', 250),
      item('فانتا كبير', 500),
      item('فانتا صغير', 250),
      item('لبن', 500),
    ],
  },
];

/** The shop's round badge, cropped square from its own profile picture. */
export const MR_DEEK_LOGO_FILE = new URL('./assets/mrdeek-logo.jpg', import.meta.url);

export function mrDeek(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-MRDEEK',
    name: 'مستر ديك',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'بيتزا وبركر وكنتاكي وستربس وريزو في حديثة، ومنيو دايت.',
    cuisines: ['fast_food', 'chicken', 'burger', 'pizza'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: null,
    ratingCount: 0,
    address: 'حديثة - شارع القائمقامية مقابل مدرسة دولة للبنات',
    district: 'حديثة',
    phone: '+9647890125800',
    ownerUsername,
    ownerName: 'مستر ديك',
    hours,
    modifierGroups: [
      {
        name: SIZE,
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'صغير', priceIqd: 0 },
          { name: 'وسط', priceIqd: 2000 },
          { name: 'كبير', priceIqd: 4000 },
        ],
      },
      {
        name: EXTRA_SAUCE,
        required: false,
        minSelect: 0,
        maxSelect: SAUCES.length,
        options: SAUCES.map((sauce) => ({ name: sauce, priceIqd: 500 })),
      },
    ],
    menu: MENU,
  };
}
