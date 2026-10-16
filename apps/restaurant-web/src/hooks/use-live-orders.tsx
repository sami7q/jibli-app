'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { restaurantApi, type LiveOrder } from '@/lib/api';
import { OrderAlertManager, type AlertState } from '@/lib/order-alerts';
import { useRealtime } from '@/hooks/use-realtime';
import { useSession } from '@/hooks/use-session';

/**
 * Portal-wide live orders, alerts and the bell badge (MERCH-4).
 *
 * The live-orders query, the realtime socket and the `OrderAlertManager` used
 * to live inside `LiveBoard`, which only the dashboard renders. So an owner who
 * walked off the dashboard to edit the menu or the settings heard nothing when
 * a new order arrived, saw no bell badge, and only discovered it on returning
 * home — exactly when a kitchen is least able to watch one screen.
 *
 * Hoisting the whole apparatus above the page lets the chime, the browser
 * notification, the tab-title badge and the topbar bell run on every portal
 * page. One manager instance survives navigation between protected pages, so
 * its deduplication holds and an order is never announced twice.
 */

/**
 * Poll interval — slow while realtime is healthy, tight when it is not. The
 * floor under the socket so an order can never sit unseen (plan §31, §110).
 */
const POLL_INTERVAL_CONNECTED_MS = 60_000;
const POLL_INTERVAL_DEGRADED_MS = 8_000;

export interface LiveOrdersValue {
  readonly orders: LiveOrder[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isOffline: boolean;
  readonly isDegraded: boolean;
  readonly isRealtimeHealthy: boolean;
  readonly alertState: AlertState;
  /** Orders awaiting a decision — the number the bell and the title badge show. */
  readonly pendingCount: number;
  readonly enableAlerts: () => void;
  readonly acknowledge: (orderId: string) => void;
  readonly invalidate: () => void;
  readonly refetch: () => void;
}

const INACTIVE: LiveOrdersValue = {
  orders: [],
  isLoading: false,
  isError: false,
  isOffline: false,
  isDegraded: false,
  isRealtimeHealthy: false,
  alertState: { enabled: false, notificationPermission: 'unknown', pendingOrderIds: [] },
  pendingCount: 0,
  enableAlerts: () => undefined,
  acknowledge: () => undefined,
  invalidate: () => undefined,
  refetch: () => undefined,
};

const LiveOrdersContext = createContext<LiveOrdersValue>(INACTIVE);

/**
 * Paths with no portal session: the live machinery must not run there, and
 * must not start the session either. Couriers carry their own session under
 * `/driver`, and the sign-in/apply pages are reached signed-out.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === '/login' || pathname === '/change-password' || pathname === '/apply') {
    return true;
  }
  return pathname === '/driver' || pathname.startsWith('/driver/');
}

export function LiveOrdersProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // On a public path the live apparatus stays dark — rendering the active
  // provider there would call `useSession`, which starts a portal session the
  // page does not have and does not want.
  if (isPublicPath(pathname)) {
    return <LiveOrdersContext.Provider value={INACTIVE}>{children}</LiveOrdersContext.Provider>;
  }

  return <ActiveLiveOrders>{children}</ActiveLiveOrders>;
}

function ActiveLiveOrders({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const authenticated = session.status === 'authenticated';
  const accessToken = authenticated ? session.accessToken : null;
  const restaurantId = authenticated ? session.restaurantId : null;

  const queryClient = useQueryClient();

  const [alertState, setAlertState] = useState<AlertState>({
    enabled: false,
    notificationPermission: 'unknown',
    pendingOrderIds: [],
  });

  const alertManager = useRef<OrderAlertManager | null>(null);
  if (!alertManager.current) {
    alertManager.current = new OrderAlertManager({ onStateChange: setAlertState });
  }

  const invalidate = useCallback(() => {
    if (!restaurantId) return;
    void queryClient.invalidateQueries({ queryKey: ['live-orders', restaurantId] });
  }, [queryClient, restaurantId]);

  // Every realtime frame invalidates rather than patching state, so a
  // duplicated or out-of-order event cannot corrupt the board.
  const realtimeStatus = useRealtime({
    accessToken,
    enabled: authenticated,
    onEvent: () => invalidate(),
  });

  const isRealtimeHealthy = realtimeStatus === 'connected';

  const ordersQuery = useQuery({
    queryKey: ['live-orders', restaurantId],
    queryFn: ({ signal }) =>
      restaurantApi.liveOrders(
        { accessToken: accessToken as string, restaurantId: restaurantId as string },
        signal,
      ),
    enabled: authenticated,
    refetchInterval: isRealtimeHealthy ? POLL_INTERVAL_CONNECTED_MS : POLL_INTERVAL_DEGRADED_MS,
    // Keep polling behind another tab: a busy kitchen leaves the board behind a
    // menu edit and still needs the alert to fire (plan §30).
    refetchIntervalInBackground: true,
  });

  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);

  // Feed the alert manager the full pending set, never a delta — that is what
  // keeps a duplicate realtime event from chiming twice (plan §30).
  useEffect(() => {
    const pendingIds = orders
      .filter((order) => order.status === 'PENDING_RESTAURANT')
      .map((order) => order.id);
    alertManager.current?.syncPending(pendingIds);
  }, [orders]);

  // Pick the saved choice back up on mount; put it down on unmount without
  // forgetting it (so leaving the portal is not read as switching alerts off).
  useEffect(() => {
    const manager = alertManager.current;
    manager?.restore();
    return () => manager?.disable();
  }, []);

  const enableAlerts = useCallback(() => {
    void alertManager.current?.enable();
  }, []);

  const acknowledge = useCallback((orderId: string) => {
    alertManager.current?.acknowledge(orderId);
  }, []);

  const { isLoading, isError, refetch } = ordersQuery;

  const value = useMemo<LiveOrdersValue>(() => {
    const isOffline = isError;
    return {
      orders,
      isLoading: isLoading && authenticated,
      isError,
      isOffline,
      isDegraded: !isRealtimeHealthy && !isOffline && authenticated,
      isRealtimeHealthy,
      alertState,
      pendingCount: alertState.pendingOrderIds.length,
      enableAlerts,
      acknowledge,
      invalidate,
      refetch: () => void refetch(),
    };
  }, [
    orders,
    isLoading,
    isError,
    refetch,
    authenticated,
    isRealtimeHealthy,
    alertState,
    enableAlerts,
    acknowledge,
    invalidate,
  ]);

  return <LiveOrdersContext.Provider value={value}>{children}</LiveOrdersContext.Provider>;
}

export function useLiveOrders(): LiveOrdersValue {
  return useContext(LiveOrdersContext);
}
