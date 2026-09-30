import { useEffect } from 'react';
import { Slot } from 'expo-router';
import { useOwner } from '@/lib/owner';
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
 */
export default function OwnerLayout() {
  const { shop } = useOwner();
  const { vertical, choose } = useVertical();
  const section = shop?.merchant_type ?? null;

  if (section && section !== vertical) setAccentSection(section);

  useEffect(() => {
    if (section && section !== vertical) choose(section);
  }, [section, vertical, choose]);

  return <Slot />;
}
