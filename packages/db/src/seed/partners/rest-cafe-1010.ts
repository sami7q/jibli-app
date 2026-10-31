import type { DemoRestaurant } from '../demo-marketplace.js';

/**
 * 10:10 Rest & Cafe, Haditha — the first real partner shop.
 *
 * Transcribed from the restaurant's own published menu
 * (morinamenu.com/1010rest.cafe) on 31 October 2026, with the owner's
 * agreement. The hookah section is left out: tobacco is not something the app
 * delivers, and listing it would raise the store age rating.
 *
 * Items whose price depends on a choice (size, single or meal) are listed once
 * per choice — «زنجر — سينجل», «زنجر — وجبة» — rather than as one dish with a
 * required option group, because the customer app shows a dish with a required
 * group as «يتوفر قريباً» until option selection ships.
 *
 * Hours (12:00–24:00 daily), delivery fee (2,000 IQD), minimum order
 * (2,500 IQD) and the orders phone are as the restaurant confirmed them on
 * 31 October 2026; the owner can change them from Owner Mode.
 */

type Menu = DemoRestaurant['menu'];
type Item = Menu[number]['items'][number];

/** Kurdish/Persian letter forms → Arabic, so search and sorting agree. */
function ar(text: string): string {
  return text
    .replace(/ک/g, 'ك')
    .replace(/ی/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/ە/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function item(name: string, priceIqd: number, description?: string): Item {
  return description
    ? { name: ar(name), priceIqd, description: ar(description) }
    : { name: ar(name), priceIqd };
}

/** One dish sold in several choices → one item per choice. */
function choices(name: string, description: string | null, options: [string, number][]): Item[] {
  return options.map(([choice, priceIqd]) =>
    item(`${name} — ${choice}`, priceIqd, description ?? undefined),
  );
}

const SINGLE = 'سينجل';
const MEAL = 'وجبة';
const sandwich = (name: string, description: string, single: number, meal: number): Item[] =>
  choices(name, description, [
    [SINGLE, single],
    [MEAL, meal],
  ]);
const pizza = (name: string, description: string | null, medium: number, large: number): Item[] =>
  choices(name, description, [
    ['وسط', medium],
    ['كبير', large],
  ]);

/*
 * The three main sections the app shows above the categories, the way the
 * restaurant's own printed menu is divided.
 */
const FOOD = 'الأطعمة';
const DRINKS = 'المشروبات';
const SWEETS = 'الحلويات';

const MENU: Menu = [
  {
    name: 'سلطات',
    section: FOOD,
    items: [
      item('سلطة بالي ايلاند', 8000),
      item('فتوش', 5000),
      item('تبولة', 5000),
      item('سلطة حلومي', 6000),
      ...choices('سلطة سيزر', 'خس، صوص السيزر، شرائح الدجاج، خبز توست، جبن بارمزان', [
        ['مشوي', 5000],
        ['كرسبي', 5000],
      ]),
      item('سلطة جرجير', 5000),
    ],
  },
  {
    name: 'مقبلات ساخنة',
    section: FOOD,
    items: [
      item('فنكر صغير', 1500),
      item('فنكر كبير', 2000),
      item('فنكر بالجبن', 2500),
      item('هلبينو فنكر', 4000),
      item('بيف فرايز', 5000),
      item('جكن فرايز', 5000),
      item('ودجز', 3000),
      item('ودجز بالجبن', 3500),
      item('حلقات بصل', 3500),
    ],
  },
  {
    name: 'الأطباق الإيطالية',
    section: FOOD,
    items: [
      item('سباغيتي بولونيز', 8000),
      item('بيني بولونيز', 8000),
      item('فوتشيني ألفريدو', 10000),
      item('بيني بيستو', 8000),
    ],
  },
  {
    name: 'الأطباق الغربية',
    section: FOOD,
    items: [
      item('ستراغنوف لحم', 14000),
      item('ستراغنوف دجاج', 12000),
      item('طبق فاهيتا لحم', 12000),
      item('طبق فاهيتا دجاج', 10000),
      item('كوردن بلو', 13000),
      item('طبق سكالوب دجاج', 10000),
    ],
  },
  {
    name: 'ستيك',
    section: FOOD,
    items: [
      ...choices('ستيك لحم', 'فيلي لحم عجل، خضراوات سوتيه، بطاطا بيوريه، صلصة حسب الطلب', [
        ['عادي', 14000],
        ['بصوص الفطر', 16000],
        ['بالجبنة', 16000],
      ]),
      ...choices('ستيك دجاج', 'فيلي صدر دجاج، خضراوات سوتيه، بطاطا بيوريه، صلصة حسب الطلب', [
        ['عادي', 12000],
        ['بصوص الفطر', 14000],
      ]),
    ],
  },
  {
    name: 'بيتزا',
    section: FOOD,
    items: [
      ...pizza('بيتزا دجاج', 'مع الخضار أو بدون حسب الطلب', 10000, 12000),
      ...pizza('بيتزا لحم', 'مع الخضار أو بدون حسب الطلب', 12000, 14000),
      ...pizza('بيتزا بيبروني', null, 11000, 13000),
      ...pizza('بيتزا خضار', null, 9000, 11000),
      ...pizza('بيتزا الفصول الأربعة', null, 12000, 14000),
      ...pizza('بيتزا مارغريتا', null, 8000, 10000),
      ...pizza('بيتزا 10:10', 'محشية الأطراف', 13000, 15000),
      ...choices('صاج إيطالي', null, [
        ['لحم', 7000],
        ['دجاج', 6000],
      ]),
      item('لغم برجر لحم', 8000),
    ],
  },
  {
    name: 'ساندويش لحم',
    section: FOOD,
    items: [
      ...sandwich(
        'برجر الفطر',
        '١١٥ غرام لحم بقري، فطر، بصل مكرمل، صلصة الفطر، جبن، طماطم',
        7000,
        8000,
      ),
      ...sandwich(
        'سموك برجر',
        '١١٥ غرام لحم، شريحة لحم مقدد، بصل مكرمل، صلصة باربيكيو، جبن، خس، طماطم',
        7000,
        8000,
      ),
      ...sandwich('برجر كلاسيك', '١١٥ غرام لحم، صوص خاص، مخلل، خس، طماطم', 5000, 6000),
      ...sandwich('تشيلي برجر', '١١٥ غرام لحم بقري، صلصة حارة، هالبينو، جبن، خس', 6500, 7500),
      ...sandwich('تشيز برجر', '١١٥ غرام لحم، كاتشب، طماطم، خس، جبنة شيدر أمريكية', 5500, 6500),
      ...sandwich(
        'تكساس برجر',
        '٢٠٠ غرام لحم بقري، صلصة تكساس، خس، جبنة شيدر أمريكية، طماطم',
        8000,
        9000,
      ),
      ...sandwich(
        'برجر موزاريلا',
        '١١٥ غرام لحم بقري، صلصة خاصة، شريحة جبنة موزاريلا مقرمشة، خس، طماطم',
        7000,
        8000,
      ),
      ...sandwich(
        'راب برجر',
        'خبز تورتيلا، قطعة لحم بقري ١١٥ غرام، جبنة موزاريلا، فلفل، بصل مكرمل، خس، طماطم',
        7000,
        8000,
      ),
      ...sandwich(
        'سبيشل برجر',
        '٢٠٠ غرام لحم بقري، إضافات خاصة، جبنة مدخنة، جبنة موزاريلا، جبنة شيدر',
        9000,
        10000,
      ),
      ...sandwich(
        'برجر بريسكت',
        'برجر لحم ٢٠٠ غرام، بصل مكرمل، شريحة لحم بقري مدخن ١٠٠ غرام، شريحة جبن، صلصة باربيكيو، طماطم',
        10000,
        11000,
      ),
      ...sandwich(
        'برجر 10:10',
        '٣٠٠ غرام لحم بقري، بصل مكرمل، شريحة لحم مقدد، خس، جبن، طماطم، صلصة 10:10',
        10000,
        11000,
      ),
      ...sandwich(
        'تشيز ستيك فيليه',
        'شرائح لحم بقري، شرائح فلفل رومي، فطر، جبنة موزاريلا، جبنة شيدر أمريكية',
        8000,
        9000,
      ),
    ],
  },
  {
    name: 'الشاورما',
    section: FOOD,
    items: [item('ساندويش شاورما دجاج', 3500), item('وجبة شاورما دجاج عربي', 5000)],
  },
  {
    name: 'ريزو',
    section: FOOD,
    items: [
      item('ريزو كلاسيك', 5000),
      item('ريزو حار (سبايسي)', 5000),
      item('ريزو باربيكيو', 5000),
      item('ريزو أعشاب', 6000),
      item('ريزو جبنة', 6000),
      item('ريزو مدخن', 6000),
      item('ميكس ريزو', 6000),
      item('ريزو 10:10', 6500),
    ],
  },
  {
    name: 'توستر',
    section: FOOD,
    items: [
      item('توستر كلاسيك', 4000),
      item('توستر مدخن', 6000),
      item('توستر بالجبن', 5000),
      item('توستر حار (سبايسي)', 5000),
      item('توستر كرلد', 6000),
    ],
  },
  {
    name: 'ساندويش دجاج',
    section: FOOD,
    items: [
      ...sandwich('زنجر', 'صدر دجاج مقرمش، صلصة الزنجر، خس — حار أو عادي', 4000, 5000),
      ...sandwich('فلر', '٣ شرائح، جبن، شرائح ديك رومي، خس، طماطم', 7000, 8000),
      ...sandwich(
        'بك لفل',
        'قطعتان كبيرتان كرسبي، جبن، صلصة بك لفل، خس، شريحة ديك رومي مدخن',
        7000,
        8000,
      ),
      ...sandwich('برجر دجاج', '١٥٠ غرام دجاج، جبن، خس، مايونيز', 4000, 5000),
      ...sandwich(
        'سكريت زنجر',
        'صدر دجاج مقرمش، صلصة سكريت خاصة، خس، شريحة جبنة شيدر، طماطم',
        5000,
        6000,
      ),
      ...sandwich('هوت تشيلي', 'قطع دجاج مقرمشة، صلصة حارة، هالبينو، جبن، خس', 5000, 6000),
      ...sandwich('سكالوب دجاج', 'صدر دجاج مقرمش، صلصة سكالوب، خس، سلطة كول سلو', 4000, 5000),
      ...sandwich('دجاج سويس مشروم', '١٥٠ غرام دجاج مشوي، فطر، بصل مكرمل، صلصة الفطر', 6500, 7500),
      ...sandwich('فاهيتا دجاج', 'شرائح دجاج، جبن، شرائح فلفل، مشروم، صلصة فاهيتا', 7000, 8000),
    ],
  },
  {
    name: 'دجاج مقلي',
    section: FOOD,
    items: [
      item('كرسبي ٣ قطع', 7000),
      item('كرسبي ٥ قطع', 9000),
      item('كرسبي عائلي ١٠ قطع', 18000),
      item('كرسبي جامبو ١٤ قطعة', 23000),
      item('ستربس ٣ قطع', 6000),
      item('ستربس ٥ قطع', 8000),
      item('ستربس عائلي ١٠ قطع', 16000),
      item('ستربس جامبو ١٤ قطعة', 20000),
      item('وجبة مكس', 9000),
    ],
  },
  {
    name: 'مشروبات غازية',
    section: DRINKS,
    items: [item('ماء', 250), item('كولا', 500), item('كولا ماكنة', 1000)],
  },
  {
    name: 'مشروبات ساخنة',
    section: DRINKS,
    items: [
      item('شاي', 500),
      item('قهوة عربية', 2000),
      item('قهوة تركية', 2000),
      item('قهوة جكليتية', 2000),
      item('هوت جوكليت', 3500),
      ...choices('اسبريسو', null, [
        ['سنكل شوت', 2500],
        ['دبل شوت', 3000],
      ]),
      ...choices('لاتيه', null, [
        ['عادي', 3500],
        ['كراميل', 4000],
        ['فانيلا', 4000],
        ['سبانش لاتيه', 4000],
        ['بستاشيو', 4500],
      ]),
      item('كابتشينو', 3500),
      item('موكا', 4000),
    ],
  },
  {
    name: 'ميلك شيك',
    section: DRINKS,
    items: [
      item('ميلك شيك نوتيلا', 4000),
      item('ميلك شيك فراولة', 4000),
      item('ميلك شيك موز', 3500),
      item('ميلك شيك أوريو', 4000),
      item('ميلك شيك لوتس', 4000),
      item('ميلك شيك فانيلا', 4000),
      item('ميلك شيك كراميل', 4000),
    ],
  },
  {
    name: 'موهيتو',
    section: DRINKS,
    items: [
      item('موهيتو كلاسيك', 3000),
      item('موهيتو بلو', 3000),
      item('موهيتو فراولة', 3000),
      item('موهيتو مانكو', 3000),
      item('موهيتو توت', 3000),
      item('موهيتو رمان', 3000),
      item('موهيتو باشن فروت', 3500),
    ],
  },
  {
    name: 'سموذي',
    section: DRINKS,
    items: [
      item('سموذي برتقال', 3000),
      item('سموذي فراولة', 3500),
      item('سموذي ليمون ونعناع', 3500),
      item('سموذي خوخ', 3500),
      item('سموذي توت', 3500),
      item('سموذي مانكو', 3500),
      item('سموذي رمان', 3500),
    ],
  },
  {
    name: 'كريب',
    section: SWEETS,
    items: [
      item('كريب 10:10', 6000),
      item('كريب فواكه', 5000),
      item('كريب كندر', 5000),
      item('كريب لوتس', 5000),
      item('كريب أوريو', 5000),
      item('كريب مكسرات', 6000),
      item('كريب جوكليت', 4000),
      item('بنانا رول', 5000),
      item('كريب فوتشيني', 5000),
    ],
  },
  {
    name: 'وافل',
    section: SWEETS,
    items: [
      item('وافل فواكه', 5000),
      item('وافل أوريو', 5000),
      item('وافل لوتس', 5000),
      item('وافل بستاشيو', 6000),
      item('وافل كندر', 5000),
      item('وافل مكسرات', 6000),
      item('وافل جوكليت', 4000),
      item('وافل 10:10', 6000),
      item('وافل مكس', 6000),
    ],
  },
  {
    name: 'بان كيك',
    section: SWEETS,
    items: [
      item('بان كيك فواكه', 5000),
      item('بان كيك كندر', 5000),
      item('بان كيك لوتس', 5000),
      item('ميني بان كيك', 5000),
      item('بان كيك بستاشيو', 6000),
      item('بان كيك أوريو', 6000),
    ],
  },
];

/** The restaurant's own logo, as published on its menu page. */
export const REST_CAFE_1010_LOGO_URL =
  'https://media.morinamenu.com/uploads/Anbar/1010rest.cafe/1010rest.cafe-1ba1.png';

export function restCafe1010(ownerUsername: string): DemoRestaurant {
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['12:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: 'PARTNER-HDT-1010',
    name: '10:10 Rest & Cafe',
    merchantType: 'RESTAURANT',
    cityCode: 'IQ-AN-HADITHA',
    description: 'مطعم وكافيه في حديثة: برجر، بيتزا، دجاج مقلي، ستيك، مشروبات وحلويات.',
    cuisines: ['burger', 'pizza', 'chicken', 'fast_food', 'shawarma'],
    minimumOrderIqd: 2500,
    deliveryFeeIqd: 2000,
    prepMinutes: 25,
    rating: null,
    ratingCount: 0,
    address: 'حديثة',
    district: 'حديثة',
    phone: '+9647837204366',
    ownerUsername,
    ownerName: '10:10 Rest & Cafe',
    hours,
    menu: MENU,
  };
}
