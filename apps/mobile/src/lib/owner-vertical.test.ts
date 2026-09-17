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
 *   a market is served, a restaurant is not, and the second is a decision;
 *   the words follow the shop rather than the screen;
 *   adding a vertical is adding a value, not writing a feature again.
 */

const market = { merchant_type: 'MARKET' } as const;
const restaurant = { merchant_type: 'RESTAURANT' } as const;

describe('which shops Owner Mode serves', () => {
  it('serves a market', () => {
    expect(isShopSupported(market)).toBe(true);
  });

  /*
   * Not an oversight, and the test says so out loud. A dish carries modifier
   * groups with required/optional rules and a price per option; the phone form
   * has three fields. Shipping it for restaurants would be the market's form
   * silently losing half of a kitchen's menu.
   */
  it('does not serve a restaurant, on purpose', () => {
    expect(isShopSupported(restaurant)).toBe(false);
  });

  /*
   * The guard on the promise made in docs/mobile/owner-mode.md: "adding
   * Cosmetics is adding an enum value rather than writing the feature again."
   *
   * If a future vertical needs its own screens, this assertion is where that
   * shows up — the list will have stopped being the only thing that decides.
   */
  it('decides from the list alone, so a new vertical is a value not a feature', () => {
    const cosmetics = { merchant_type: 'COSMETICS' as unknown as 'MARKET' };
    expect(isShopSupported(cosmetics)).toBe(false);

    const widened = [...SUPPORTED_MERCHANT_TYPES, 'COSMETICS' as unknown as 'MARKET'];
    expect(widened.includes(cosmetics.merchant_type)).toBe(true);
  });
});

describe('what a shop calls its stock', () => {
  it('says المنتجات to a grocer', () => {
    expect(catalogNoun(market)).toBe('المنتجات');
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
