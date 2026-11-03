'use client';

import { useQuery } from '@tanstack/react-query';
import { admin } from './admin-endpoints';

/**
 * The platform's live orders, polled every fifteen seconds from any screen.
 *
 * One query shared by the new-order sound and the «لم يُقبل بعد» alert, so
 * the shell polls once however many of them are showing.
 */
export function useLiveOrders(token: string) {
  return useQuery({
    queryKey: ['admin-live-orders'],
    queryFn: () => admin.ordersPaged(token, { scope: 'live', limit: 50, offset: 0 }),
    enabled: token !== '',
    refetchInterval: 15_000,
  });
}
