import { describe, expect, it } from 'vitest';
import { catalogNoun, isShopSupported, SUPPORTED_MERCHANT_TYPES } from './owner-vertical';

/**
 * The vertical gate.
 *
 * This is the one rule Owner Mode rests on, and it is the one that cannot be
 * exercised end to end today: the pilot database has no market merchant, and
 * putting a fake shop in front of real customers to make a test pass would be a
 * worse trade than testing the rule directly.
 *
 * Which is why the rule lives in a module with no React in it. What is pinned
 * here is not an implementation, it is three promises:
 *
 *   a market and a cosmetics shop are served, a restaurant is not, and the
 *   last is a decision;
 *   the words follow the shop rather than the screen;
 *   adding a vertical is adding a value, not writing a feature again.
 */

const market = { merchant_type: 'MARKET' } as const;
const restaurant = { merchant_type: 'RESTAURANT' } as const;
const cosmetics = { merchant_type: 'COSMETICS' } as const;

describe('which shops Owner Mode serves', () => {
  it('serves a market', () => {
    expect(isShopSupported(market)).toBe(true);
  });

  /*
   * A kitchen needs the orders board, the open/closed switch and sold-out
   * toggles as much as a grocer does. The options a dish carries are edited on
   * the web portal; the phone never touches them.
   */
  it('serves a restaurant', () => {
    expect(isShopSupported(restaurant)).toBe(true);
  });

  /*
   * The promise made in docs/mobile/owner-mode.md — "adding Cosmetics is
   * adding an enum value rather than writing the feature again" — kept: the
   * cosmetics section is served by the same screens as the market, and the
   * only thing that changed to allow it is the list.
   */
  it('serves a cosmetics shop, through the list alone', () => {
    expect(SUPPORTED_MERCHANT_TYPES).toContain('COSMETICS');
    expect(isShopSupported(cosmetics)).toBe(true);
  });
});

describe('what a shop calls its stock', () => {
  it('says المنتجات to a grocer', () => {
    expect(catalogNoun(market)).toBe('المنتجات');
  });

  it('says المنتجات to a cosmetics shop', () => {
    expect(catalogNoun(cosmetics)).toBe('المنتجات');
  });

  it('says القائمة to a cook', () => {
    expect(catalogNoun(restaurant)).toBe('القائمة');
  });

  /*
   * Null is the state every owner screen renders in for a moment while the shop
   * list is still in flight, and a heading that reads «undefined» for that frame
   * is the kind of thing only a real device shows you.
   */
  it('has a word before the shop is known', () => {
    expect(catalogNoun(null)).toBe('المنتجات');
  });
});
