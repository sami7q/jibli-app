/**
 * Food categories.
 *
 * There was no canonical list. `restaurants.cuisine_tags` is a free-text array,
 * the Admin categories page derived its list from whatever tags happened to
 * exist, and nothing offered a choice at the point a restaurant is created — so
 * the taxonomy was whatever the first person typed, and "دجاج" and "الدجاج"
 * were two different categories the day someone typed both.
 *
 * A fixed vocabulary, shipped with the code rather than stored per row, because
 * it is a product decision and not tenant data: the customer app will filter
 * discovery by exactly these keys, the restaurant portal will show the same
 * labels, and a key that changes meaning breaks both at once.
 *
 * The key is stored. The Arabic label and the emoji are presentation and may be
 * revised without touching a database.
 */

export interface Cuisine {
  /** Stored in `cuisine_tags`. Never shown. */
  readonly key: string;
  readonly labelAr: string;
  /** Used where the design shows a category beside its name. */
  readonly emoji: string;
}

/**
 * Ordered as an Iraqi customer would scan them: the everyday staples first,
 * then kitchens, then the things eaten alongside a meal rather than as one.
 */
export const CUISINES: readonly Cuisine[] = [
  { key: 'iraqi', labelAr: 'مأكولات عراقية', emoji: '🍛' },
  { key: 'grills', labelAr: 'مشاوي', emoji: '🍢' },
  { key: 'kebab', labelAr: 'كباب', emoji: '🥙' },
  { key: 'chicken', labelAr: 'دجاج', emoji: '🍗' },
  { key: 'meat', labelAr: 'لحوم', emoji: '🥩' },
  { key: 'fast_food', labelAr: 'وجبات سريعة', emoji: '🍟' },
  { key: 'burger', labelAr: 'برغر', emoji: '🍔' },
  { key: 'pizza', labelAr: 'بيتزا', emoji: '🍕' },
  { key: 'shawarma', labelAr: 'شاورما', emoji: '🌯' },
  { key: 'sandwiches', labelAr: 'سندويشات', emoji: '🥪' },
  { key: 'breakfast', labelAr: 'فطور', emoji: '🍳' },
  { key: 'seafood', labelAr: 'أسماك ومأكولات بحرية', emoji: '🐟' },
  { key: 'levantine', labelAr: 'مأكولات شامية', emoji: '🫓' },
  { key: 'turkish', labelAr: 'مأكولات تركية', emoji: '🥘' },
  { key: 'asian', labelAr: 'مأكولات آسيوية', emoji: '🍜' },
  { key: 'italian', labelAr: 'مأكولات إيطالية', emoji: '🍝' },
  { key: 'healthy', labelAr: 'صحي ودايت', emoji: '🥗' },
  { key: 'desserts', labelAr: 'حلويات', emoji: '🍰' },
  { key: 'bakery', labelAr: 'مخبوزات ومعجنات', emoji: '🥐' },
  { key: 'ice_cream', labelAr: 'آيس كريم', emoji: '🍨' },
  { key: 'juices', labelAr: 'عصائر ومشروبات', emoji: '🥤' },
  { key: 'coffee', labelAr: 'قهوة ومقاهي', emoji: '☕' },
];

export const CUISINE_KEYS: readonly string[] = CUISINES.map((cuisine) => cuisine.key);

const BY_KEY = new Map(CUISINES.map((cuisine) => [cuisine.key, cuisine]));

export function cuisineByKey(key: string): Cuisine | undefined {
  return BY_KEY.get(key);
}

/**
 * The label to show for a stored tag.
 *
 * Falls back to the raw key rather than hiding it: restaurants created before
 * this list existed carry free text, and showing it is what tells an operator
 * there is something to tidy.
 */
export function cuisineLabelAr(key: string): string {
  return BY_KEY.get(key)?.labelAr ?? key;
}

export function isKnownCuisine(key: string): boolean {
  return BY_KEY.has(key);
}
