'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIONS_AR,
  EMPTY_STATES_AR,
  ORDER_LANES,
  money,
  ordersCountAr,
  relativeAr,
} from '@jibli/ui-web';
import { ApiError, restaurantApi, type LiveOrder } from '@/lib/api';
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

  useEffect(() => {
    const manager = alertManager.current;
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
    <section className="card" aria-label="الطلبات المباشرة">
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
            <div className="lane" key={lane.key}>
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
          <button
            type="button"
            className="btn btn--ghost btn--block"
            disabled={runCommand.isPending}
            onClick={() => runCommand.mutate('ready')}
          >
            <Icon name="check" className="nav__icon" aria-hidden />
            {ACTIONS_AR.markReady}
          </button>
        ) : null}

        {order.status === 'READY' && !order.driver ? (
          <button type="button" className="btn btn--primary btn--block">
            {ACTIONS_AR.assignDriver}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export { ordersCountAr };
