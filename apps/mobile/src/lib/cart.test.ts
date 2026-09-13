import { describe, expect, it } from 'vitest';
import { reduceCart, type Cart, type CartLine } from './cart-state';

/**
 * The cart's rules.
 *
 * Three of them decide whether an order can be placed at all, and all three
 * are invisible until they are wrong — a cart holding two restaurants quotes
 * against one of them and charges for the other; a cart that keeps a
 * restaurant pinned after its last item is removed sends an empty order to a
 * kitchen; a minus button that stops at one leaves people unable to undo a tap.
 */

const MANDI = {
  restaurantId: 'r-mandi',
  branchId: 'b-mandi',
  restaurantName: 'مندي حضرموت',
  deliveryFeeIqd: 2000,
  minimumOrderIqd: 10_000,
};

const KEBAB = {
  restaurantId: 'r-kebab',
  branchId: 'b-kebab',
  restaurantName: 'كباب أبو علي',
  deliveryFeeIqd: 1500,
  minimumOrderIqd: 8000,
};

function line(overrides: Partial<Omit<CartLine, 'key'>> = {}): Omit<CartLine, 'key'> {
  return {
    menuItemId: 'item-1',
    nameAr: 'مندي لحم',
    unitPriceIqd: 12_000,
    quantity: 1,
    imageAssetId: null,
    notes: null,
    ...overrides,
  };
}

function cartWith(...lines: Omit<CartLine, 'key'>[]): Cart {
  return lines.reduce<Cart | null>(
    (cart, next) => reduceCart(cart, { type: 'add', cart: MANDI, line: next }),
    null,
  ) as Cart;
}

describe('adding', () => {
  it('starts a cart at the restaurant the item came from', () => {
    const cart = reduceCart(null, { type: 'add', cart: MANDI, line: line() });

    expect(cart?.restaurantId).toBe('r-mandi');
    expect(cart?.branchId).toBe('b-mandi');
    // The fee and minimum ride along, so the cart screen can show a total
    // without re-fetching the restaurant.
    expect(cart?.deliveryFeeIqd).toBe(2000);
    expect(cart?.lines).toHaveLength(1);
  });

  it('merges the same item into one line rather than listing it twice', () => {
    const cart = cartWith(line({ quantity: 1 }), line({ quantity: 2 }));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(3);
  });

  it('keeps the same item as two lines when the options differ', () => {
    // Two kebabs, one without onion: the kitchen has to see two instructions,
    // so they cannot be merged into a quantity of two.
    const cart = cartWith(line({ notes: null }), line({ notes: 'بدون بصل' }));

    expect(cart.lines).toHaveLength(2);
    expect(cart.lines.map((entry) => entry.notes)).toEqual([null, 'بدون بصل']);
  });

  it('replaces the cart when the item is from another restaurant', () => {
    /*
     * The rule the whole file exists for. An order belongs to one kitchen: the
     * server quotes, prices and routes per restaurant, so a basket spanning two
     * has no meaning anywhere downstream — it would quote against one and
     * deliver from the other.
     */
    const mandi = cartWith(line());
    const after = reduceCart(mandi, { type: 'add', cart: KEBAB, line: line({ nameAr: 'كباب' }) });

    expect(after?.restaurantId).toBe('r-kebab');
    expect(after?.lines).toHaveLength(1);
    expect(after?.lines[0]?.nameAr).toBe('كباب');
    expect(after?.deliveryFeeIqd).toBe(1500);
  });
});

describe('changing quantity', () => {
  it('sets the quantity on the line it names and leaves the rest alone', () => {
    const cart = cartWith(line(), line({ menuItemId: 'item-2', nameAr: 'رز' }));
    const key = cart.lines[0]?.key as string;

    const after = reduceCart(cart, { type: 'setQuantity', key, quantity: 4 });

    expect(after?.lines[0]?.quantity).toBe(4);
    expect(after?.lines[1]?.quantity).toBe(1);
  });

  it('removes the line at zero rather than keeping a line of nothing', () => {
    const cart = cartWith(line(), line({ menuItemId: 'item-2' }));
    const key = cart.lines[0]?.key as string;

    const after = reduceCart(cart, { type: 'setQuantity', key, quantity: 0 });

    expect(after?.lines).toHaveLength(1);
    expect(after?.lines[0]?.menuItemId).toBe('item-2');
  });
});

describe('emptying', () => {
  it('an empty cart is no cart, so no restaurant stays pinned', () => {
    /*
     * Otherwise the next item added from a different restaurant would trigger
     * the "your cart was replaced" warning about a cart that held nothing.
     */
    const cart = cartWith(line());
    const after = reduceCart(cart, { type: 'remove', key: cart.lines[0]?.key as string });

    expect(after).toBeNull();
  });

  it('clear empties everything', () => {
    expect(reduceCart(cartWith(line()), { type: 'clear' })).toBeNull();
  });

  it('removing a line that is not there changes nothing', () => {
    const cart = cartWith(line());
    expect(reduceCart(cart, { type: 'remove', key: 'not-a-key' })).toEqual(cart);
  });
});
