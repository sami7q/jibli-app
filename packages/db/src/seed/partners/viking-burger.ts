import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * فايكنك بركر (Viking Burger) — Haditha, from the shop's six-page menu.
 *
 * Transcribed from the menu pages it published (vikingburger.haditha) and the
 * owner's logo, sent on 2026-11-17. Burgers, special burgers and sandwiches
 * take an optional «اجعلها وجبة» (+1,500) as the menu offers; burgers also
 * take the printed «الإضافات». The four ريزو come in a 4,000 «ميني ريزو»
 * too, which is one item with a required flavour. Phone from the owner, 2026-11-19.
 */

type Menu = DemoRestaurant['menu'];
type Item = Menu[number]['items'][number];

const MEAL = 'اجعلها وجبة';
const EXTRAS = 'الإضافات';
const RIZO_FLAVOUR = 'نوع الريزو';

function item(name: string, priceIqd: number, description?: string, options?: string[]): Item {
  return {
    name,
    priceIqd,
    ...(description ? { description } : {}),
    ...(options ? { options } : {}),
  };
}

const BURGER = [MEAL, EXTRAS];
const RIZO_FLAVOURS = ['ريزو فايكنك', 'ريزو اعشاب', 'ريزو سبشل', 'ريزو هني ماسترد'];

const MENU: Menu = [
  {
    name: 'الجديد',
    items: [
      item(
        'راكناروك',
        4500,
        'لحم 120 غم - صمون بطاطا - مخلل - خضروات - صوص فايكنك الخاص',
        BURGER,
      ),
      item('فالهالا', 12000, '3 ميني ساندويش بركر لحم و3 ميني ساندويش دجاج كرسبي'),
    ],
  },
  {
    name: 'سبشل بركر',
    items: [
      item(
        'جيزي فايكنك',
        5500,
        'شريحة بركر محشية جبن 200 غم - صوص جبن - خس - طماطم - بصل - صوص فايكنك - بطاطا',
        BURGER,
      ),
      item(
        'بيف فايكنك',
        5500,
        'لحم بقري 200 غم محشي شاورما لحم - صوص جبن - خس - طماطم - بصل - صوص فايكنك - بطاطا',
        BURGER,
      ),
      item(
        'راغنار بركر',
        6500,
        'لحم بقري 170 غم - صوص جبن - خس - طماطم - بصل - صوص فايكنك - بطاطا',
        BURGER,
      ),
      item(
        'سوبر بركر',
        5500,
        'لحم بقري 120 غم - شريحة لانشون - صوص جبن - خس - طماطم - بصل - صوص فايكنك - بطاطا',
        BURGER,
      ),
      item(
        'دبل سوبر بركر',
        8000,
        'شريحتين لحم بقري 260 غم - شريحة لحم مدخن (لانشون) - صوص جبن - خس - طماطم - بصل - صوص فايكنك - بطاطا',
        BURGER,
      ),
      item(
        'كراند بركر',
        5500,
        'لحم بقري 120 غم مشوي على الفحم - شريحة لحم مدخن - خس - طماطم - بصل - صوص فايكنك - بطاطا',
        BURGER,
      ),
    ],
  },
  {
    name: 'البركر',
    items: [
      item('كلاسك بركر', 5000, 'لحم بقري 120 غم - خس - طماطم - بصل - صوص فايكنك - بطاطا', BURGER),
      item(
        'جيزي بركر',
        5500,
        'لحم بقري 120 غم - صوص الجبنة شيدر - خس - طماطم - بصل - صوص فايكنك الخاص مع أصابع البطاطا',
        BURGER,
      ),
      item(
        'مشروم بركر',
        5500,
        'لحم بقري 120 غم - شرائح فطر طازجة مشوية - خس - طماطم - بصل - صوص فايكنك الخاص مع أصابع البطاطا',
        BURGER,
      ),
      item(
        'نيويورك بركر',
        5000,
        'لحم بقري 120 غم مشوي على اللهب لمذاق مدخن - خس - طماطم - بصل - صوص فايكنك الخاص مع أصابع البطاطا',
        BURGER,
      ),
      item(
        'مكسيكانو بركر',
        5500,
        'لحم بقري 120 غم - الصوص الحار - خس - طماطم - بصل - صوص فايكنك الخاص مع أصابع البطاطا',
        BURGER,
      ),
      item(
        'كلاسك بركر دجاج',
        4500,
        'شريحة برجر دجاج طازجة 120 غم - خس - طماطم - بصل - صوص فايكنك الخاص مع أصابع البطاطا',
        BURGER,
      ),
      item(
        'لاغرثا - سكالوب',
        6500,
        'سكالوب دجاج مقرمش - خس - طماطم - بصل - جبن شيدر مع بطاطا',
        BURGER,
      ),
      item(
        'صاج بركر',
        5000,
        'شريحة برجر 120 غم ملفوفة بخبز التورتيلا - طماطم - صوص فايكنك الخاص مع أصابع البطاطا',
        BURGER,
      ),
    ],
  },
  {
    name: 'الساندويشات',
    items: [
      item('صاج دجاج', 4000, undefined, [MEAL]),
      item('صاج لحم', 4500, undefined, [MEAL]),
      item('تويستر', 5000, undefined, [MEAL]),
      item('كرسبي', 6000, undefined, [MEAL]),
      item('زنكر بالشوفان', 5000, undefined, [MEAL]),
      item('فاهيتا دجاج', 4500, undefined, [MEAL]),
      item('فاهيتا لحم', 5000, undefined, [MEAL]),
      item('هوت دوغ', 3000, undefined, [MEAL]),
    ],
  },
  {
    name: 'شاورما عائلية',
    items: [
      item('شاورما دجاج عائلية', 10000),
      item('شاورما مكس عائلية', 11000),
      item('شاورما لحم عائلية', 12000),
    ],
  },
  {
    name: 'ريزو',
    items: [
      ...RIZO_FLAVOURS.map((name) => item(name, 6000)),
      item('ميني ريزو', 4000, undefined, [RIZO_FLAVOUR]),
    ],
  },
  {
    name: 'الأجنحة',
    items: [
      item('أجنحة باربكيو', 4000),
      item('أجنحة سبايسي', 4000),
      item('أجنحة سبشل', 4000),
      item('أجنحة هني ماسترد', 4000),
    ],
  },
  {
    name: 'دجاج كرسبي',
    items: [
      item('قطع دجاج مقرمش 3 قطع', 8000, 'صمون - بيبسي - بطاطا - ثومية'),
      item('قطع دجاج مقرمش 6 قطع', 14000, 'صمون - بيبسي - بطاطا - ثومية'),
      item('قطع دجاج مقرمش 9 قطع', 20000, 'صمون - بيبسي - بطاطا - ثومية'),
      item('قطع دجاج مقرمش 15 قطعة', 30000, 'صمون - بيبسي - بطاطا - ثومية'),
      item('ستربس مقرمش 4 قطع', 7500, 'صمون - بطاطا - ثومية'),
      item('ستربس مقرمش 6 قطع', 10500, 'صمون - بطاطا - ثومية'),
    ],
  },
  {
    name: 'الوجبات',
    items: [item('وجبة أودن', 11000), item('وجبة أطفال', 5000, 'مع لعبة')],
  },
  {
    name: 'الفنكر',
    items: [
      item('طبق فنكر', 2500),
      item('طبق فنكر بالصوص', 3000),
      item('طبق فنكر بالجبن', 3000),
      item('طبق فنكر باللحم', 5000),
      item('طبق فلوكي بالجبن', 4000),
      item('طبق فلوكي حار وحلو', 4000),
      item('كوب فنكر', 1500),
      item('كوب كيرلي فنكر', 2500),
      item('كوب حلقات البصل', 2500),
    ],
  },
  {
    name: 'السلطات',
    items: [item('سلطة كرسبي', 5000), item('سلطة سيزار', 5000)],
  },
  {
    name: 'الصلصات',
    items: [
      item('صلصة هني ماسترد', 500),
      item('صلصة سبايسي', 500),
      item('صلصة سبشل', 500),
      item('صلصة ثومية', 500),
      item('صلصة جبن', 500),
      item('صلصة فايكنك', 500),
    ],
  },
];

