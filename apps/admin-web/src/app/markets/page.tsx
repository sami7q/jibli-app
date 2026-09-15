'use client';

import { MerchantDirectory } from '@/components/merchant-directory';

/**
 * The market directory.
 *
 * The same component as `/restaurants` with the kind decided, which is the
 * whole of the difference: a market is a row in `restaurants` with one column
 * set differently, and every screen that treats it as more than that is a
 * screen that has to be kept in step with its twin.
 *
 * It exists because the sidebar is where an operator looks for a thing before
 * they believe it is possible. «المطاعم» with a type filter inside it is the
 * same capability and it reads as an absence.
 */
export default function MarketsPage() {
  return <MerchantDirectory only="MARKET" />;
}
