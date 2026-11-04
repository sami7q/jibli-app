import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * واحد حديثة للأكلات السريعة (1 Haditha Fast Food) — from its printed menu.
 *
 * Transcribed from the photograph of the menu the owner sent on 2026-11-04,
 * section by section and price by price. Every pizza costs 2,000 more for a
 * medium and 4,000 more for a large than its small, so each is one item at
 * the small's price with a required «الحجم» choice. The phone is the one
 * printed under the shop's name.
 */

type Menu = DemoRestaurant['menu'];
type Item = Menu[number]['items'][number];

function item(name: string, priceIqd: number): Item {
  return { name, priceIqd };
}

const FOOD = 'الوجبات السريعة';
const SIDES = 'المقبلات والفلافل';
const SIZE = 'الحجم';

function sizedPizza(name: string, smallIqd: number): Item {
  return { name, priceIqd: smallIqd, options: [SIZE] };
}

const MENU: Menu = [
  {
    name: 'شاورما دجاج',
    section: FOOD,
    items: [
      item('سندويش شاورما', 2000),
      item('صاج شاورما', 2500),
      item('صاج شاورما دبل', 4500),
      item('وجبة شاورما عائلية', 10000),
    ],
  },
  {
    name: 'بركر لحم',
    section: FOOD,
    items: [
      item('بركر لحم كلاسك', 5000),
      item('جيز بركر لحم', 6000),
      item('شلي بركر لحم', 6000),
      item('سموك بركر لحم', 6000),
      item('تكساس بركر لحم', 8000),
      item('راب بركر لحم', 6000),
      item('وجبة بركر لحم', 7000),
    ],
  },
  {
    name: 'بركر دجاج',
    section: FOOD,
    items: [
      item('بركر دجاج كلاسك', 4000),
      item('جيز بركر دجاج', 5000),
      item('شلي بركر دجاج', 5000),
      item('سموك بركر دجاج', 5000),
      item('تكساس بركر دجاج', 7000),
      item('راب بركر دجاج', 5500),
      item('وجبة بركر دجاج', 6000),
    ],
  },
  {
    name: 'سندويشات',
    section: FOOD,
    items: [
      item('زنجر', 4000),
      item('مايتي زنجر', 5500),
      item('زنجر كولسلو', 5500),
      item('جيز زنجر', 4500),
      item('شيلي زنجر', 4500),
      item('فاهيتا', 6000),
      item('سكالوب', 4000),
      item('فلر', 6000),
      item('تويستر', 4000),
      item('تويستر راب', 4500),
      item('وجبة زنجر', 6000),
    ],
  },
  {
    name: 'الوجبات',
    section: FOOD,
    items: [
      item('كنتاكي 3 قطع', 7000),
      item('كنتاكي 5 قطع', 9000),
      item('كنتاكي 8 قطع', 15000),
      item('ستربس 3 قطع', 6000),
      item('ستربس 5 قطع', 8000),
      item('ستربس 8 قطع', 13000),
      item('ستربس 12 قطعة', 17000),
      item('سكالوب 3 قطع', 6000),
      item('سكالوب 6 قطع', 12000),
    ],
  },
  {
    name: 'بيتزا',
    section: FOOD,
    items: [
      sizedPizza('بيتزا دجاج', 6000),
      sizedPizza('بيتزا لحم', 6000),
      sizedPizza('بيتزا خضار', 6000),
      sizedPizza('بيتزا ببروني', 6000),
      sizedPizza('بيتزا مارغريتا', 6000),
      sizedPizza('بيتزا ميكس', 6000),
      sizedPizza('بيتزا محشية الأطراف', 7000),
      sizedPizza('بيتزا واحد حديثة', 6000),
      sizedPizza('بيتزا الفصول الأربعة', 7000),
    ],
  },
  {
    name: 'فرايز',
    section: SIDES,
    items: [
      item('فنكر صغير', 1500),
      item('فنكر وسط', 2500),
      item('فنكر كبير', 3500),
      item('فنكر جبن صغير', 2000),
      item('فنكر جبن وسط', 3000),
      item('فنكر جبن كبير', 4000),
      item('فرايز جكن', 5000),
      item('فرايز واحد حديثة', 6000),
    ],
  },
  {
    name: 'ريزو',
    section: FOOD,
    items: [
      item('ريزو كلاسك', 5000),
      item('ريزو مدخن', 5000),
      item('ريزو سبايسي', 5000),
      item('ريزو جبن', 5000),
      item('ريزو أعشاب', 5500),
      item('ريزو مكس', 5500),
      item('ريزو واحد حديثة', 6000),
    ],
  },
  {
    name: 'فلافل',
    section: SIDES,
    items: [item('فلافل مشكل', 1000), item('فلافل لبناني', 1000)],
  },
];

/** The name badge from the top of the shop's menu. */
export const WAHID_LOGO_FILE = new URL('./assets/wahid-logo.jpg', import.meta.url);
/** The menu's header band, burgers either side of the name. */
export const WAHID_COVER_FILE = new URL('./assets/wahid-cover.jpg', import.meta.url);

export function wahidHaditha(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-WAHID',
    name: 'واحد حديثة',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'أكلات سريعة في حديثة: شاورما، بركر، زنجر، كنتاكي وستربس، بيتزا، ريزو وفلافل.',
    cuisines: ['fast_food', 'burger', 'shawarma', 'chicken', 'pizza'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: null,
    ratingCount: 0,
    address: 'حديثة',
    district: 'حديثة',
    phone: '+9647825645565',
    ownerUsername,
    ownerName: 'واحد حديثة',
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
    ],
    menu: MENU,
  };
}
