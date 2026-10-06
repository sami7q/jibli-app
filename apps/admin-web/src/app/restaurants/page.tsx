'use client';

import { Suspense } from 'react';
import { MerchantDirectory } from '@/components/merchant-directory';

/**
 * The restaurant directory — and, unless narrowed, the market one too.
 *
 * It does not fix the kind. An operator who types a partner's name here should
 * find it whichever half of the business it belongs to, because the name is
 * what they remember and the kind is what they are trying to establish. The
 * «النوع» filter narrows it when they already know; `/markets` is the same
 * screen with that answer built in.
 */
export default function RestaurantsPage() {
  /*
   * The directory reads `?activation=requested` with `useSearchParams`,
   * and Next refuses to prerender a page that does so outside a Suspense
   * boundary — the whole Vercel build stopped on this page for it.
   */
  return (
    <Suspense fallback={null}>
      <MerchantDirectory />
    </Suspense>
  );
}
