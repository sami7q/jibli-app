import { COSMETICS_AISLES, MARKET_AISLES, type Cuisine, type MerchantType } from '@jibli/contracts';
import { formatIqdArabic, iqd } from '@jibli/money';
import type { OwnerLiveOrder } from './api';
import { countAr, type CountedNoun } from './arabic-count';

/**
 * The words and rules Owner Mode's catalog and order alerts share.
 *
 * No React here, so the sentences a shop owner reads on a locked screen can be
 * pinned by a test rather than checked on a phone.
 */

/** «صنف واحد», «صنفان», «5 أصناف», «13 صنفاً» — units on an order. */
export const ITEMS: CountedNoun = { one: 'صنف واحد', two: 'صنفان', few: 'أصناف', many: 'صنفاً' };

/** «منتج واحد», «منتجان», «5 منتجات», «13 منتجاً» — what a category holds. */
export const PRODUCTS: CountedNoun = {
  one: 'منتج واحد',
  two: 'منتجان',
  few: 'منتجات',
  many: 'منتجاً',
};

/**
 * Two spellings of the same aisle are the same aisle.
 *
 * A grocer who typed «البان و اجبان» should not be offered «ألبان وأجبان» as
 * a new category. Hamza forms, taa marbuta and the final yaa are the usual
 * ways one name is written twice; diacritics and the spaces around «و» are
 * the rest. The definite article is left alone: «ألبان» begins with the same
 * two letters, and stripping them would turn it into «بان».
 */
export function normalizeCategoryName(name: string): string {
  return name
    .trim()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+و\s+/g, ' و')
    .replace(/\s+/g, ' ');
}

/**
 * The aisles a shop of this kind usually has, minus the ones it already made.
 *
 * The same vocabulary the storefront filters by (`categoriesFor`), so a
 * category made from a suggestion is spelled the way the customer app spells
 * it. A restaurant gets none: its menu is the web portal's job.
 */
export function suggestedCategories(
  kind: MerchantType,
  existing: readonly string[],
): readonly Cuisine[] {
  const source = kind === 'MARKET' ? MARKET_AISLES : kind === 'COSMETICS' ? COSMETICS_AISLES : [];
  const taken = new Set(existing.map(normalizeCategoryName));
  return source.filter((aisle) => !taken.has(normalizeCategoryName(aisle.labelAr)));
}

/**
 * A readable line from the address snapshot an order carries. The snapshot's
 * shape belongs to the API, so every field is optional here.
 */
export function describeAddress(address: Record<string, unknown>): string | null {
  const parts = [
    readText(address, 'cityNameAr'),
    readText(address, 'districtText'),
    readText(address, 'street'),
    readText(address, 'landmark'),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : null;
}

/** Where the order goes, in one word: the district, or the city without one. */
export function orderArea(address: Record<string, unknown>): string | null {
  return readText(address, 'districtText') ?? readText(address, 'cityNameAr');
}

function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface NewOrderSummary {
  /** «طلب جديد من أحمد» — the notification's title. */
  readonly title: string;
  /** What was ordered, the total and where to: the notification's body. */
  readonly body: string;
  /** The same facts as one banner line, without the item names. */
  readonly line: string;
}

/**
 * What a shop needs to know about a new order before opening it.
 *
 * Who, what, how much and where — the four things the owner would ask on the
 * phone. First name and district only, because a push body can appear on a
 * locked screen (plan §107).
 */
export function summarizeNewOrder(
  order: Pick<
    OwnerLiveOrder,
    'customer_name' | 'items' | 'customer_total_iqd' | 'delivery_address'
  >,
): NewOrderSummary {
  const who = firstName(order.customer_name) || 'زبون';
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const named = order.items
    .slice(0, 3)
    .map((item) => (item.quantity > 1 ? `${item.quantity}× ${item.name_ar}` : item.name_ar));
  const rest = order.items.length - named.length;
  const what = rest > 0 ? `${named.join('، ')} و${rest} أخرى` : named.join('، ');
  const total = formatIqdArabic(iqd(order.customer_total_iqd));
  const area = orderArea(order.delivery_address);

  return {
    title: `طلب جديد من ${who}`,
    body: [what || countAr(units, ITEMS), total, area].filter(Boolean).join(' · '),
    line: [who, countAr(units, ITEMS), total, area].filter(Boolean).join(' · '),
  };
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}
