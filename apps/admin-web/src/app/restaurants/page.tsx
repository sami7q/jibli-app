'use client';

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
  return <MerchantDirectory />;
}
