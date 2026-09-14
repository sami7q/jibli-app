import { useRouter, useSegments } from 'expo-router';
import { useCart } from './cart';
import { useOrderWatch } from './order-watch';
import { CartBar } from '@/ui/catalog';
import { space, TAB_BAR_HEIGHT } from '@/theme';

/**
 * The cart, wherever a customer can add to it.
 *
 * The bar lived inside the restaurant screen, so the other place the app offers
 * a «+» — the dish results on the home screen — put items into a cart that
 * nothing on screen acknowledged. Tap plus, and the app says nothing and shows
 * nothing; the only way to discover the cart was to open a restaurant page.
 *
 * Which is why this is app-wide rather than another copy on the home screen:
 * the rule is "if you can add, you can see what you have added", and stating it
 * once is what keeps the next screen with a «+» from repeating the bug.
 */

/**
 * Screens that must not have it.
 *
 * The restaurant page draws its own — it knows whether the cart belongs to the
 * restaurant being viewed, which this cannot. The cart and checkout screens are
 * the cart. The rest end in a button of their own that a floating bar would
 * cover.
 */
const NOT_HERE = new Set(['(auth)', '(driver)', 'cart', 'checkout', 'restaurant', 'order']);

export function GlobalCartBar() {
  const { itemCount, subtotalIqd } = useCart();
  const { announcement } = useOrderWatch();
  const router = useRouter();
  const segments = useSegments() as readonly string[];

  if (itemCount === 0) return null;
  if (NOT_HERE.has(segments[0] ?? '')) return null;

  /*
   * One thing floats at a time, and an order update outranks a cart for the
   * few seconds it is on screen. It is news — the kitchen just did something —
   * and it disappears on its own; the cart is a standing fact that will still
   * be there afterwards. Stacking both would put two bars over the tab bar on
   * the one screen that already has the most furniture.
   */
  if (announcement) return null;

  return (
    <CartBar
      count={itemCount}
      totalIqd={subtotalIqd}
      onPress={() => router.push('/cart')}
      bottom={TAB_BAR_HEIGHT + space[3]}
    />
  );
}
