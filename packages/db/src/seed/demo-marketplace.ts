import { and, eq, isNull } from 'drizzle-orm';
import { hashPassword } from '@jibli/auth';
import type { MerchantType } from '@jibli/contracts';
import type { Database } from '../client.js';
import { uuidv7 } from '../ids.js';
import {
  appBanners,
  branchWorkingHours,
  cities,
  itemModifierGroups,
  menuCategories,
  menuItems,
  modifierGroups,
  modifiers,
  providers,
  restaurantBranches,
  restaurantCommissionConfigs,
  restaurantMembers,
  restaurants,
  users,
} from '../schema/index.js';
import {
  DEMO_BANNERS,
  DEMO_HUE_SHIFTS,
  promoBanner,
  restaurantCover,
  restaurantLogo,
  upsertImageAsset,
} from './demo-images.js';

/**
 * A demo marketplace: restaurants, branches, hours and menus.
 *
 * Two jobs, and the second is the reason it is this specific set rather than
 * one restaurant repeated.
 *
 * It gives a fresh database something to show — an app with an empty
 * restaurant list is indistinguishable from an app that is broken, and that
 * ambiguity costs more time than the data does.
 *
 * And it exercises every state the customer app can render: a restaurant that
 * is closed right now, one with free delivery, one with a minimum order the
 * cart must warn about, one with no ratings yet, one with options that make the
 * item sheet do real work. Seeding six identical open restaurants would leave
 * every one of those paths unproven.
 *
 * Idempotent on `partner_code`, which is unique. Running it twice changes
 * nothing; running it after a schema change updates what it owns and leaves
 * everything else alone.
 *
 * **Not for production.** `seed/run.ts` refuses to call it when
 * `APP_ENV=production`, because a fake restaurant in a live marketplace is
 * visible to real customers and orderable by them.
 */

/** Every demo row carries this, so it can be found and removed as a set. */
export const DEMO_PARTNER_PREFIX = 'DEMO-';

/**
 * What a demo restaurant pays Jibli per order.
 *
 * The same 500 as the platform default. Kept explicit rather than read from
 * `platform_config` because a commission is a deal struck with one restaurant,
 * and a demo that silently inherits a changed default would misprice itself.
 */
const DEMO_COMMISSION_FLAT_IQD = 500;

/** Password for every seeded portal owner. Demo data, stated plainly. */
const DEMO_PASSWORD = 'Jibli!Demo2026';

type Minutes = number;

/** `18:30` → minutes from local midnight. */
function at(time: string): Minutes {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface DemoItem {
  readonly name: string;
  readonly description?: string;
  readonly priceIqd: number;
  readonly popular?: boolean;
  /** Out of stock today — the app must grey it out rather than hide it. */
  readonly unavailable?: boolean;
  /** Names of modifier groups defined on the same restaurant. */
  readonly options?: readonly string[];
}

interface DemoCategory {
  readonly name: string;
  readonly description?: string;
  readonly items: readonly DemoItem[];
}

interface DemoModifierGroup {
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly { name: string; priceIqd: number }[];
}

interface DemoRestaurant {
  readonly partnerCode: string;
  readonly name: string;
  /**
   * Which storefront it appears in. Omitted means RESTAURANT, which is what
   * every entry written before markets existed means.
   */
  readonly merchantType?: MerchantType;
  readonly description: string;
  readonly cuisines: readonly string[];
  readonly minimumOrderIqd: number;
  readonly deliveryFeeIqd: number;
  readonly prepMinutes: number;
  readonly rating: number | null;
  readonly ratingCount: number;
  readonly address: string;
  readonly district: string;
  readonly phone: string;
  /** Portal sign-in name for the owner. */
  readonly ownerUsername: string;
  readonly ownerName: string;
  /**
   * Weekly opening. `null` for a day means closed.
   * Written as local Baghdad times, which is how a restaurant thinks of them.
   */
  readonly hours: Readonly<Record<number, readonly [string, string] | null>>;
  readonly modifierGroups?: readonly DemoModifierGroup[];
  readonly menu: readonly DemoCategory[];
}

/** Open every day, same hours — the common case. */
function daily(open: string, close: string): Record<number, readonly [string, string]> {
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [day, [open, close] as const]));
}

/**
 * Around the clock.
 *
 * `24:00` is 1440 minutes, and the evaluator treats a window as the half-open
 * range `[open, close)` — so 0 to 1440 covers every minute of the day with no
 * gap. `00:00` to `00:00` would *not* work: a zero-length window is read as a
 * configuration error and treated as closed, deliberately, so that a
 * misconfigured branch cannot end up taking orders around the clock by
 * accident.
 *
 * Two of the six restaurants use this, and the reason is testing rather than
 * realism: without it, a demo dataset seeded in the evening shows six closed
 * restaurants at nine the next morning, and whoever opens the app cannot tell
 * that from a broken one. The other four keep real, varied hours so the closed
 * state stays exercised too.
 */
function always(): Record<number, readonly [string, string]> {
  return daily('00:00', '24:00');
}

/*
 * A market, seeded beside the restaurants because the home screen now has two
 * tabs and an empty one proves nothing.
 *
 * Its catalog is shaped the way a grocery's is rather than a kitchen's: aisles
 * instead of courses, packaged goods with a size in the name, no preparation
 * time worth speaking of, and a low delivery fee on a larger basket. The
 * ordering, delivery, commission and portal behind it are the restaurants'
 * unchanged — which is the point of the whole discriminator.
 */
