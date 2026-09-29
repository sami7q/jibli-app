import { palette } from '@jibli/design-tokens';
import type { MerchantType } from '@jibli/contracts';
import type { IconName } from '../ui/icon';

/**
 * Everything the customer app says and draws differently per section.
 *
 * Food, the market and cosmetics are one app: the same cards, the same cart,
 * the same checkout. What separates them is a name, a glyph, a colour ramp and
 * a handful of nouns — and when those were ternaries on `=== 'MARKET'` spread
 * over the home screen, the chooser and Owner Mode, adding a third section
 * meant finding every one of them. Here it means adding one entry, and the
 * `Record<MerchantType, …>` type refuses to compile until that entry exists.
 *
 * No React and no React Native, so the table is tested directly.
 */

type Ramp = Readonly<Record<keyof typeof palette.orange, string>>;

export interface Section {
  readonly type: MerchantType;
  /** The section's name, as the chooser and the home header show it. */
  readonly label: string;
  /** The word after «جيبلي» on the chooser card — «طعام», «ماركت», «كوزمتك». */
  readonly shortName: string;
  /** Three things the section sells, for the chooser card. */
  readonly tags: string;
  /** The typical delivery time the chooser card promises. */
  readonly eta: string;
  /** Marked «جديد» on the chooser while the section is new. */
  readonly isNew: boolean;
  readonly caption: string;
  readonly examples: string;
  /** The glyph beside the section's name, and in place of a missing picture. */
  readonly icon: IconName;
  /** Owner Mode's glyph for a shop of this kind. */
  readonly shopIcon: IconName;
  /** One merchant — «مطعم», «ماركت», «متجر تجميل». */
  readonly shopNoun: string;
  /** Many, indefinite and definite — «مطاعم» / «المطاعم». */
  readonly shopsNoun: string;
  readonly shopsNounDefinite: string;
  readonly nearbyTitle: string;
  readonly areaCaption: (cityNameAr: string) => string;
  readonly pickAreaCaption: string;
  readonly searchPlaceholder: string;
  readonly searchLabel: string;
  /** Beside «التصنيفات» on the home screen. */
  readonly categoriesCaption: string;
  /** What an item with no photograph is called, for screen readers. */
  readonly itemImageLabel: string;
  /** The ramp the whole app is drawn in while this section is open. */
  readonly ramp: Ramp;
  /** Deep to bright, for the chooser panel. */
  readonly gradient: readonly [string, string];
  /** Light to deep, for the home header. */
  readonly header: readonly [string, string, string];
}

export const SECTIONS: Readonly<Record<MerchantType, Section>> = {
  RESTAURANT: {
    type: 'RESTAURANT',
    label: 'جيبلي أكل',
    shortName: 'طعام',
    tags: 'مطاعم · وجبات · حلويات',
    eta: '20 دقيقة',
    isNew: false,
    caption: 'مطاعم ووجبات تصلك ساخنة',
    examples: 'مندي · برجر · بيتزا · شاورما · حلويات',
    icon: 'silverware-fork-knife',
    shopIcon: 'silverware-fork-knife',
    shopNoun: 'مطعم',
    shopsNoun: 'مطاعم',
    shopsNounDefinite: 'المطاعم',
    nearbyTitle: 'المطاعم القريبة منك',
    areaCaption: (city) => `أفضل المطاعم في ${city}`,
    pickAreaCaption: 'اختر منطقتك لعرض المطاعم',
    searchPlaceholder: 'ابحث عن مطعم أو وجبة…',
    searchLabel: 'البحث عن مطعم أو وجبة',
    categoriesCaption: 'اختر وجبتك',
    itemImageLabel: 'صورة الطبق',
    ramp: palette.orange,
    gradient: [palette.orange[400], palette.orange[700]],
    // The food header predates the ramp and was matched to the logo artwork.
    header: ['#ff8a14', '#fd6702', '#f05002'],
  },
  MARKET: {
    type: 'MARKET',
    label: 'جيبلي ماركت',
    shortName: 'ماركت',
    tags: 'خضار · ألبان · منظفات',
    eta: '30 دقيقة',
    isNew: false,
    caption: 'بقالة ومواد غذائية خلال دقائق',
    examples: 'خضار · ألبان · لحوم · مخبوزات · منظفات',
    icon: 'basket-outline',
    shopIcon: 'storefront',
    shopNoun: 'ماركت',
    shopsNoun: 'ماركتات',
    shopsNounDefinite: 'الماركتات',
    nearbyTitle: 'الماركتات القريبة منك',
    areaCaption: (city) => `ماركتات توصّل إلى ${city}`,
    pickAreaCaption: 'اختر منطقتك لعرض الماركتات',
    searchPlaceholder: 'ابحث عن منتج أو ماركت…',
    searchLabel: 'البحث عن منتج أو ماركت',
    categoriesCaption: 'تسوّق حسب القسم',
    itemImageLabel: 'صورة المنتج',
    ramp: palette.green,
    gradient: [palette.green[400], palette.green[800]],
    header: [palette.green[400], palette.green[600], palette.green[800]],
  },
  COSMETICS: {
    type: 'COSMETICS',
    label: 'جيبلي كوزمتك',
    shortName: 'كوزمتك',
    tags: 'مكياج · عطور · عناية',
    eta: '45 دقيقة',
    isNew: true,
    caption: 'مستحضرات تجميل وعناية تصلك لباب البيت',
    examples: 'مكياج · عناية بالبشرة · شعر · عطور · أظافر',
    icon: 'lipstick',
    shopIcon: 'lipstick',
    shopNoun: 'متجر تجميل',
    shopsNoun: 'متاجر تجميل',
    shopsNounDefinite: 'متاجر التجميل',
    nearbyTitle: 'متاجر التجميل القريبة منك',
    areaCaption: (city) => `متاجر تجميل توصّل إلى ${city}`,
    pickAreaCaption: 'اختر منطقتك لعرض متاجر التجميل',
    searchPlaceholder: 'ابحث عن منتج أو متجر تجميل…',
    searchLabel: 'البحث عن منتج أو متجر تجميل',
    categoriesCaption: 'تسوّق حسب القسم',
    itemImageLabel: 'صورة المنتج',
    ramp: palette.rose,
    gradient: [palette.rose[400], palette.rose[800]],
    header: [palette.rose[400], palette.rose[600], palette.rose[800]],
  },
};

/** The sections in the order the chooser offers them. */
export const SECTION_ORDER: readonly MerchantType[] = ['RESTAURANT', 'MARKET', 'COSMETICS'];

export function sectionOf(type: MerchantType | null | undefined): Section {
  return SECTIONS[type ?? 'RESTAURANT'] ?? SECTIONS.RESTAURANT;
}
