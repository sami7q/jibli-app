import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * B.Laban «بـ لبن» — Haditha branch, entered from the shop's printed menu.
 *
 * Transcribed from the five photographs of the menu the owner sent on
 * 2026-11-02, section by section and price by price, in the menu's own
 * order. The «دنيا …» headings become categories, grouped under four main
 * sections the app shows as tabs. The «الإضافات» are sold as items of their
 * own rather than options, because the menu prices them independently of any
 * dish; a shop can turn them into options later from «خيارات الأطباق».
 *
 * Hours, fees and phone are the shop's business answers, set from
 * `B_LABAN_DETAILS` below once the owner confirms them.
 */

type Menu = DemoRestaurant['menu'];
type Item = Menu[number]['items'][number];

function item(name: string, priceIqd: number, description?: string): Item {
  return description ? { name, priceIqd, description } : { name, priceIqd };
}

const SWEETS = 'الحلويات';
const ICE_CREAM = 'الآيس كريم';
const JUICES = 'العصائر';
const EXTRAS = 'الإضافات';

const MENU: Menu = [
  {
    name: 'رز ب لبن',
    section: SWEETS,
    items: [
      item('أرز ب لبن سادة', 3500),
      item('أرز ب لبن + مكسرات', 5000),
      item('أرز ب لبن + آيس حليب', 5000),
      item('أرز ب لبن لوتس بلجيكي', 5000),
      item('أرز ب لبن + قشطة + مكسرات', 7000),
      item('دوبامين', 6000, 'أرز + لبن + آيس + مكسرات'),
      item('سيروتونين', 6000, 'أرز ب لبن + بسبوسة + آيس + مكسرات'),
      item('أرز ب لبن بيستاشيو بالآيس', 7000),
      item('أدرينالين', 6000),
      item('كمين الشربيني', 6000),
      item('أرز ب لبن + مانجا', 7000),
      item('شكلكليتا رز', 6000),
      item('أرز ب لبن نوتيلا', 5000),
      item('أرز ب لبن بستاشيو', 5000),
      item('أرز ب لبن كندر', 5000),
    ],
  },
  {
    name: 'لؤه ملوخيتو',
    section: SWEETS,
    items: [
      item('لؤه سادة', 5000),
      item('لؤه نوتيلا', 6000),
      item('لؤه أوريو نوتيلا', 6500),
      item('لؤه لوتس', 6500),
      item('لؤه كندر', 6000),
      item('لؤه بستاشيو', 7000),
      item('لؤه مانجا', 7000),
      item('لؤه فراولة', 7000),
      item('لؤه سوبر لوكس', 8000),
    ],
  },
  {
    name: 'أم علي',
    section: SWEETS,
    items: [
      item('طاجن أم علي بالسمنة البلدي', 4000),
      item('طاجن أم علي بالسمنة البلدي + قشطة', 5000),
      item('طاجن أم علي بالسمنة البلدي ومكسرات', 5000),
      item('طاجن أم علي قشطة ومكسرات', 6000),
      item('طاجن أم علي البركة', 7000),
    ],
  },
  {
    name: 'الهبة',
    section: SWEETS,
    items: [
      item('هبة دبي', 8000),
      item('كريب دبي', 7500),
      item('تشيز بووم', 8000),
      item('قنبلة دبي', 7000),
      item('فروليتا', 6000),
      item('الفتاكة', 6000),
      item('قنبلة فواكه', 7000),
      item('كريب الفراعنة', 9000),
      item('كبسة', 8000),
      item('الفزعة', 8500),
      item('شوكولاتة دبي', 6000),
      item('بركر شوكولا', 8000),
      item('بوبا تشيز', 8000),
      item('ودي باريس', 9000),
      item('خالتي ماتيلدا', 6000),
      item('كريب بومباستيك', 9000),
    ],
  },
  {
    name: 'قشطوطة',
    section: SWEETS,
    items: [
      item('قشطوطة سادة', 3500),
      item('قشطوطة كراميل', 4000),
      item('قشطوطة مانجا', 6000),
      item('قشطوطة مكسرات', 5000),
      item('قشطوطة لوتس', 5000),
      item('قشطوطة قشطة', 4000),
      item('قشطوطة رز ب لبن مكسرات', 6000),
      item('قشطوطة رز ب لبن لوتس', 6000),
      item('قشطوطة رز ب لبن مانجا', 7000),
      item('قشطوطة رز ب لبن كريمة', 5000),
      item('قشطوطة سوبر لوكس', 7000),
      item('شكلكليتا قشطوطة سادة', 6500),
      item('شكلكليتا قشطوطة رز', 7000),
      item('قشطوطة نوتيلا', 5000),
      item('قشطوطة بستاشيو', 5000),
      item('قشطوطة كندر', 5000),
    ],
  },
  {
    name: 'كشري بلبن',
    section: SWEETS,
    items: [
      item('كشري نوتيلا', 5000),
      item('كشري أوريو نوتيلا', 5000),
      item('كشري كندر', 5000),
      item('كشري لوتس', 5000),
      item('كشري مانجا', 6000),
      item('كشري بستاشيو', 7000),
      item('كشري بستاشيو لوتس', 7000),
      item('كشري سوبر لوكس', 8000),
    ],
  },
  {
    name: 'دبديبو',
    section: SWEETS,
    items: [
      item('دباديو بستاشيو', 5500),
      item('دباديو نوتيلا', 5000),
      item('دباديو كندر', 5000),
      item('دباديو لوتس', 5000),
    ],
  },
  {
    name: 'بمبوظة',
    section: SWEETS,
    items: [
      item('بمبوظة سادة', 5000),
      item('بمبوظة مكسرات', 5000),
      item('بمبوظة لوتس', 5000),
      item('بمبوظة قشطة', 5000),
      item('بمبوظة بندق', 6000),
      item('بمبوظة مانجا', 6000),
    ],
  },
  {
    name: 'السالانكاتيه',
    section: SWEETS,
    items: [
      item('السالانكاتيه نوتيلا', 5500),
      item('السالانكاتيه لوتس', 5500),
      item('السالانكاتيه أوريو نوتيلا', 5500),
      item('السالانكاتيه كيندر', 5500),
      item('السالانكاتيه بيستاشيو', 6500),
      item('السالانكاتيه مانجا', 6000),
      item('السالانكاتيه سوبر لوكس', 8000),
    ],
  },
  {
    name: 'الآيس كريم',
    section: ICE_CREAM,
    items: [
      item('كوب آيس كريم صغير', 2500),
      item('كوب آيس كريم كبير', 4500),
      item('كوب آيس كريم صغير — الفستق والبندق', 4500),
      item('كونو آيس', 3500),
      item('كونو آيس فستق', 2500),
    ],
  },
  {
    name: 'العصائر',
    section: JUICES,
    items: [
      item('عصير برتقال', 3000),
      item('عصير زبيب', 3000),
      item('عصير فراولة', 3000),
      item('عصير مانجا', 4000),
      item('عصير موز', 3000),
      item('ماء', 250),
      item('بيبسي', 500),
    ],
  },
  {
    name: 'الإضافات',
    section: EXTRAS,
    items: [
      item('صوص نوتيلا', 1000),
      item('صوص لوتس', 1000),
      item('بودر لوتس', 1000),
      item('بودر أوريو', 1000),
      item('عسل نحل', 1000),
      item('بسبوسة', 1000),
      item('قشطة (جيمر)', 1000),
      item('بسكوت آيس كريم (كونو)', 1000),
      item('مكسرات مشكل', 1500),
      item('صوص كندر', 1500),
      item('صوص بستاشيو', 1500),
    ],
  },
];

