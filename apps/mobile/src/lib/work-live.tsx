import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DriverDeliverySummary, type OwnerLiveOrder } from './api';
import { useOwner } from './owner';
import { registerForPush } from './push';
import { useRealtime, type RealtimeStatus } from './realtime';
import { useSession } from './session';
import { notifyNewOrderOnDevice } from './owner-notify';
import { ringWorkAlert } from './work-alert';
import { onWorkSignal } from './work-signals';
import { courierChanges, freshPending, shouldRemind, type TaskSnapshot } from './work-watch';

/**
 * The two people who are waited on: the shop, and the courier.
 *
 * A customer's order sits on a shop's board until somebody accepts it, and a
 * packed order sits on the counter until a courier collects it. Both used to
 * learn about their work only if the right screen happened to be open and its
 * 15-second poll came round — the customer watching a spinner in the
 * meantime.
 *
 * This runs for the whole app, whatever screen is showing:
 *
 *   listens on the realtime socket (instant, when the worker is publishing),
 *   polls as a fallback (every 12–15 s while the socket is down),
 *   registers the phone for push (the app closed or in a pocket),
 *   and rings — sound, vibration, and a banner over any screen — when there is
 *   something new to answer, reminding every 30 s for five minutes.
 *
 * Only for accounts that have the work: an account with a shop Owner Mode
 * serves gets the shop engine, an active courier the courier engine, and a
 * customer gets neither — not so much as one extra request.
 */

export interface OwnerLive {
  readonly active: boolean;
  readonly live: RealtimeStatus;
  /** Orders waiting for the shop's answer, oldest first. */
  readonly pending: readonly OwnerLiveOrder[];
}

export interface DriverLive {
  readonly active: boolean;
  readonly live: RealtimeStatus;
  /** A task waiting for the courier's answer, if any. */
  readonly offer: DriverDeliverySummary | null;
  /** A task the courier holds whose order is packed and waiting at the shop. */
  readonly readyToCollect: DriverDeliverySummary | null;
}

interface WorkLive {
  readonly owner: OwnerLive;
  readonly driver: DriverLive;
  readonly ownerMuted: boolean;
  readonly driverMuted: boolean;
  /** Silence the reminders until something new arrives. */
  readonly mute: (role: 'owner' | 'driver') => void;
}

const OWNER_IDLE: OwnerLive = { active: false, live: 'off', pending: [] };
const DRIVER_IDLE: DriverLive = { active: false, live: 'off', offer: null, readyToCollect: null };

const WorkLiveContext = createContext<WorkLive>({
  owner: OWNER_IDLE,
  driver: DRIVER_IDLE,
  ownerMuted: false,
  driverMuted: false,
  mute: () => undefined,
});

export function useWorkLive(): WorkLive {
  return useContext(WorkLiveContext);
}

/** How often to look while the socket is down — and while it is up, as a check. */
const OWNER_POLL_MS = 12_000;
const DRIVER_POLL_MS = 15_000;
const LIVE_POLL_MS = 60_000;
/** The reminder clock. The rule itself is `shouldRemind`. */
const TICK_MS = 5_000;