const DEMO_MARKETS: readonly DemoRestaurant[] = [
  {
    partnerCode: 'DEMO-2001',
    merchantType: 'MARKET',
    name: 'ماركت الرشيد',
    description: 'بقالة ومواد غذائية، توصيل سريع لكل ما ينقص البيت.',
    cuisines: ['grocery', 'mk_dairy', 'mk_produce', 'mk_household'],
    minimumOrderIqd: 5000,
    deliveryFeeIqd: 1500,
    // A market picks from a shelf; it does not cook. Ten minutes is packing.
    prepMinutes: 10,
    rating: 4.5,
    ratingCount: 186,
    address: 'شارع فلسطين، حي البنوك',
    district: 'البنوك',
    phone: '+9647701110007',
    ownerUsername: 'demo.market',
    ownerName: 'أبو أحمد الرشيد',
    hours: always(),
    menu: [
      {
        name: 'ألبان وأجبان',
        description: 'مبرّدة، تصل باردة',
        items: [
          { name: 'حليب طازج ١ لتر', description: 'مبستر، كامل الدسم', priceIqd: 2000 },
          { name: 'لبن رائب ٥٠٠ غم', priceIqd: 1500 },
          { name: 'جبن أبيض ٤٠٠ غم', priceIqd: 4500 },
          { name: 'زبدة ٢٠٠ غم', priceIqd: 3500 },
          { name: 'بيض طازج ٣٠ حبة', description: 'محلي', priceIqd: 7000 },
        ],
      },
      {
        name: 'مواد غذائية أساسية',
        items: [
          { name: 'رز بسمتي ٥ كغم', priceIqd: 12_000 },
          { name: 'سكر ٢ كغم', priceIqd: 2500 },
          { name: 'زيت دوار الشمس ١.٨ لتر', priceIqd: 6500 },
          { name: 'طحين ٥ كغم', priceIqd: 5000 },
          { name: 'معجون طماطم ٨٠٠ غم', priceIqd: 3000 },
          { name: 'شاي أسود ٤٠٠ غم', description: 'سيلاني', priceIqd: 5500 },
        ],
      },
      {
        name: 'خضار وفواكه',
        description: 'من سوق الجملة كل صباح',
        items: [
          { name: 'طماطم ١ كغم', priceIqd: 1500 },
          { name: 'خيار ١ كغم', priceIqd: 1250 },
          { name: 'بصل ١ كغم', priceIqd: 1000 },
          { name: 'بطاطا ٢ كغم', priceIqd: 2500 },
          { name: 'تفاح أحمر ١ كغم', priceIqd: 4000 },
          { name: 'موز ١ كغم', priceIqd: 3500, unavailable: true },
        ],
      },
      {
        name: 'مشروبات',
        items: [
          { name: 'ماء ١.٥ لتر — ٦ قناني', priceIqd: 3000 },
          { name: 'بيبسي ٣٣٠ مل — ٦ علب', priceIqd: 4500 },
          { name: 'عصير برتقال ١ لتر', priceIqd: 3000 },
        ],
      },
      {
        name: 'منظفات ومستلزمات',
        items: [
          { name: 'مسحوق غسيل ٣ كغم', priceIqd: 8000 },
          { name: 'صابون أطباق ٧٥٠ مل', priceIqd: 2500 },
          { name: 'مناديل ورقية — ٥ علب', priceIqd: 4000 },
          { name: 'أكياس قمامة — ٥٠ كيس', priceIqd: 2000 },
        ],
      },
    ],
  },

  /*
   * A corner shop: small basket, short list, and open around the clock.
   *
   * The counterpart to a full market in every number that matters — a 3,000
   * dinar minimum against 5,000, five minutes of picking against ten — because
   * a storefront that shows six merchants with identical fees and identical
   * times is a storefront nobody has to read.
   */
  {
    partnerCode: 'DEMO-2002',
    merchantType: 'MARKET',
    name: 'بقالة الحي',
    description: 'أساسيات البيت، على بعد دقائق. مفتوح على مدار الساعة.',
    cuisines: ['grocery', 'mk_bakery'],
    minimumOrderIqd: 3000,
    deliveryFeeIqd: 1000,
    prepMinutes: 5,
    rating: 4.3,
    ratingCount: 94,
    address: 'شارع ٦٢، حي الجامعة',
    district: 'الجامعة',
    phone: '+9647701110008',
    ownerUsername: 'demo.baqala',
    ownerName: 'أبو زيد',
    hours: always(),
    menu: [
      {
        name: 'الأساسيات',
        items: [
          { name: 'خبز صمون — ١٠ أقراص', priceIqd: 1000 },
          { name: 'حليب ١ لتر', priceIqd: 2000 },
          { name: 'بيض ١٢ حبة', priceIqd: 3000 },
          { name: 'سكر ١ كغم', priceIqd: 1250 },
          { name: 'شاي ٢٠٠ غم', priceIqd: 3000 },
        ],
      },
      {
        name: 'وجبات سريعة',
        items: [
          { name: 'معكرونة ٥٠٠ غم', priceIqd: 1500 },
          { name: 'تونة معلبة ١٨٥ غم', priceIqd: 2500 },
          { name: 'فاصولياء معلبة', priceIqd: 2000 },
        ],
      },
      {
        name: 'مشروبات وحلويات',
        items: [
          { name: 'ماء ٠.٥ لتر — ١٢ قنينة', priceIqd: 3500 },
          { name: 'مشروب غازي ١ لتر', priceIqd: 1750 },
          { name: 'بسكويت — ٦ قطع', priceIqd: 2000 },
          { name: 'شوكولاتة', priceIqd: 1000 },
        ],
      },
    ],
  },

  /*
   * A produce specialist, with a shorter day.
   *
   * Closes at six, which is what a vegetable seller does, and the point of
   * seeding it: the closed state has to be exercised on the market side too,
   * not only among the restaurants.
   */
  {
    partnerCode: 'DEMO-2003',
    merchantType: 'MARKET',
    name: 'خضار وفواكه الطازج',
    description: 'من سوق الجملة كل فجر. خضار وفواكه فقط.',
    cuisines: ['grocery', 'mk_produce'],
    minimumOrderIqd: 4000,
    deliveryFeeIqd: 1500,
    prepMinutes: 15,
    rating: 4.8,
    ratingCount: 241,
    address: 'سوق الشورجة، باب الشيخ',
    district: 'باب الشيخ',
    phone: '+9647701110009',
    ownerUsername: 'demo.khudar',
    ownerName: 'حاج كريم',
    hours: daily('06:00', '18:00'),
    menu: [
      {
        name: 'خضار',
        items: [
          { name: 'طماطم ١ كغم', priceIqd: 1500 },
          { name: 'خيار ١ كغم', priceIqd: 1250 },
          { name: 'باذنجان ١ كغم', priceIqd: 1500 },
          { name: 'فلفل أخضر ٥٠٠ غم', priceIqd: 1250 },
          { name: 'بصل ٢ كغم', priceIqd: 2000 },
          { name: 'بطاطا ٢ كغم', priceIqd: 2500 },
        ],
      },
      {
        name: 'فواكه',
        items: [
          { name: 'تفاح ١ كغم', priceIqd: 4000 },
          { name: 'برتقال ٢ كغم', priceIqd: 5000 },
          { name: 'موز ١ كغم', priceIqd: 3500 },
          { name: 'عنب ١ كغم', priceIqd: 5000, unavailable: true },
          { name: 'رمان ١ كغم', priceIqd: 4500 },
        ],
      },
      {
        name: 'أعشاب',
        items: [
          { name: 'بقدونس — حزمة', priceIqd: 500 },
          { name: 'نعناع — حزمة', priceIqd: 500 },
          { name: 'جرجير — حزمة', priceIqd: 750 },
        ],
      },
    ],
  },

  /*
   * The big one: bulk sizes, a high minimum, and free delivery above it.
   *
   * A fee of zero is worth having in the data — the card renders «مجاناً»
   * instead of a number, and that branch is otherwise only reachable by
   * editing a restaurant by hand.
   */
  {
    partnerCode: 'DEMO-2004',
    merchantType: 'MARKET',
    name: 'هايبر ماركت العائلة',
    description: 'تسوّق الشهر بأسعار الجملة. توصيل مجاني.',
    cuisines: ['grocery', 'mk_household'],
    minimumOrderIqd: 25_000,
    deliveryFeeIqd: 0,
    prepMinutes: 25,
    rating: 4.6,
    ratingCount: 512,
    address: 'طريق المطار، حي الجهاد',
    district: 'الجهاد',
    phone: '+9647701110010',
    ownerUsername: 'demo.hyper',
    ownerName: 'شركة العائلة للتجارة',
    hours: daily('08:00', '23:00'),
    menu: [
      {
        name: 'حصص شهرية',
        description: 'كميات الجملة للعائلة',
        items: [
          { name: 'رز بسمتي ١٠ كغم', priceIqd: 22_000 },
          { name: 'زيت طبخ ٤ لتر', priceIqd: 13_000 },
          { name: 'سكر ١٠ كغم', priceIqd: 11_000 },
          { name: 'طحين ١٠ كغم', priceIqd: 9500 },
          { name: 'عدس ٥ كغم', priceIqd: 12_000 },
        ],
      },
      {
        name: 'معلبات',
        items: [
          { name: 'معجون طماطم — ١٢ علبة', priceIqd: 15_000 },
          { name: 'تونة — ٦ علب', priceIqd: 13_500 },
          { name: 'ذرة حلوة — ٦ علب', priceIqd: 9000 },
        ],
      },
      {
        name: 'منظفات',
        items: [
          { name: 'مسحوق غسيل ٩ كغم', priceIqd: 21_000 },
          { name: 'منعّم ملابس ٤ لتر', priceIqd: 8500 },
          { name: 'مبيّض ٤ لتر', priceIqd: 4000 },
          { name: 'مناديل — ١٢ علبة', priceIqd: 9000 },
        ],
      },
      {
        name: 'مستلزمات أطفال',
        items: [
          { name: 'حفاضات — عبوة كبيرة', priceIqd: 18_000 },
          { name: 'مناديل مبللة — ٦ عبوات', priceIqd: 7000 },
          { name: 'حليب أطفال ٤٠٠ غم', priceIqd: 14_000 },
        ],
      },
    ],
  },

  /*
   * A butcher, deliberately not rated.
   *
   * `rating: null` is the case that put an unrated partner above a 4.9 before
   * the storefront learned to sort NULLS LAST, and nothing on the market side
   * exercised it until now.
   */
  {
    partnerCode: 'DEMO-2005',
    merchantType: 'MARKET',
    name: 'ملحمة البركة',
    description: 'لحوم طازجة يومياً، ذبح اليوم. تقطيع حسب الطلب.',
    cuisines: ['grocery', 'mk_meat'],
    minimumOrderIqd: 15_000,
    deliveryFeeIqd: 2000,
    prepMinutes: 20,
    rating: null,
    ratingCount: 0,
    address: 'شارع الكفاح، باب المعظم',
    district: 'باب المعظم',
    phone: '+9647701110011',
    ownerUsername: 'demo.malhama',
    ownerName: 'أبو حسن القصاب',
    hours: daily('07:00', '21:00'),
    menu: [
      {
        name: 'لحوم حمراء',
        items: [
          { name: 'لحم غنم ١ كغم', description: 'ذبح اليوم', priceIqd: 22_000 },
          { name: 'لحم عجل ١ كغم', priceIqd: 18_000 },
          { name: 'كباب مفروم ١ كغم', priceIqd: 16_000 },
          { name: 'ضلوع غنم ١ كغم', priceIqd: 20_000 },
        ],
      },
      {
        name: 'دواجن',
        items: [
          { name: 'دجاج كامل — حبة', priceIqd: 7000 },
          { name: 'صدور دجاج ١ كغم', priceIqd: 9000 },
          { name: 'أفخاذ دجاج ١ كغم', priceIqd: 7500 },
        ],
      },
      {
        name: 'أسماك',
        items: [
          { name: 'كارب نهري ١ كغم', priceIqd: 12_000 },
          { name: 'زبيدي ١ كغم', priceIqd: 25_000, unavailable: true },
        ],
      },
    ],
  },

  /*
   * A pastry and dairy shop, closed on Fridays.
   *
   * The only merchant in the dataset with a day off, which is what makes the
   * weekly-hours evaluation testable at all: every other one either opens
   * daily or opens around the clock.
   */
  {
    partnerCode: 'DEMO-2006',
    merchantType: 'MARKET',
    name: 'ألبان ومعجنات الصباح',
    description: 'أجبان بلدية ومعجنات تُخبز كل صباح. مغلق الجمعة.',
    cuisines: ['grocery', 'mk_dairy', 'mk_bakery'],
    minimumOrderIqd: 6000,
    deliveryFeeIqd: 1500,
    prepMinutes: 12,
    rating: 4.9,
    ratingCount: 168,
    address: 'شارع الأطباء، المنصور',
    district: 'المنصور',
    phone: '+9647701110012',
    ownerUsername: 'demo.alban',
    ownerName: 'أم محمد',
    hours: {
      0: ['06:00', '20:00'],
      1: ['06:00', '20:00'],
      2: ['06:00', '20:00'],
      3: ['06:00', '20:00'],
      4: ['06:00', '20:00'],
      5: null,
      6: ['06:00', '20:00'],
    },
    menu: [
      {
        name: 'أجبان وألبان',
        items: [
          { name: 'جبن بلدي ٥٠٠ غم', priceIqd: 6000 },
          { name: 'لبن رائب ١ كغم', priceIqd: 2500 },
          { name: 'قيمر طازج ٢٥٠ غم', description: 'صباحاً فقط', priceIqd: 5000 },
          { name: 'زبدة بلدية ٢٥٠ غم', priceIqd: 4500 },
        ],
      },
      {
        name: 'معجنات',
        items: [
          { name: 'صمون بالجبن — ٦ حبات', priceIqd: 4000 },
          { name: 'فطيرة سبانخ — ٤ حبات', priceIqd: 3500 },
          { name: 'كعك بالسمسم — ١٢ حبة', priceIqd: 3000 },
        ],
      },
      {
        name: 'عسل ومربى',
        items: [
          { name: 'عسل طبيعي ٥٠٠ غم', priceIqd: 15_000 },
          { name: 'مربى تين ٤٠٠ غم', priceIqd: 4000 },
          { name: 'دبس تمر ٧٠٠ غم', priceIqd: 5000 },
        ],
      },
    ],
  },
];

