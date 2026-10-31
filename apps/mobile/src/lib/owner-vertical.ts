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
export const SUPPORTED_MERCHANT_TYPES: readonly OwnerShop['merchant_type'][] = [
  'RESTAURANT',
  'MARKET',
  'COSMETICS',
];

/**
 * Whether Owner Mode has anything to offer this shop.
 *
 * Every kind, restaurants included. A restaurant was once kept out because a
 * dish carries modifier groups — size, bread, extras — that the phone's
 * three-field form cannot edit. But the part of Owner Mode a kitchen needs
 * most is not the form: it is the order arriving with a sound, accepting it,
 * and moving it to ready, plus opening, closing and marking a dish sold out.
 * Those are the same for a grill as for a grocer. So a restaurant signs in
 * like any shop; the products screen edits names, prices, photos and
 * availability — which never touches a dish's options — and says that the
 * options themselves are edited on the web portal.
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
