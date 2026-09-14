'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverAvailability, VehicleType } from '@jibli/contracts';
import {
  ACTIONS_AR,
  DRIVER_AVAILABILITY_LABELS,
  EMPTY_STATES_AR,
  ORDER_LANES,
  VEHICLE_TYPE_LABELS,
  money,
  ordersCountAr,
  relativeAr,
} from '@jibli/ui-web';
import { ApiError, restaurantApi, type EligibleDriver, type LiveOrder } from '@/lib/api';
import { OrderAlertManager, type AlertState } from '@/lib/order-alerts';
import { useRealtime } from '@/hooks/use-realtime';
import { Icon } from './icon';

/**
 * Live order board (plan §29, §30, §110).
 *
 * Behaviour the plan requires:
 *   - lanes by status, with an SLA timer per card
 *   - an audible alert that survives browser autoplay rules
 *   - polling as the fallback when realtime is unavailable
 *   - a visible offline/reconnecting banner
 *   - acceptance is never shown as done until the server confirms it
 */

/** An order older than this without acceptance is visibly late (plan §29). */
const SLA_WARNING_MINUTES = 5;
const SLA_LATE_MINUTES = 10;

/**
 * Poll interval.
 *
 * Realtime is the primary channel. This is the fallback that guarantees an
 * order can never sit unseen because a frame was dropped or the gateway was
 * down (plan §31, §110) — so it stays slow while the socket is healthy and
 * tightens when it is not.
 */
const POLL_INTERVAL_CONNECTED_MS = 60_000;
const POLL_INTERVAL_DEGRADED_MS = 8_000;

interface Auth {
  readonly accessToken: string;
  readonly restaurantId: string;
}

