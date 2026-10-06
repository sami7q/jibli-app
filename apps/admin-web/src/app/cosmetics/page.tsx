'use client';

import { Suspense } from 'react';
import { MerchantDirectory } from '@/components/merchant-directory';

/**
 * The cosmetics directory.
 *
 * `/markets` with a different value, for the same reason it exists: a
 * cosmetics shop is a row in `restaurants` with `merchant_type` set to
 * COSMETICS, and an operator looks for it in the sidebar before believing it
 * can be added at all.
 */
export default function CosmeticsPage() {
  /*
   * The directory reads `?activation=requested` with `useSearchParams`,
   * and Next refuses to prerender a page that does so outside a Suspense
   * boundary — the whole Vercel build stopped on this page for it.
   */
  return (
    <Suspense fallback={null}>
      <MerchantDirectory only="COSMETICS" />
    </Suspense>
  );
}
