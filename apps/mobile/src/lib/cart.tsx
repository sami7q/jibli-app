import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { dropSecure, putSecure, readSecure } from './secure-session';
import { CART_KEY, reduceCart, type Cart, type CartLine } from './cart-state';

export { reduceCart, type Cart, type CartLine, type CartAction } from './cart-state';

/**
 * The cart, as the app holds it.
 *
 * The rules live in `cart-state.ts`; this adds the two things that need React
 * and a device: it survives being backgrounded, and every screen reads the
 * same cart.
 */

interface CartApi {
  readonly cart: Cart | null;
  readonly itemCount: number;
  readonly subtotalIqd: number;
  /**
   * Add an item. Returns `'replaced'` when it emptied another restaurant's
   * cart, so the screen can say so rather than leaving the customer to notice.
   */
  readonly add: (cart: Omit<Cart, 'lines'>, line: Omit<CartLine, 'key'>) => 'added' | 'replaced';
  readonly setQuantity: (key: string, quantity: number) => void;
  readonly remove: (key: string) => void;
  readonly clear: () => void;
}

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, dispatch] = useReducer(reduceCart, null);

  useEffect(() => {
    let alive = true;
    void readSecure(CART_KEY)
      .then((stored) => {
        if (!alive || !stored) return;
        dispatch({ type: 'restore', cart: JSON.parse(stored) as Cart });
      })
      .catch(() => {
        /* A cart we cannot read is an empty cart. */
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * Persisted on every change rather than on leaving the screen: a food app is
   * backgrounded constantly — to answer a message, to check an address — and a
   * cart that empties itself while the customer is away is the fastest way to
   * lose the order.
   */
  useEffect(() => {
    const write = cart ? putSecure(CART_KEY, JSON.stringify(cart)) : dropSecure(CART_KEY);
    void write.catch(() => {
      /* Storage failure must not take the session with it. */
    });
  }, [cart]);

  const api = useMemo<CartApi>(() => {
    const lines = cart?.lines ?? [];
    return {
      cart,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotalIqd: lines.reduce((sum, line) => sum + line.unitPriceIqd * line.quantity, 0),
      add: (next, line) => {
        const replaced = Boolean(cart) && cart?.restaurantId !== next.restaurantId;
        dispatch({ type: 'add', cart: next, line });
        return replaced ? 'replaced' : 'added';
      },
      setQuantity: (key, quantity) => dispatch({ type: 'setQuantity', key, quantity }),
      remove: (key) => dispatch({ type: 'remove', key }),
      clear: () => dispatch({ type: 'clear' }),
    };
  }, [cart]);

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used inside <CartProvider>');
  }
  return context;
}

/** The lines in the shape `POST /checkout/quote` and `POST /orders` expect. */
export function useOrderLines(): { menu_item_id: string; quantity: number; notes?: string }[] {
  const { cart } = useCart();
  return useMemo(
    () =>
      (cart?.lines ?? []).map((line) => ({
        menu_item_id: line.menuItemId,
        quantity: line.quantity,
        ...(line.notes ? { notes: line.notes } : {}),
      })),
    [cart],
  );
}
