import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useOwner } from '@/lib/owner';
import { useSession } from '@/lib/session';
import { useVertical } from '@/lib/vertical';
import { setAccentSection } from '@/theme';

/**
 * Owner Mode is drawn in the shop's own colours.
 *
 * The app's accent follows the section the *customer* last chose — which is
 * whatever they were browsing before opening «متجري», and has nothing to do
 * with the shop. A cosmetics owner who had been looking at restaurants got an
 * orange product form; one who had been in the market got a green one. The
 * shop is the one thing on these screens, so its section is the accent here.
 *
 * Set twice on purpose. During render, so the very first frame of a screen
 * under this layout is already right — `color.brand` is read at render time,
 * and an effect would paint one orange frame first. And through the provider,
 * so the rest of the app agrees: the home screen a shop owner steps out to is
 * their own section, which is also where «عرض المتجر كزبون» has to land.
 *
 * It also guards the group. The home screen (`owner`) and the application form
 * (`apply`) are where a shop is registered, so they are open to any account;
 * every other screen here manages a shop and needs one. A signed-in customer
 * who reaches one of those by a stale deep link — or anyone with no shop and no
 * intent to register — is sent back to the customer app rather than shown a
 * management screen with nothing in it (CUST-3).
 */
export default function OwnerLayout() {
  const router = useRouter();
  const segments = useSegments() as readonly string[];
  const { state, parkedAccount } = useSession();
  const owner = useOwner();
  const { vertical, choose } = useVertical();

  const section = owner.shop?.merchant_type ?? null;
  if (section && section !== vertical) setAccentSection(section);

  useEffect(() => {
    if (section && section !== vertical) choose(section);
  }, [section, vertical, choose]);

  // The route under `(owner)`: 'owner' is the home/hub, 'apply' the form.
  const sub = segments[1];
  const registerIntent = sub === undefined || sub === 'owner' || sub === 'apply';

  const roles =
    state.status === 'ready' || state.status === 'needs-profile' || state.status === 'offline-ready'
      ? Object.keys(state.me?.restaurant_roles ?? {}).length
      : 0;
  const hasShopAccess = roles > 0 || owner.usable.length > 0 || parkedAccount === 'shop';

  /*
   * Decide only once the session has resolved and the shop list has been asked,
   * or a real owner would be bounced on the first frame before their roles land.
   * A guest's shop query is disabled, so `isLoading` is false for them at once.
   */
  const canDecide = state.status !== 'loading' && !owner.isLoading;

  useEffect(() => {
    if (!canDecide) return;
    if (!hasShopAccess && !registerIntent) router.replace('/(tabs)');
  }, [canDecide, hasShopAccess, registerIntent, router]);

  return <Slot />;
}