/** The horned-burger mark from the shop's profile. */
export const VIKING_LOGO_FILE = new URL('./assets/viking-logo.jpg', import.meta.url);

export function vikingBurger(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-VIKING',
    name: 'فايكنك بركر',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'بركر وسبشل بركر وساندويشات وريزو وأجنحة ودجاج كرسبي في حديثة.',
    cuisines: ['burger', 'fast_food', 'chicken', 'sandwiches', 'shawarma'],
    minimumOrderIqd: 2000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: null,
    ratingCount: 0,
    address: 'حديثة',
    district: 'حديثة',
    phone: '+9647779420849',
    ownerUsername,
    ownerName: 'فايكنك بركر',
    hours,
    modifierGroups: [
      {
        name: MEAL,
        required: false,
        minSelect: 0,
        maxSelect: 1,
        options: [{ name: 'وجبة (بطاطا ومشروب)', priceIqd: 1500 }],
      },
      {
        name: EXTRAS,
        required: false,
        minSelect: 0,
        maxSelect: 7,
        options: [
          { name: 'شريحة لحم بركر', priceIqd: 2500 },
          { name: 'قطعة دجاج مقرمش', priceIqd: 2000 },
          { name: 'هلابينو', priceIqd: 500 },
          { name: 'فطر', priceIqd: 500 },
          { name: 'صوص جبن', priceIqd: 500 },
          { name: 'صوص فايكنك', priceIqd: 500 },
          { name: 'شريحة جبن', priceIqd: 500 },
        ],
      },
      {
        name: RIZO_FLAVOUR,
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: RIZO_FLAVOURS.map((name) => ({ name: name.replace('ريزو ', ''), priceIqd: 0 })),
      },
    ],
    menu: MENU,
  };
}