const DEMO_RESTAURANTS: readonly DemoRestaurant[] = [
  {
    partnerCode: 'DEMO-1001',
    name: 'مندي حضرموت',
    description: 'مندي ومظبي على الحطب، بخلطة حضرمية أصلية.',
    cuisines: ['iraqi', 'grills', 'meat'],
    minimumOrderIqd: 10_000,
    deliveryFeeIqd: 2000,
    prepMinutes: 35,
    rating: 4.7,
    ratingCount: 312,
    address: 'شارع الربيعي، حي زيونة',
    district: 'زيونة',
    phone: '+9647701110001',
    ownerUsername: 'demo.mandi',
    ownerName: 'أبو سالم الحضرمي',
    // Around the clock: this is the restaurant with the fullest menu and the
    // required option group, so it is the one a tester reaches for first.
    hours: always(),
    modifierGroups: [
      {
        name: 'الحجم',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'نص كيلو', priceIqd: 0 },
          { name: 'كيلو كامل', priceIqd: 7000 },
        ],
      },
      {
        name: 'إضافات',
        required: false,
        minSelect: 0,
        maxSelect: 3,
        options: [
          { name: 'صلصة حارة', priceIqd: 500 },
          { name: 'لبن زبادي', priceIqd: 1000 },
          { name: 'سلطة إضافية', priceIqd: 1500 },
        ],
      },
    ],
    menu: [
      {
        name: 'المندي والمظبي',
        description: 'يُطبخ على الحطب يومياً من الساعة العاشرة صباحاً',
        items: [
          {
            name: 'مندي لحم',
            description: 'لحم غنم طري على رز بسمتي بخلطة حضرمية',
            priceIqd: 18_000,
            popular: true,
            options: ['الحجم', 'إضافات'],
          },
          {
            name: 'مندي دجاج',
            description: 'دجاج كامل مدخّن على الحطب',
            priceIqd: 12_000,
            popular: true,
            options: ['الحجم', 'إضافات'],
          },
          { name: 'مظبي لحم', description: 'مشوي على الحجر الساخن', priceIqd: 20_000 },
          {
            name: 'مندي سمك',
            description: 'حسب الصيد اليومي',
            priceIqd: 16_000,
            unavailable: true,
          },
        ],
      },
      {
        name: 'المقبلات',
        items: [
          { name: 'سلطة حضرمية', priceIqd: 3000 },
          { name: 'شوربة عدس', priceIqd: 2500 },
          { name: 'حمص بالطحينة', priceIqd: 3500 },
        ],
      },
      {
        name: 'المشروبات',
        items: [
          { name: 'لبن عيران', priceIqd: 1500 },
          { name: 'ماء', priceIqd: 500 },
          { name: 'شاي حضرمي', priceIqd: 1000 },
        ],
      },
    ],
  },

  {
    partnerCode: 'DEMO-1002',
    // Free delivery: the card shows a «توصيل مجاني» badge and the cart shows
    // «مجاناً» instead of a fee.
    name: 'برجر بغداد',
    description: 'برجر لحم طازج يومياً، وبطاطا مقلية بالزيت النظيف.',
    cuisines: ['burger', 'fast_food', 'sandwiches'],
    minimumOrderIqd: 0,
    deliveryFeeIqd: 0,
    prepMinutes: 20,
    rating: 4.4,
    ratingCount: 128,
    address: 'شارع الكرادة داخل، قرب ساحة كهرمانة',
    district: 'الكرادة',
    phone: '+9647701110002',
    ownerUsername: 'demo.burger',
    ownerName: 'حيدر الكرخي',
    // Also around the clock, because this is the free-delivery restaurant and
    // that badge should be checkable whenever someone opens the app.
    hours: always(),
    modifierGroups: [
      {
        name: 'درجة الاستواء',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'وسط', priceIqd: 0 },
          { name: 'ويل دن', priceIqd: 0 },
        ],
      },
      {
        name: 'إضافات البرجر',
        required: false,
        minSelect: 0,
        maxSelect: 4,
        options: [
          { name: 'جبن إضافي', priceIqd: 1000 },
          { name: 'بيكون', priceIqd: 1500 },
          { name: 'بيض مقلي', priceIqd: 1000 },
          { name: 'مخلل حار', priceIqd: 500 },
        ],
      },
    ],
    menu: [
      {
        name: 'البرجر',
        items: [
          {
            name: 'برجر كلاسيك',
            description: 'قطعة لحم ١٥٠ غم، خس، طماطم، صلصة البيت',
            priceIqd: 7000,
            popular: true,
            options: ['درجة الاستواء', 'إضافات البرجر'],
          },
          {
            name: 'دبل تشيز برجر',
            description: 'قطعتان لحم وجبن شيدر مضاعف',
            priceIqd: 11_000,
            popular: true,
            options: ['درجة الاستواء', 'إضافات البرجر'],
          },
          {
            name: 'برجر دجاج مقرمش',
            priceIqd: 6500,
            options: ['إضافات البرجر'],
          },
        ],
      },
      {
        name: 'الإضافات الجانبية',
        items: [
          { name: 'بطاطا مقلية', priceIqd: 2500, popular: true },
          { name: 'بطاطا بالجبن', priceIqd: 3500 },
          { name: 'حلقات بصل', priceIqd: 3000 },
        ],
      },
      {
        name: 'المشروبات',
        items: [
          { name: 'بيبسي', priceIqd: 1000 },
          { name: 'عصير برتقال طازج', priceIqd: 2500 },
        ],
      },
    ],
  },

  {
    partnerCode: 'DEMO-1003',
    name: 'بيتزا روما',
    description: 'عجينة إيطالية ترتاح ٢٤ ساعة، وفرن حجري.',
    cuisines: ['pizza', 'italian', 'fast_food'],
    minimumOrderIqd: 15_000,
    deliveryFeeIqd: 3000,
    prepMinutes: 30,
    rating: 4.8,
    ratingCount: 96,
    address: 'شارع ٦٢، حي الجامعة',
    district: 'الجامعة',
    phone: '+9647701110003',
    ownerUsername: 'demo.pizza',
    ownerName: 'مارتن عوديشو',
    hours: daily('12:00', '23:00'),
    modifierGroups: [
      {
        name: 'حجم البيتزا',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'صغيرة ٢٤ سم', priceIqd: 0 },
          { name: 'وسط ٣٠ سم', priceIqd: 4000 },
          { name: 'كبيرة ٤٠ سم', priceIqd: 8000 },
        ],
      },
      {
        name: 'إضافات',
        required: false,
        minSelect: 0,
        maxSelect: 5,
        options: [
          { name: 'جبن موزاريلا إضافي', priceIqd: 2000 },
          { name: 'فطر', priceIqd: 1500 },
          { name: 'زيتون أسود', priceIqd: 1000 },
          { name: 'فلفل حار', priceIqd: 750 },
        ],
      },
    ],
    menu: [
      {
        name: 'البيتزا',
        description: 'كل البيتزا على عجينة مخمّرة ٢٤ ساعة',
        items: [
          {
            name: 'مارغريتا',
            description: 'صلصة طماطم، موزاريلا، ريحان طازج',
            priceIqd: 12_000,
            popular: true,
            options: ['حجم البيتزا', 'إضافات'],
          },
          {
            name: 'بيبروني',
            priceIqd: 15_000,
            popular: true,
            options: ['حجم البيتزا', 'إضافات'],
          },
          {
            name: 'خضار مشكل',
            description: 'فلفل، فطر، زيتون، بصل',
            priceIqd: 13_000,
            options: ['حجم البيتزا', 'إضافات'],
          },
          { name: 'بيتزا الدجاج بالباربكيو', priceIqd: 16_000, options: ['حجم البيتزا'] },
        ],
      },
      {
        name: 'الباستا',
        items: [
          { name: 'باستا ألفريدو', description: 'كريمة وفطر ودجاج', priceIqd: 11_000 },
          { name: 'باستا بولونيز', priceIqd: 12_000 },
        ],
      },
      {
        name: 'الحلويات',
        items: [{ name: 'تيراميسو', priceIqd: 5000 }],
      },
    ],
  },

  {
    partnerCode: 'DEMO-1004',
    name: 'شاورما الأصيل',
    description: 'شاورما عربي على الفحم، وصاج ساخن طول اليوم.',
    cuisines: ['shawarma', 'levantine', 'sandwiches'],
    minimumOrderIqd: 5000,
    deliveryFeeIqd: 1500,
    prepMinutes: 15,
    // No ratings yet — the card must show «جديد», not a fake 0.0.
    rating: null,
    ratingCount: 0,
    address: 'شارع فلسطين، مقابل جامع الرحمن',
    district: 'فلسطين',
    phone: '+9647701110004',
    ownerUsername: 'demo.shawarma',
    ownerName: 'سامر الحلبي',
    // 09:00 through 02:00 the next morning. The overnight wrap is a real case
    // in Baghdad and this is the row that proves the evaluator handles it.
    hours: daily('09:00', '02:00'),
    modifierGroups: [
      {
        name: 'نوع الخبز',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'صمون', priceIqd: 0 },
          { name: 'خبز عربي', priceIqd: 0 },
          { name: 'صاج', priceIqd: 500 },
        ],
      },
    ],
    menu: [
      {
        name: 'الشاورما',
        items: [
          {
            name: 'شاورما دجاج',
            description: 'مع ثوم ومخلل وبطاطا',
            priceIqd: 4000,
            popular: true,
            options: ['نوع الخبز'],
          },
          {
            name: 'شاورما لحم',
            description: 'مع طحينة وبصل وسماق',
            priceIqd: 5500,
            popular: true,
            options: ['نوع الخبز'],
          },
          { name: 'صحن شاورما دجاج', priceIqd: 9000 },
          { name: 'صحن شاورما لحم', priceIqd: 12_000 },
        ],
      },
      {
        name: 'المقبلات',
        items: [
          { name: 'بطاطا مقلية', priceIqd: 2000 },
          { name: 'سلطة خضراء', priceIqd: 2000 },
          { name: 'كبة مقلية (٣ حبات)', priceIqd: 4000 },
        ],
      },
    ],
  },

  {
    partnerCode: 'DEMO-1005',
    name: 'حلويات أبو عفيف',
    description: 'بقلاوة وكنافة تُخبز كل صباح.',
    cuisines: ['desserts', 'bakery', 'coffee'],
    minimumOrderIqd: 8000,
    deliveryFeeIqd: 2500,
    prepMinutes: 25,
    rating: 4.9,
    ratingCount: 47,
    address: 'شارع الرشيد، قرب المتحف',
    district: 'الرشيد',
    phone: '+9647701110005',
    ownerUsername: 'demo.sweets',
    ownerName: 'عفيف البغدادي',
    // Closes early. Whether this shows as open depends on the hour the app is
    // opened, which is the point: one restaurant in the set is usually shut.
    hours: {
      0: ['08:00', '16:00'],
      1: ['08:00', '16:00'],
      2: ['08:00', '16:00'],
      3: ['08:00', '16:00'],
      4: ['08:00', '16:00'],
      5: null,
      6: ['08:00', '16:00'],
    },
    menu: [
      {
        name: 'الحلويات الشرقية',
        items: [
          { name: 'بقلاوة بالفستق (كيلو)', priceIqd: 25_000, popular: true },
          { name: 'كنافة نابلسية (كيلو)', priceIqd: 22_000, popular: true },
          { name: 'زلابية (نصف كيلو)', priceIqd: 8000 },
          { name: 'برمة بالجوز (كيلو)', priceIqd: 24_000 },
        ],
      },
      {
        name: 'المخبوزات',
        items: [
          { name: 'كليجة تمر (علبة)', priceIqd: 9000 },
          { name: 'معمول بالجوز (علبة)', priceIqd: 12_000 },
        ],
      },
    ],
  },

  {
    partnerCode: 'DEMO-1006',
    name: 'مشاوي الخيمة',
    description: 'كباب وتكة على الفحم، وقوزي يوم الجمعة.',
    cuisines: ['grills', 'kebab', 'iraqi', 'meat'],
    // A high minimum: the cart must refuse checkout and say how much is missing.
    minimumOrderIqd: 25_000,
    deliveryFeeIqd: 3500,
    prepMinutes: 40,
    rating: 4.2,
    ratingCount: 210,
    address: 'الدورة، شارع المعامل',
    district: 'الدورة',
    phone: '+9647701110006',
    ownerUsername: 'demo.grill',
    ownerName: 'كريم الدليمي',
    hours: daily('13:00', '00:00'),
    modifierGroups: [
      {
        name: 'مستوى التتبيل',
        required: false,
        minSelect: 0,
        maxSelect: 1,
        options: [
          { name: 'عادي', priceIqd: 0 },
          { name: 'حار', priceIqd: 0 },
        ],
      },
    ],
    menu: [
      {
        name: 'المشاوي',
        items: [
          {
            name: 'كباب عراقي (١٠ أسياخ)',
            description: 'لحم غنم مفروم يدوياً',
            priceIqd: 28_000,
            popular: true,
            options: ['مستوى التتبيل'],
          },
          { name: 'تكة دجاج', priceIqd: 16_000, options: ['مستوى التتبيل'] },
          { name: 'تكة غنم', priceIqd: 24_000, options: ['مستوى التتبيل'] },
          {
            name: 'قوزي كامل',
            description: 'يتطلب طلباً مسبقاً',
            priceIqd: 95_000,
            unavailable: true,
          },
        ],
      },
      {
        name: 'المقبلات',
        items: [
          { name: 'تشريب باقلاء', priceIqd: 7000 },
          { name: 'سلطة عراقية', priceIqd: 3000 },
          { name: 'مخلل مشكل', priceIqd: 2000 },
        ],
      },
    ],
  },
];