export function WorkLiveProvider({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const me = state.status === 'ready' || state.status === 'offline-ready' ? state.me : null;
  const userId = me?.user_id ?? null;
  const ownsShop = Object.keys(me?.restaurant_roles ?? {}).length > 0;
  const isDriver = Boolean(me?.modes.includes('DRIVER'));

  const [owner, setOwner] = useState<OwnerLive>(OWNER_IDLE);
  const [driver, setDriver] = useState<DriverLive>(DRIVER_IDLE);
  const [ownerMuted, setOwnerMuted] = useState(false);
  const [driverMuted, setDriverMuted] = useState(false);

  const mute = useCallback((role: 'owner' | 'driver') => {
    if (role === 'owner') setOwnerMuted(true);
    else setDriverMuted(true);
  }, []);

  /*
   * Stable, and it matters: the engines list these in their effects' deps, and
   * a fresh function per render would re-run the diff after every state change
   * it publishes — a render loop with a phone ringing in it.
   */
  const unmuteOwner = useCallback(() => setOwnerMuted(false), []);
  const unmuteDriver = useCallback(() => setDriverMuted(false), []);

  const value = useMemo<WorkLive>(
    () => ({ owner, driver, ownerMuted, driverMuted, mute }),
    [owner, driver, ownerMuted, driverMuted, mute],
  );

  /*
   * The engines are siblings of the app, not wrappers around it: one mounting
   * or unmounting when an account changes must not remount every screen.
   */
  return (
    <WorkLiveContext.Provider value={value}>
      {ownsShop && userId ? (
        <OwnerEngine userId={userId} muted={ownerMuted} onFresh={unmuteOwner} onState={setOwner} />
      ) : null}
      {isDriver && userId ? (
        <DriverEngine
          userId={userId}
          muted={driverMuted}
          onFresh={unmuteDriver}
          onState={setDriver}
        />
      ) : null}
      {children}
    </WorkLiveContext.Provider>
  );
}

// ── The shop ────────────────────────────────────────────────────────────────

function OwnerEngine({
  userId,
  muted,
  onFresh,
  onState,
}: {
  userId: string;
  muted: boolean;
  onFresh: () => void;
  onState: (state: OwnerLive) => void;
}) {
  const owner = useOwner();
  const shopId = owner.shop?.id ?? null;
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    if (shopId) void queryClient.invalidateQueries({ queryKey: ['owner-orders', shopId] });
  }, [queryClient, shopId]);

  const live = useRealtime(Boolean(shopId), userId, (event) => {
    if (
      event.type === 'realtime.sync' ||
      event.type.startsWith('order.') ||
      event.type.startsWith('delivery.')
    ) {
      refresh();
    }
  });

  useEffect(
    () =>
      onWorkSignal((signal) => {
        if (signal.audience === 'restaurant') refresh();
      }),
    [refresh],
  );

  const orders = useQuery({
    queryKey: ['owner-orders', shopId],
    queryFn: () => api.ownerLiveOrders(shopId as string),
    enabled: Boolean(shopId),
    refetchInterval: live === 'live' ? LIVE_POLL_MS : OWNER_POLL_MS,
  });

  /*
   * Push, once per account on this phone. The token moves to whichever account
   * registered it last, so a phone that signed in as a customer and then as a
   * shop has to say so — otherwise the shop's new orders go to the customer.
   * Asked here, at the first moment the value is obvious: this account has a
   * shop and orders will come to it.
   */
  const registeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!shopId || registeredFor.current === userId) return;
    registeredFor.current = userId;
    void registerForPush();
  }, [shopId, userId]);

  const known = useRef<Set<string> | null>(null);
  const waitingSince = useRef<number | null>(null);
  const lastRang = useRef<number | null>(null);

  // A different shop is a different board: start again rather than diff across.
  useEffect(() => {
    known.current = null;
    waitingSince.current = null;
    lastRang.current = null;
  }, [shopId]);

  useEffect(() => {
    const data = orders.data;
    if (!data || !shopId) return;

    const { fresh, known: next } = freshPending(known.current, data);
    known.current = next;

    const pending = data
      .filter((order) => order.status === 'PENDING_RESTAURANT')
      .sort((a, b) => a.placed_at.localeCompare(b.placed_at));

    if (pending.length === 0) {
      waitingSince.current = null;
      lastRang.current = null;
    }

    if (fresh.length > 0) {
      const now = Date.now();
      waitingSince.current = now;
      lastRang.current = now;
      onFresh();
      void ringWorkAlert();
      /*
       * With the app in front the banner says it; behind another app, or
       * with the screen off, the tray is the only place it can be said.
       * The first poll after a launch is not news — `known` was empty —
       * and it happens with the app in front, so it never lands here.
       */
      if (AppState.currentState !== 'active') {
        for (const order of data) {
          if (fresh.includes(order.id)) void notifyNewOrderOnDevice(order);
        }
      }
    }

    onState({ active: true, live, pending });
  }, [orders.data, shopId, live, onFresh, onState]);

  useEffect(() => {
    if (muted) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (shouldRemind(waitingSince.current, lastRang.current, Date.now())) {
        lastRang.current = Date.now();
        void ringWorkAlert();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [muted]);

  useEffect(() => () => onState(OWNER_IDLE), [onState]);

  return null;
}

// ── The courier ─────────────────────────────────────────────────────────────

function DriverEngine({
  userId,
  muted,
  onFresh,
  onState,
}: {
  userId: string;
  muted: boolean;
  onFresh: () => void;
  onState: (state: DriverLive) => void;
}) {
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['driver', 'deliveries'] });
    void queryClient.invalidateQueries({ queryKey: ['driver', 'delivery'] });
    void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
  }, [queryClient]);

  const live = useRealtime(true, userId, (event) => {
    if (
      event.type === 'realtime.sync' ||
      event.type.startsWith('delivery.') ||
      event.type.startsWith('order.')
    ) {
      refresh();
    }
  });

  useEffect(
    () =>
      onWorkSignal((signal) => {
        if (signal.audience === 'driver') refresh();
      }),
    [refresh],
  );

  const active = useQuery({
    queryKey: ['driver', 'deliveries', 'active'],
    queryFn: () => api.driverDeliveries('active'),
    refetchInterval: live === 'live' ? LIVE_POLL_MS : DRIVER_POLL_MS,
  });

  const registeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (registeredFor.current === userId) return;
    registeredFor.current = userId;
    void registerForPush();
  }, [userId]);

  const previous = useRef<Map<string, TaskSnapshot> | null>(null);
  const waitingSince = useRef<number | null>(null);
  const lastRang = useRef<number | null>(null);

  useEffect(() => {
    const rows = active.data;
    if (!rows) return;

    const { assigned, ready, snapshot } = courierChanges(previous.current, rows);
    previous.current = snapshot;

    const offer = rows.find((row) => row.status === 'ASSIGNED') ?? null;
    const readyToCollect =
      rows.find(
        (row) =>
          (row.status === 'ACCEPTED' || row.status === 'ASSIGNED') && row.order_status === 'READY',
      ) ?? null;

    // The reminder is for an offer still unanswered; a ready order rings once.
    if (!offer) {
      waitingSince.current = null;
      lastRang.current = null;
    }

    if (assigned.length > 0 || ready.length > 0) {
      const now = Date.now();
      if (assigned.length > 0) {
        waitingSince.current = now;
        lastRang.current = now;
      }
      onFresh();
      void ringWorkAlert();
    }

    onState({ active: true, live, offer, readyToCollect });
  }, [active.data, live, onFresh, onState]);

  useEffect(() => {
    if (muted) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (shouldRemind(waitingSince.current, lastRang.current, Date.now())) {
        lastRang.current = Date.now();
        void ringWorkAlert();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [muted]);

  useEffect(() => () => onState(DRIVER_IDLE), [onState]);

  return null;
}
