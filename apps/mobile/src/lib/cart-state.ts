/**
 * The cart's state, with no React in it.
 *
 * Separated from the provider so the rules can be read — and tested — on their
 * own. Three of them decide whether an order can be placed at all: one
 * restaurant at a time, an empty cart is no cart, and quantity zero removes.
 *
 * Prices here are a *snapshot* for display. The authoritative total comes from
 * `POST /checkout/quote`, which runs the same pricing path as placement, so
 * what the customer is shown and what they are charged cannot drift apart
 * (plan §22). A line whose price moved is caught there, not here.
 */

export const CART_KEY = 'jibli.cart';

export interface CartLine {
  /** Stable per line, so two lines of the same item with different notes coexist. */
  readonly key: string;
  readonly menuItemId: string;
  readonly nameAr: string;
  readonly unitPriceIqd: number;
  readonly quantity: number;
  readonly imageAssetId: string | null;
  readonly notes: string | null;
}

export interface Cart {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly restaurantName: string;
  readonly deliveryFeeIqd: number;
  readonly minimumOrderIqd: number;
  readonly lines: readonly CartLine[];
}

export type CartAction =
  | { type: 'restore'; cart: Cart | null }
  | { type: 'add'; cart: Omit<Cart, 'lines'>; line: Omit<CartLine, 'key'> }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'remove'; key: string }
  | { type: 'clear' };

function lineKey(menuItemId: string, notes: string | null): string {
  return notes ? `${menuItemId}::${notes}` : menuItemId;
}

/**
 * Exported so the rules can be tested without mounting a provider: "one
 * restaurant at a time", "an empty cart is no cart", and "quantity zero
 * removes" are the three that decide whether an order can be placed at all.
 */
export function reduceCart(cart: Cart | null, action: CartAction): Cart | null {
  switch (action.type) {
    case 'restore':
      return action.cart;

    case 'add': {
      const key = lineKey(action.line.menuItemId, action.line.notes);
      // A different restaurant replaces the cart; the caller has already asked.
      const base: Cart =
        cart && cart.restaurantId === action.cart.restaurantId
          ? cart
          : { ...action.cart, lines: [] };

      const existing = base.lines.find((line) => line.key === key);
      const lines = existing
        ? base.lines.map((line) =>
            line.key === key
              ? { ...line, quantity: line.quantity + action.line.quantity }
              : line,
          )
        : [...base.lines, { ...action.line, key }];

      return { ...base, ...action.cart, lines };
    }

    case 'setQuantity': {
      if (!cart) return cart;
      if (action.quantity <= 0) return reduceCart(cart, { type: 'remove', key: action.key });
      return {
        ...cart,
        lines: cart.lines.map((line) =>
          line.key === action.key ? { ...line, quantity: action.quantity } : line,
        ),
      };
    }

    case 'remove': {
      if (!cart) return cart;
      const lines = cart.lines.filter((line) => line.key !== action.key);
      // An empty cart is no cart: it should not keep a restaurant pinned.
      return lines.length === 0 ? null : { ...cart, lines };
    }

    case 'clear':
      return null;
  }
}
