import type { OwnerShop } from './api';

/**
 * Which halves of Jibli Owner Mode serves, and what it calls their stock.
 *
 * The whole vertical decision, in one file with no React in it — so it can be
 * tested directly, and so "expressed once" is a fact rather than an intention.
 * Adding Cosmetics is adding a value to `SUPPORTED` and a word to `NOUN`. If it
 * ever takes more than that, this module failed at its only job.
 */

/** What Owner Mode is built for, by `restaurants.merchant_type`. */
export const SUPPORTED_MERCHANT_TYPES: readonly OwnerShop['merchant_type'][] = ['MARKET'];

/**
 * Whether Owner Mode has anything to offer this shop.
 *
 * A restaurant is excluded deliberately rather than by omission. A dish carries
 * modifier groups — size, bread, extras — with required/optional rules and a
 * price per option, and editing that on a phone is a worse tool than the web
 * portal, not a faster one. A grocery product is a name, a price, a photo and a
 * category, which is the shape a phone is good at.
 */
export function isShopSupported(shop: Pick<OwnerShop, 'merchant_type'>): boolean {
  return SUPPORTED_MERCHANT_TYPES.includes(shop.merchant_type);
}

/**
 * What a shop's stock is called.
 *
 * `/restaurant-portal/me` has returned `merchant_type` since before there was a
 * phone client, with a comment saying it exists "so the portal can say
 * «المنتجات» to a grocer and «القائمة» to a cook". This is that sentence.
 */
export function catalogNoun(shop: Pick<OwnerShop, 'merchant_type'> | null): string {
  return shop?.merchant_type === 'RESTAURANT' ? 'القائمة' : 'المنتجات';
}