/**
 * The shop's own answers. `confirmed: false` until the owner gives them; the
 * provisioning script refuses to publish a shop whose details are guesses.
 */
export const B_LABAN_DETAILS = {
  confirmed: false,
  opensAt: '12:00',
  closesAt: '24:00',
  minimumOrderIqd: 0,
  deliveryFeeIqd: 2000,
  phone: '',
} as const;

export function bLaban(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [
      day,
      [B_LABAN_DETAILS.opensAt, B_LABAN_DETAILS.closesAt] as const,
    ]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-BLABAN',
    name: 'بـ لبن B.Laban',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'حلويات بـ لبن في حديثة: رز ب لبن، أم علي، قشطوطة، كشري بلبن، آيس كريم وعصائر.',
    cuisines: ['desserts', 'ice_cream', 'juices'],
    minimumOrderIqd: B_LABAN_DETAILS.minimumOrderIqd,
    deliveryFeeIqd: B_LABAN_DETAILS.deliveryFeeIqd,
    prepMinutes: 15,
    rating: null,
    ratingCount: 0,
    address: 'حديثة',
    district: 'حديثة',
    phone: B_LABAN_DETAILS.phone,
    ownerUsername,
    ownerName: 'بـ لبن B.Laban',
    hours,
    menu: MENU,
  };
}