export function LiveBoard({ auth }: { auth: Auth }) {
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

  // Every realtime event invalidates the query rather than patching state
  // directly, so an out-of-order or duplicated frame cannot corrupt the board.
  const realtimeStatus = useRealtime({
    accessToken: auth.accessToken,
    onEvent: () => {
      void queryClient.invalidateQueries({ queryKey: ['live-orders', auth.restaurantId] });
    },
  });

  const isRealtimeHealthy = realtimeStatus === 'connected';

  const ordersQuery = useQuery({
    queryKey: ['live-orders', auth.restaurantId],
    queryFn: ({ signal }) => restaurantApi.liveOrders(auth, signal),
    refetchInterval: isRealtimeHealthy
      ? POLL_INTERVAL_CONNECTED_MS
      : POLL_INTERVAL_DEGRADED_MS,
    // Keep polling in a background tab: a busy kitchen leaves the board behind
    // another window and still needs the alert to fire (plan §30).
    refetchIntervalInBackground: true,
  });

  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);

  // Feed the alert manager the full pending set, never a delta — that is what
  // makes duplicate realtime events harmless (plan §30).
  useEffect(() => {
    const pendingIds = orders
      .filter((order) => order.status === 'PENDING_RESTAURANT')
      .map((order) => order.id);
    alertManager.current?.syncPending(pendingIds);
  }, [orders]);

  /*
   * Pick the choice back up on mount, and put it down on unmount without
   * forgetting it. `disable()` defaults to not remembering precisely so this
   * cleanup cannot be mistaken for the operator switching alerts off.
   */
  useEffect(() => {
    const manager = alertManager.current;
    manager?.restore();
    return () => manager?.disable();
  }, []);

  const enableAlerts = useCallback(async () => {
    await alertManager.current?.enable();
  }, []);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['live-orders', auth.restaurantId] });
  }, [queryClient, auth.restaurantId]);

  const lanes = useMemo(() => {
    const grouped = new Map<string, LiveOrder[]>();
    for (const lane of ORDER_LANES) grouped.set(lane.key, []);
    for (const order of orders) {
      grouped.get(order.status)?.push(order);
    }
    return grouped;
  }, [orders]);

  const isOffline = ordersQuery.isError;
  const isDegraded = !isRealtimeHealthy && !isOffline;

  return (
    <section className="card" id="live-orders" aria-label="الطلبات المباشرة">
      <div className="card__header">
        <div>
          <h2 className="card__title">
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: isOffline
                  ? 'var(--jibli-danger-500)'
                  : isDegraded
                    ? 'var(--jibli-warning-500)'
                    : 'var(--jibli-success-500)',
                display: 'inline-block',
              }}
            />
            الطلبات المباشرة
          </h2>
          <p className="card__subtitle">
            {isOffline
              ? 'انقطع الاتصال بالخادم'
              : isDegraded
                ? 'التحديث المباشر غير متصل — يتم التحديث كل 8 ثوانٍ'
                : 'تابع الطلبات الجديدة وحالة التحضير بشكل مباشر'}
          </p>
        </div>

        <AlertToggle state={alertState} onEnable={enableAlerts} />
      </div>

      {/*
        A visible banner whenever the board is not live. Plan §110: staff must
        be able to tell "no new orders" apart from "not receiving orders".
      */}
      {isOffline ? (
        <div className="alert-bar alert-bar--danger" role="alert" style={{ marginBottom: 16 }}>
          <span>
            <Icon name="alert" className="nav__icon" aria-hidden /> {EMPTY_STATES_AR.loadFailed} —
            جاري إعادة المحاولة تلقائياً
          </span>
          <button type="button" className="btn btn--danger" onClick={() => void ordersQuery.refetch()}>
            {ACTIONS_AR.retry}
          </button>
        </div>
      ) : null}

      {isDegraded ? (
        <div className="alert-bar alert-bar--warning" role="status" style={{ marginBottom: 16 }}>
          <span>
            <Icon name="alert" className="nav__icon" aria-hidden /> جاري إعادة الاتصال بالتحديث
            المباشر. الطلبات لا تزال تصل، لكن بتأخير بسيط.
          </span>
        </div>
      ) : null}

      {!alertState.enabled ? (
        <div className="alert-bar alert-bar--warning" style={{ marginBottom: 16 }}>
          <span>
            تنبيه الطلبات الصوتي غير مفعّل. المتصفح يتطلب ضغطة واحدة لتفعيل الصوت.
          </span>
          <button type="button" className="btn btn--primary" onClick={() => void enableAlerts()}>
            {ACTIONS_AR.enableSound}
          </button>
        </div>
      ) : null}

      <div className="board">
        {ORDER_LANES.map((lane) => {
          const laneOrders = lanes.get(lane.key) ?? [];
          return (
            <div className="lane" id={`lane-${lane.key}`} key={lane.key}>
              <div className={`lane__header lane__header--${lane.tone}`}>
                <span>{lane.labelAr}</span>
                <span className="numeric">({laneOrders.length})</span>
              </div>

              {laneOrders.length === 0 ? (
                <p className="empty" style={{ padding: 'var(--space-6) var(--space-2)' }}>
                  {lane.key === 'PENDING_RESTAURANT'
                    ? EMPTY_STATES_AR.noNewOrders
                    : EMPTY_STATES_AR.noOrders}
                </p>
              ) : (
                laneOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    auth={auth}
                    onChanged={() => {
                      alertManager.current?.acknowledge(order.id);
                      invalidate();
                    }}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AlertToggle({ state, onEnable }: { state: AlertState; onEnable: () => void }) {
  return (
    <div className="alert-bar alert-bar--success" style={{ padding: 'var(--space-2) var(--space-3)' }}>
      <Icon name="volume" className="nav__icon" aria-hidden />
      <span>
        تنبيه صوتي للطلبات:{' '}
        <strong style={{ color: state.enabled ? 'var(--jibli-success-700)' : 'var(--jibli-danger-700)' }}>
          {state.enabled ? 'مفعل' : 'غير مفعل'}
        </strong>
      </span>
      {!state.enabled ? (
        <button type="button" className="btn btn--ghost" onClick={onEnable}>
          تفعيل
        </button>
      ) : null}
    </div>
  );
}

function OrderCard({
  order,
  auth,
  onChanged,
}: {
  order: LiveOrder;
  auth: Auth;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pickingDriver, setPickingDriver] = useState(false);

  const runCommand = useMutation({
    mutationFn: async (action: 'accept' | 'reject' | 'prepare' | 'ready') => {
      switch (action) {
        case 'accept':
          return restaurantApi.acceptOrder(auth, order.id, order.version);
        case 'reject':
          return restaurantApi.rejectOrder(auth, order.id, {
            reason: 'TOO_BUSY',
            expectedVersion: order.version,
          });
        case 'prepare':
          return restaurantApi.startPreparing(auth, order.id, order.version);
        case 'ready':
          return restaurantApi.markReady(auth, order.id, order.version);
      }
    },
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (mutationError: unknown) => {
      if (mutationError instanceof ApiError) {
        // A stale board is recoverable: refresh rather than showing a dead end
        // (plan §113 ORDER_ALREADY_UPDATED).
        setError(mutationError.messageAr);
        if (mutationError.isStaleState) onChanged();
      } else {
        setError('تعذّر تنفيذ الإجراء');
      }
    },
  });

  const slaTone =
    order.status === 'PENDING_RESTAURANT' && order.age_minutes >= SLA_LATE_MINUTES
      ? 'late'
      : order.age_minutes >= SLA_WARNING_MINUTES
        ? 'warning'
        : 'ok';

  return (
    <article className={`order-card${order.status === 'PENDING_RESTAURANT' ? ' order-card--new' : ''}`}>
      <div className="order-card__head">
        <span className="order-card__number ltr-inline">#{order.public_order_number}</span>
        {/*
          The SLA state is carried by the text, not only the colour, so it is
          readable without colour perception (plan §134).
        */}
        <span className={`badge${slaTone === 'late' ? ' badge--sla-late' : ' badge--done'}`}>
          <Icon name="clock" className="nav__icon" aria-hidden />
          {slaTone === 'late' ? 'متأخر — ' : ''}
          {relativeAr(order.placed_at)}
        </span>
      </div>

      <div className="order-card__customer">
        <Icon name="drivers" className="nav__icon" aria-hidden />
        {order.customer_name}
      </div>

      <div className="order-card__items">
        {order.items.map((item) => (
          <div className="order-card__item" key={item.id}>
            <span className="order-card__item-name">
              <span className="numeric">{item.quantity}</span> × {item.name_ar}
            </span>
            <span className="numeric">{money(item.line_total_iqd)}</span>
          </div>
        ))}
      </div>

      {order.customer_notes ? (
        <p className="order-card__note">ملاحظة: {order.customer_notes}</p>
      ) : null}

      <div className="order-card__total">
        <span>المجموع</span>
        <span className="numeric">{money(order.customer_total_iqd)}</span>
      </div>

      {order.driver ? (
        <p className="order-card__note">
          المندوب: {order.driver.name} — {order.driver.assignment_status}
        </p>
      ) : null}

      {error ? (
        <p className="alert-bar alert-bar--danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="order-card__actions">
        {order.status === 'PENDING_RESTAURANT' ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              style={{ flex: 1 }}
              disabled={runCommand.isPending}
              onClick={() => runCommand.mutate('accept')}
            >
              {ACTIONS_AR.accept}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={runCommand.isPending}
              onClick={() => runCommand.mutate('reject')}
            >
              {ACTIONS_AR.reject}
            </button>
          </>
        ) : null}

        {order.status === 'ACCEPTED' ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={runCommand.isPending}
            onClick={() => runCommand.mutate('prepare')}
          >
            {ACTIONS_AR.startPreparing}
          </button>
        ) : null}

        {order.status === 'PREPARING' ? (
          /*
           * Green, because it is the one action on this card that finishes
           * something. It was a ghost button — the quietest style the portal
           * has — for the step that says the food is cooked, sitting under a
           * row of filled buttons for accepting and refusing. The lane it
           * moves the order into is «جاهز», which the board already draws in
           * green; the button that gets it there should agree.
           */
          <button
            type="button"
            className="btn btn--success btn--block"
            disabled={runCommand.isPending}
            onClick={() => runCommand.mutate('ready')}
          >
            <Icon name="check" className="nav__icon" aria-hidden />
            {ACTIONS_AR.markReady}
          </button>
        ) : null}

        {order.status === 'READY' && !order.driver ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => setPickingDriver(true)}
          >
            {ACTIONS_AR.assignDriver}
          </button>
        ) : null}
      </div>

      {pickingDriver ? (
        <DriverPicker
          auth={auth}
          orderId={order.id}
          orderNumber={order.public_order_number}
          onClose={() => setPickingDriver(false)}
          onAssigned={() => {
            setPickingDriver(false);
            setError(null);
            onChanged();
          }}
        />
      ) : null}
    </article>
  );
}

/**
 * Choosing who carries the order.
 *
 * The button that opens this had no `onClick` at all — it rendered, it
 * highlighted on hover, and it did nothing, which is the worst failure a
 * control can have because it looks like the server ignored you. The two API
 * calls behind it (`/drivers/eligible` and `/orders/:id/assign-driver`) and
 * their client functions had been written and were never called from anywhere.
 *
 * Everything the server checks is shown rather than hidden: a driver who is
 * off shift or already carrying their limit stays on the list, disabled, with
 * the reason next to their name. A list that silently omits half the team
 * leaves a manager wondering where their driver went.
 */
function DriverPicker({
  auth,
  orderId,
  orderNumber,
  onClose,
  onAssigned,
}: {
  auth: Auth;
  orderId: string;
  orderNumber: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const drivers = useQuery({
    queryKey: ['eligible-drivers', auth.restaurantId, orderId],
    queryFn: () => restaurantApi.eligibleDrivers(auth),
    // Availability changes minute to minute; a cached list would offer someone
    // who has since gone off shift.
    staleTime: 0,
  });

  const assign = useMutation({
    mutationFn: (driverId: string) => restaurantApi.assignDriver(auth, orderId, driverId),
    onSuccess: onAssigned,
    onError: (assignError: unknown) => {
      setChosen(null);
      setError(assignError instanceof ApiError ? assignError.messageAr : 'تعذّر تعيين السائق');
    },
  });

  const list = drivers.data ?? [];
  const assignable = list.filter((driver) => driver.assignable);

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-title"
      // The backdrop closes; a click inside must not bubble out to it.
      onClick={onClose}
    >
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <h2 id="assign-title">
          تعيين سائق للطلب <span className="ltr-inline">#{orderNumber}</span>
        </h2>

        {error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {error}
          </p>
        ) : null}

        {drivers.isLoading ? <p>جارٍ تحميل السائقين…</p> : null}

        {drivers.isError ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            تعذّر تحميل قائمة السائقين.{' '}
            <button type="button" className="btn btn--ghost" onClick={() => void drivers.refetch()}>
              إعادة المحاولة
            </button>
          </p>
        ) : null}

        {!drivers.isLoading && !drivers.isError && list.length === 0 ? (
          <div className="empty">
            <p>لا يوجد سائقون مرتبطون بالمطعم بعد.</p>
            <a className="btn btn--primary" href="/drivers">
              إدارة السائقين
            </a>
          </div>
        ) : null}

        {list.length > 0 && assignable.length === 0 ? (
          <p className="alert-bar alert-bar--warning" role="status">
            لا يوجد سائق متاح الآن — جميع السائقين خارج الدوام أو مشغولون بطلبات أخرى.
          </p>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {list.map((driver) => (
            <button
              key={driver.id}
              type="button"
              className="btn btn--secondary"
              disabled={!driver.assignable || assign.isPending}
              onClick={() => {
                setChosen(driver.id);
                assign.mutate(driver.id);
              }}
              style={{
                justifyContent: 'space-between',
                textAlign: 'start',
                opacity: driver.assignable ? 1 : 0.55,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong>{driver.name}</strong>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {driverStatusAr(driver)}
                </span>
              </span>
              <span style={{ fontSize: 'var(--text-xs)' }}>
                {assign.isPending && chosen === driver.id ? 'جارٍ التعيين…' : 'تعيين'}
              </span>
            </button>
          ))}
        </div>

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

/** Why a driver can or cannot take this order, in one line. */
function driverStatusAr(driver: EligibleDriver): string {
  const vehicle = VEHICLE_TYPE_LABELS[driver.vehicle_type as VehicleType] ?? driver.vehicle_type;
  const availability =
    DRIVER_AVAILABILITY_LABELS[driver.availability as DriverAvailability] ?? driver.availability;

  const parts: string[] = [vehicle, availability];

  if (driver.active_assignments > 0) parts.push(`${driver.active_assignments} طلب جارٍ`);
  if (!driver.can_collect_cash) parts.push('لا يستلم نقداً');

  return parts.join(' · ');
}

export { ordersCountAr };
