import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useVertical } from './vertical';

/**
 * The platform service fee, from the storefront the screen has already loaded.
 *
 * The same query key as the home screen, so this is a cache read rather than a
 * request. Zero until it arrives, which only ever under-states a card's fee
 * for a moment; the checkout quote is the authoritative number.
 */
export function useServiceFee(): number {
  const { vertical } = useVertical();
  const type = vertical ?? 'RESTAURANT';
  const storefront = useQuery({
    queryKey: ['storefront', type],
    queryFn: () => api.storefront(type),
    staleTime: 5 * 60_000,
  });
  return storefront.data?.service_fee_iqd ?? 0;
}