export interface DemoSeedResult {
  readonly restaurantsInserted: number;
  readonly restaurantsUpdated: number;
  readonly branches: number;
  readonly categories: number;
  readonly items: number;
  readonly modifierGroups: number;
  readonly owners: number;
  readonly images: number;
  readonly banners: number;
  readonly cityNameAr: string;
}

/**
 * Create (or refresh) the demo marketplace in one city.
 *
 * The city must already exist and be enabled; `seed/run.ts` activates Baghdad
 * immediately before calling this.
 */
export async function seedDemoMarketplace(db: Database, cityCode: string): Promise<DemoSeedResult> {
  const [city] = await db
    .select({ id: cities.id, governorateId: cities.governorateId, nameAr: cities.nameAr })
    .from(cities)
    .where(eq(cities.code, cityCode))
    .limit(1);

  if (!city) throw new Error(`Unknown city code: ${cityCode}`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const result = {
    restaurantsInserted: 0,
    restaurantsUpdated: 0,
    branches: 0,
    categories: 0,
    items: 0,
    modifierGroups: 0,
    owners: 0,
    images: 0,
    banners: 0,
  };

  // The market runs through the same loop as the restaurants, because it is
  // the same shape — that is the whole argument for the discriminator.
  for (const demo of [...DEMO_RESTAURANTS, ...DEMO_MARKETS]) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: restaurants.id, providerId: restaurants.providerId })
        .from(restaurants)
        .where(eq(restaurants.partnerCode, demo.partnerCode))
        .limit(1);

      const now = new Date();
      let restaurantId: string;
      const hueShift = DEMO_HUE_SHIFTS[demo.partnerCode] ?? 0;

      if (existing) {
        restaurantId = existing.id;
        await tx
          .update(restaurants)
          .set({
            displayName: demo.name,
            descriptionAr: demo.description,
            cuisineTags: [...demo.cuisines],
            coverAssetId: await upsertImageAsset(
              tx,
              restaurantCover(demo.partnerCode, hueShift),
              existing.id,
            ),
            logoAssetId: await upsertImageAsset(
              tx,
              restaurantLogo(demo.partnerCode, hueShift),
              existing.id,
            ),
            minimumOrderIqd: demo.minimumOrderIqd,
            ratingAverage: demo.rating,
            ratingCount: demo.ratingCount,
            // Also on update: a database seeded before this column existed has
            // the market filed as a restaurant, and a re-seed should fix that
            // rather than leave it in the wrong tab.
            merchantType: demo.merchantType ?? 'RESTAURANT',
            onboardingStatus: 'APPROVED',
            operationalStatus: 'ACTIVE',
            approvedAt: now,
            suspendedAt: null,
            suspendedReason: null,
            deletedAt: null,
            updatedAt: now,
          })
          .where(eq(restaurants.id, restaurantId));
        result.restaurantsUpdated += 1;
        result.images += 2;
      } else {
        const providerId = uuidv7();
        await tx
          .insert(providers)
          .values({ id: providerId, providerType: 'RESTAURANT', status: 'ACTIVE' });

        restaurantId = uuidv7();
        await tx.insert(restaurants).values({
          id: restaurantId,
          providerId,
          displayName: demo.name,
          legalName: demo.name,
          partnerCode: demo.partnerCode,
          descriptionAr: demo.description,
          cuisineTags: [...demo.cuisines],
          merchantType: demo.merchantType ?? 'RESTAURANT',
          onboardingStatus: 'APPROVED',
          operationalStatus: 'ACTIVE',
          minimumOrderIqd: demo.minimumOrderIqd,
          ratingAverage: demo.rating,
          ratingCount: demo.ratingCount,
          approvedAt: now,
        });
        result.restaurantsInserted += 1;

        // After the insert, because the asset row references the restaurant.
        await tx
          .update(restaurants)
          .set({
            coverAssetId: await upsertImageAsset(
              tx,
              restaurantCover(demo.partnerCode, hueShift),
              restaurantId,
            ),
            logoAssetId: await upsertImageAsset(
              tx,
              restaurantLogo(demo.partnerCode, hueShift),
              restaurantId,
            ),
          })
          .where(eq(restaurants.id, restaurantId));
        result.images += 2;
      }

      // ── Branch ──────────────────────────────────────────────────────────
      const [existingBranch] = await tx
        .select({ id: restaurantBranches.id })
        .from(restaurantBranches)
        .where(eq(restaurantBranches.restaurantId, restaurantId))
        .limit(1);

      const branchValues = {
        name: 'الفرع الرئيسي',
        governorateId: city.governorateId,
        cityId: city.id,
        addressText: demo.address,
        districtText: demo.district,
        phone: demo.phone,
        isActive: true,
        acceptsOrders: true,
        busyMode: 'NORMAL' as const,
        busyModeExpiresAt: null,
        basePreparationMinutes: demo.prepMinutes,
        deliveryFeeIqd: demo.deliveryFeeIqd,
        deletedAt: null,
        updatedAt: now,
      };

      let branchId: string;
      if (existingBranch) {
        branchId = existingBranch.id;
        await tx
          .update(restaurantBranches)
          .set(branchValues)
          .where(eq(restaurantBranches.id, branchId));
      } else {
        branchId = uuidv7();
        await tx.insert(restaurantBranches).values({ id: branchId, restaurantId, ...branchValues });
      }
      result.branches += 1;

      // ── Working hours ───────────────────────────────────────────────────
      // Replaced wholesale rather than merged: the weekly schedule is one
      // object, and a partial update leaves a day from a previous run behind.
      await tx.delete(branchWorkingHours).where(eq(branchWorkingHours.branchId, branchId));
      for (const [day, range] of Object.entries(demo.hours)) {
        await tx.insert(branchWorkingHours).values({
          id: uuidv7(),
          branchId,
          dayOfWeek: Number(day),
          opensAtMinute: range ? at(range[0]) : 0,
          closesAtMinute: range ? at(range[1]) : 0,
          isClosed: range === null,
        });
      }

      /*
       * The commission this restaurant pays, without which it cannot be
       * ordered from at all.
       *
       * `resolveCommissionFee` refuses to guess: a restaurant with no active
       * config raises COMMISSION_CONFIG_MISSING and the quote fails. That is
       * right — money is not inferred — but it meant the whole demo
       * marketplace was browsable and unorderable, and nothing caught it until
       * an order was actually attempted.
       *
       * Dated a day in the past so it is already active whatever the clock
       * says when the seed runs.
       */
      const [activeCommission] = await tx
        .select({ id: restaurantCommissionConfigs.id })
        .from(restaurantCommissionConfigs)
        .where(eq(restaurantCommissionConfigs.restaurantId, restaurantId))
        .limit(1);

      if (!activeCommission) {
        await tx.insert(restaurantCommissionConfigs).values({
          id: uuidv7(),
          restaurantId,
          commissionFlatIqd: DEMO_COMMISSION_FLAT_IQD,
          settlementPolicy: 'HALF_MONTH',
          paymentTermDays: 7,
          effectiveFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          note: 'Demo marketplace default',
        });
      }

      // ── Owner account for the restaurant portal ─────────────────────────
      const [existingOwner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, demo.ownerUsername))
        .limit(1);

      let ownerId: string;
      if (existingOwner) {
        ownerId = existingOwner.id;
        await tx
          .update(users)
          .set({ fullName: demo.ownerName, passwordHash, status: 'ACTIVE', updatedAt: now })
          .where(eq(users.id, ownerId));
      } else {
        ownerId = uuidv7();
        await tx.insert(users).values({
          id: ownerId,
          username: demo.ownerUsername,
          fullName: demo.ownerName,
          passwordHash,
          // Demo accounts skip the forced password change so a tester is not
          // stopped by a flow that is not what they came to look at.
          mustChangePassword: false,
          status: 'ACTIVE',
        });
      }

      const [membership] = await tx
        .select({ id: restaurantMembers.id })
        .from(restaurantMembers)
        .where(
          and(
            eq(restaurantMembers.restaurantId, restaurantId),
            eq(restaurantMembers.userId, ownerId),
          ),
        )
        .limit(1);

      if (!membership) {
        await tx.insert(restaurantMembers).values({
          id: uuidv7(),
          restaurantId,
          userId: ownerId,
          role: 'OWNER',
          isActive: true,
        });
      }
      result.owners += 1;

      // ── Modifier groups ─────────────────────────────────────────────────
      const groupIdByName = new Map<string, string>();

      for (const [index, group] of (demo.modifierGroups ?? []).entries()) {
        const [existingGroup] = await tx
          .select({ id: modifierGroups.id })
          .from(modifierGroups)
          .where(
            and(
              eq(modifierGroups.restaurantId, restaurantId),
              eq(modifierGroups.nameAr, group.name),
            ),
          )
          .limit(1);

        const groupId = existingGroup?.id ?? uuidv7();
        if (existingGroup) {
          await tx
            .update(modifierGroups)
            .set({
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              isRequired: group.required,
              sortOrder: index,
              isActive: true,
            })
            .where(eq(modifierGroups.id, groupId));
        } else {
          await tx.insert(modifierGroups).values({
            id: groupId,
            restaurantId,
            nameAr: group.name,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            isRequired: group.required,
            sortOrder: index,
            isActive: true,
          });
        }

        await tx.delete(modifiers).where(eq(modifiers.groupId, groupId));
        for (const [optionIndex, option] of group.options.entries()) {
          await tx.insert(modifiers).values({
            id: uuidv7(),
            groupId,
            nameAr: option.name,
            priceIqd: option.priceIqd,
            isAvailable: true,
            sortOrder: optionIndex,
          });
        }

        groupIdByName.set(group.name, groupId);
        result.modifierGroups += 1;
      }

      // ── Menu ────────────────────────────────────────────────────────────
      for (const [categoryIndex, category] of demo.menu.entries()) {
        const [existingCategory] = await tx
          .select({ id: menuCategories.id })
          .from(menuCategories)
          .where(
            and(
              eq(menuCategories.restaurantId, restaurantId),
              eq(menuCategories.nameAr, category.name),
              isNull(menuCategories.deletedAt),
            ),
          )
          .limit(1);

        const categoryId = existingCategory?.id ?? uuidv7();
        if (existingCategory) {
          await tx
            .update(menuCategories)
            .set({
              descriptionAr: category.description ?? null,
              sortOrder: categoryIndex,
              isActive: true,
              updatedAt: now,
            })
            .where(eq(menuCategories.id, categoryId));
        } else {
          await tx.insert(menuCategories).values({
            id: categoryId,
            restaurantId,
            nameAr: category.name,
            descriptionAr: category.description ?? null,
            sortOrder: categoryIndex,
            isActive: true,
          });
        }
        result.categories += 1;

        for (const [itemIndex, item] of category.items.entries()) {
          const [existingItem] = await tx
            .select({ id: menuItems.id })
            .from(menuItems)
            .where(
              and(
                eq(menuItems.restaurantId, restaurantId),
                eq(menuItems.nameAr, item.name),
                isNull(menuItems.deletedAt),
              ),
            )
            .limit(1);

          const itemValues = {
            categoryId,
            descriptionAr: item.description ?? null,
            basePriceIqd: item.priceIqd,
            isActive: true,
            isAvailable: item.unavailable !== true,
            unavailableByInventory: false,
            sortOrder: itemIndex,
            isPopular: item.popular === true,
            updatedAt: now,
          };

          const itemId = existingItem?.id ?? uuidv7();
          if (existingItem) {
            await tx.update(menuItems).set(itemValues).where(eq(menuItems.id, itemId));
          } else {
            await tx
              .insert(menuItems)
              .values({ id: itemId, restaurantId, nameAr: item.name, ...itemValues });
          }
          result.items += 1;

          // Attach option groups. Replaced wholesale for the same reason the
          // hours are: the set is the unit, not each row.
          await tx.delete(itemModifierGroups).where(eq(itemModifierGroups.itemId, itemId));
          for (const [linkIndex, groupName] of (item.options ?? []).entries()) {
            const groupId = groupIdByName.get(groupName);
            if (!groupId) {
              throw new Error(
                `${demo.name}: item "${item.name}" references unknown option group "${groupName}"`,
              );
            }
            await tx.insert(itemModifierGroups).values({
              id: uuidv7(),
              itemId,
              groupId,
              sortOrder: linkIndex,
            });
          }
        }
      }

      /*
       * A catalog change bumps the menu version, or a cart held on a phone
       * cannot tell that its prices are stale (plan §116). Read then write
       * rather than an in-place increment: this whole restaurant is inside one
       * transaction, so nothing else can be writing the row.
       */
      const [current] = await tx
        .select({ menuVersion: restaurants.menuVersion })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      await tx
        .update(restaurants)
        .set({ menuVersion: (current?.menuVersion ?? 1) + 1, updatedAt: now })
        .where(eq(restaurants.id, restaurantId));
    });
  }

  /*
   * The banners across the top of the home screen.
   *
   * Seeded last because they are the one part of the storefront that is pure
   * merchandising: they reference categories that must already exist, and an
   * operator replaces them from Admin → شكل التطبيق without touching anything
   * else. Keyed on the storage key of their art, so re-seeding rewrites rather
   * than duplicates.
   */
  for (const [index, banner] of DEMO_BANNERS.entries()) {
    const imageAssetId = await upsertImageAsset(
      db,
      promoBanner(banner.key, banner.from, banner.to),
      null,
    );
    result.images += 1;

    const [existing] = await db
      .select({ id: appBanners.id })
      .from(appBanners)
      .where(eq(appBanners.titleAr, banner.titleAr))
      .limit(1);

    const values = {
      titleAr: banner.titleAr,
      subtitleAr: banner.subtitleAr,
      imageAssetId,
      linkType: banner.linkType,
      linkValue: banner.linkValue,
      merchantType: banner.merchantType ?? ('RESTAURANT' as const),
      sortOrder: index,
      isActive: true,
      startsAt: null,
      endsAt: null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(appBanners).set(values).where(eq(appBanners.id, existing.id));
    } else {
      await db.insert(appBanners).values({ id: uuidv7(), ...values });
    }
    result.banners += 1;
  }

  return { ...result, cityNameAr: city.nameAr };
}

/** The credentials the seeded owners sign into the restaurant portal with. */
export const DEMO_OWNER_CREDENTIALS = DEMO_RESTAURANTS.map((r) => ({
  restaurant: r.name,
  username: r.ownerUsername,
  password: DEMO_PASSWORD,
}));
