'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DriverAvailability, VehicleType } from '@jibli/contracts';
import { ORDER_REJECTION_REASONS, ORDER_REJECTION_REASON_LABELS_AR } from '@jibli/contracts';
import {
  ACTIONS_AR,
  DRIVER_AVAILABILITY_LABELS,
  EMPTY_STATES_AR,
  ORDER_LANES,
  VEHICLE_TYPE_LABELS,
  money,
  relativeAr,
  ordersCountAr,
} from '@jibli/ui-web';
import { ApiError, restaurantApi, type EligibleDriver, type LiveOrder } from '@/lib/api';
import type { AlertState } from '@/lib/order-alerts';
import { useLiveOrders } from '@/hooks/use-live-orders';
import { Icon } from './icon';

/**
 * Live order board (plan §29, §30, §110).
 *
 * The query, the realtime socket and the alert manager no longer live here —
 * they were hoisted into `LiveOrdersProvider` so the chime and the bell run on
 * every portal page, not only the dashboard (MERCH-4). This component now reads
 * that shared state and renders the lanes.
 */

/** An order older than this without acceptance is visibly late (plan §29). */
const SLA_WARNING_MINUTES = 5;
const SLA_LATE_MINUTES = 10;

/**
 * How long the shop needs, chosen as it accepts (MERCH-6).
 *
 * The customer is shown it and the courier is timed against it, so it is asked
 * for on the tap that commits to it rather than left at a default nobody set.
 * Mirrors the app's owner mode.
 */
const PREP_OPTIONS = [10, 15, 20, 30, 45] as const;

/** Why a shop takes an order back from its courier (MERCH-6). */
const RECALL_REASONS = ['المندوب لا يرد', 'تأخّر المندوب كثيراً', 'سبب آخر'] as const;

/**
 * The courier's side of an order, in the shop's words (MERCH-13).
 *
 * The card printed the raw code — «المندوب: … — ASSIGNED». Mirrors the app's
 * `ASSIGNMENT_LABELS`.
 */
const ASSIGNMENT_LABELS: Record<string, string> = {
  ASSIGNED: 'بانتظار قبول المندوب',
  ACCEPTED: 'المندوب في الطريق إليك',
  PICKED_UP: 'استلم الطلب وفي الطريق للعميل',
  ARRIVED_CUSTOMER: 'وصل إلى العميل',
  DELIVERED: 'سُلّم الطلب',
};

interface Auth {
  readonly accessToken: string;
  readonly restaurantId: string;
}

export function LiveBoard({ auth }: { auth: Auth }) {
  const live = useLiveOrders();
  const { orders, alertState, isOffline, isDegraded } = live;

  const lanes = groupByLane(orders);

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

        <AlertToggle state={alertState} onEnable={live.enableAlerts} />
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
          <button type="button" className="btn btn--danger" onClick={() => live.refetch()}>
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
          <span>تنبيه الطلبات الصوتي غير مفعّل. المتصفح يتطلب ضغطة واحدة لتفعيل الصوت.</span>
          <button type="button" className="btn btn--primary" onClick={() => live.enableAlerts()}>
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
                      live.acknowledge(order.id);
                      live.invalidate();
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

function groupByLane(orders: LiveOrder[]): Map<string, LiveOrder[]> {
  const grouped = new Map<string, LiveOrder[]>();
  for (const lane of ORDER_LANES) grouped.set(lane.key, []);
  for (const order of orders) grouped.get(order.status)?.push(order);
  return grouped;
}

function AlertToggle({ state, onEnable }: { state: AlertState; onEnable: () => void }) {
  return (
    <div
      className="alert-bar alert-bar--success"
      style={{ padding: 'var(--space-2) var(--space-3)' }}
    >
      <Icon name="volume" className="nav__icon" aria-hidden />
      <span>
        تنبيه صوتي للطلبات:{' '}
        <strong
          style={{ color: state.enabled ? 'var(--jibli-success-700)' : 'var(--jibli-danger-700)' }}
        >
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
  /** The card expands in place to ask, rather than committing on one tap (MERCH-2, §6). */
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [recalling, setRecalling] = useState(false);
  /**
   * A second click of a double-click fires before `isPending` re-renders, so a
   * ref is the guard that actually holds (MERCH-24).
   */
  const submitting = useRef(false);

  const runCommand = useMutation({
    mutationFn: async (
      action:
        | { name: 'accept'; minutes?: number }
        | { name: 'reject'; reason: string; note?: string }
        | { name: 'prepare' }
        | { name: 'ready' }
        | { name: 'unassign'; reason: string },
    ) => {
      switch (action.name) {
        case 'accept':
          return restaurantApi.acceptOrder(auth, order.id, order.version, action.minutes);
        case 'reject':
          return restaurantApi.rejectOrder(auth, order.id, {
            reason: action.reason,
            note: action.note,
            expectedVersion: order.version,
          });
        case 'prepare':
          return restaurantApi.startPreparing(auth, order.id, order.version);
        case 'ready':
          return restaurantApi.markReady(auth, order.id, order.version);
        case 'unassign':
          return restaurantApi.unassignDriver(auth, order.id, action.reason);
      }
    },
    onSuccess: () => {
      submitting.current = false;
      setError(null);
      setAccepting(false);
      setRejecting(false);
      setRecalling(false);
      onChanged();
    },
    onError: (mutationError: unknown) => {
      submitting.current = false;
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

  const run = (action: Parameters<typeof runCommand.mutate>[0]): void => {
    if (submitting.current) return;
    submitting.current = true;
    runCommand.mutate(action);
  };

  const slaTone =
    order.status === 'PENDING_RESTAURANT' && order.age_minutes >= SLA_LATE_MINUTES
      ? 'late'
      : order.age_minutes >= SLA_WARNING_MINUTES
        ? 'warning'
        : 'ok';

  const serviceFeeIqd = Math.max(
    0,
    order.customer_total_iqd - order.items_subtotal_iqd - order.delivery_fee_iqd,
  );
  const addressLines = describeAddress(order.delivery_address);

  return (
    <article
      className={`order-card${order.status === 'PENDING_RESTAURANT' ? ' order-card--new' : ''}`}
    >
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
        <span style={{ flex: 1 }}>{order.customer_name}</span>
        {/*
          A tappable number, not a line of text to read out (MERCH-1). The
          counter calls the customer back without copying digits.
        */}
        {order.customer_phone ? (
          <a
            className="order-card__call ltr-inline"
            href={`tel:${order.customer_phone}`}
            aria-label={`اتصال بالعميل ${order.customer_name}`}
          >
            <span aria-hidden>☏</span>
            {order.customer_phone}
          </a>
        ) : null}
      </div>

      {/* Where it goes — the district, the building/floor, the note the courier reads (MERCH-1). */}
      {addressLines.length > 0 ? (
        <p className="order-card__address">
          {addressLines.map((line, index) => (
            <span key={index} style={{ display: 'block' }}>
              {line}
            </span>
          ))}
        </p>
      ) : null}

      <div className="order-card__items">
        {order.items.map((item) => (
          <div className="order-card__item-block" key={item.id}>
            <div className="order-card__item">
              <span className="order-card__item-name">
                <span className="numeric">{item.quantity}</span> × {item.name_ar}
              </span>
              <span className="numeric">{money(item.line_total_iqd)}</span>
            </div>
            {/*
              The options the kitchen cooks to — «ويل دن، جبن إضافي» — and the
              per-line note. Without these the card said «برجر كلاسيك» and the
              kitchen cooked the wrong burger (MERCH-1).
            */}
            {item.modifiers.length > 0 ? (
              <div className="order-card__item-modifiers">
                {item.modifiers.map((modifier) => modifier.name_ar).join('، ')}
              </div>
            ) : null}
            {item.notes ? <div className="order-card__item-note">ملاحظة: {item.notes}</div> : null}
          </div>
        ))}
      </div>

      {order.customer_notes ? (
        <p className="order-card__note">ملاحظة الطلب: {order.customer_notes}</p>
      ) : null}

      {/* A subtotal / fee / service breakdown, not a bare total (MERCH-26). */}
      <div className="order-card__breakdown">
        <div className="order-card__breakdown-row">
          <span>المجموع الفرعي</span>
          <span className="numeric">{money(order.items_subtotal_iqd)}</span>
        </div>
        <div className="order-card__breakdown-row">
          <span>أجرة التوصيل (أجرتك)</span>
          <span className="numeric">{money(order.delivery_fee_iqd)}</span>
        </div>
        {serviceFeeIqd > 0 ? (
          <div className="order-card__breakdown-row">
            <span>رسوم خدمة جيبلي</span>
            <span className="numeric">{money(serviceFeeIqd)}</span>
          </div>
        ) : null}
        <div className="order-card__total">
          <span>المجموع (يدفعه الزبون)</span>
          <span className="numeric">{money(order.customer_total_iqd)}</span>
        </div>
      </div>

      <p className="order-card__payment">{paymentMethodAr(order.payment_method)}</p>

      {order.driver ? (
        <p className="order-card__note">
          المندوب: {order.driver.name} —{' '}
          {ASSIGNMENT_LABELS[order.driver.assignment_status] ?? order.driver.assignment_status}
        </p>
      ) : null}

      {error ? (
        <p className="alert-bar alert-bar--danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="order-card__actions" style={{ flexDirection: 'column' }}>
        {order.status === 'PENDING_RESTAURANT' && !accepting && !rejecting ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ flex: 2 }}
              disabled={runCommand.isPending}
              onClick={() => {
                setError(null);
                setAccepting(true);
              }}
            >
              {ACTIONS_AR.accept}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              style={{ flex: 1 }}
              disabled={runCommand.isPending}
              onClick={() => {
                setError(null);
                setRejectNote('');
                setRejecting(true);
              }}
            >
              {ACTIONS_AR.reject}
            </button>
          </div>
        ) : null}

        {/* How long the kitchen needs, on the tap that commits to it (MERCH-6). */}
        {order.status === 'PENDING_RESTAURANT' && accepting ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <strong style={{ fontSize: 'var(--text-sm)' }}>كم تحتاج لتجهيز الطلب؟</strong>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {PREP_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="btn btn--primary btn--sm"
                  style={{ flex: 1, minWidth: 56 }}
                  disabled={runCommand.isPending}
                  onClick={() => run({ name: 'accept', minutes })}
                >
                  {minutes}&nbsp;د
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={runCommand.isPending}
              onClick={() => setAccepting(false)}
            >
              تراجع
            </button>
          </div>
        ) : null}

        {/*
          The reason, asked in the card — the customer is told it, so a single
          tap with a hard-coded «TOO_BUSY» was wrong (MERCH-2).
        */}
        {order.status === 'PENDING_RESTAURANT' && rejecting ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <strong style={{ fontSize: 'var(--text-sm)' }}>سبب رفض الطلب</strong>
            <div className="field">
              <label htmlFor={`reject-note-${order.id}`} className="field__hint">
                ملاحظة للعميل (اختياري)
              </label>
              <input
                id={`reject-note-${order.id}`}
                value={rejectNote}
                onChange={(event) => setRejectNote(event.target.value)}
                placeholder="يُرسل مع السبب"
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {ORDER_REJECTION_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="btn btn--danger btn--sm"
                  disabled={runCommand.isPending}
                  onClick={() =>
                    run({ name: 'reject', reason, note: rejectNote.trim() || undefined })
                  }
                >
                  {ORDER_REJECTION_REASON_LABELS_AR[reason]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={runCommand.isPending}
              onClick={() => setRejecting(false)}
            >
              تراجع
            </button>
          </div>
        ) : null}

        {order.status === 'ACCEPTED' ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={runCommand.isPending}
            onClick={() => run({ name: 'prepare' })}
          >
            {ACTIONS_AR.startPreparing}
          </button>
        ) : null}

        {order.status === 'PREPARING' ? (
          /*
           * Green, because it is the one action on this card that finishes
           * something — the step that says the food is cooked.
           */
          <button
            type="button"
            className="btn btn--success btn--block"
            disabled={runCommand.isPending}
            onClick={() => run({ name: 'ready' })}
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

        {/*
          Recall a courier who was assigned but has not collected yet (MERCH-6).
          Once picked up it is on the road and no longer the shop's to pull back.
        */}
        {order.status === 'READY' &&
        order.driver &&
        (order.driver.assignment_status === 'ASSIGNED' ||
          order.driver.assignment_status === 'ACCEPTED') ? (
          recalling ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <strong style={{ fontSize: 'var(--text-sm)' }}>سحب الطلب من المندوب</strong>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                يصل المندوبَ إشعار بذلك، ويعود الطلب قابلاً للإسناد إلى غيره.
              </span>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {RECALL_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={runCommand.isPending}
                    onClick={() => run({ name: 'unassign', reason })}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={runCommand.isPending}
                onClick={() => setRecalling(false)}
              >
                تراجع
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setRecalling(true)}
            >
              سحب المندوب
            </button>
          )
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

/** The payment method in words — never the raw `CASH_ON_DELIVERY` code (MERCH-1). */
function paymentMethodAr(method: string): string {
  if (method === 'CASH' || method === 'CASH_ON_DELIVERY') return 'الدفع: نقداً عند الاستلام';
  return `الدفع: ${method}`;
}

/**
 * A readable address from the order's snapshot (MERCH-1).
 *
 * The snapshot's shape belongs to the API, so every field is read defensively.
 * Keys match what the order service stores: cityNameAr / districtText / street /
 * building / floor / landmark / deliveryNotes.
 */
function describeAddress(address: Record<string, unknown>): string[] {
  const read = (key: string): string | null => {
    const value = address?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  const lines: string[] = [];

  const where = [read('cityNameAr'), read('districtText'), read('street'), read('landmark')].filter(
    Boolean,
  );
  if (where.length > 0) lines.push(where.join(' — '));

  const place: string[] = [];
  const building = read('building');
  const floor = read('floor');
  if (building) place.push(`مبنى ${building}`);
  if (floor) place.push(`طابق ${floor}`);
  if (place.length > 0) lines.push(place.join(' · '));

  const notes = read('deliveryNotes');
  if (notes) lines.push(`ملاحظة العنوان: ${notes}`);

  return lines;
}

/**
 * Choosing who carries the order. Everything the server checks is shown rather
 * than hidden: a driver off shift or at their limit stays on the list, disabled,
 * with the reason next to their name.
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
  // Guards the second click of a double-click before `isPending` re-renders
  // (MERCH-24).
  const submitting = useRef(false);

  const drivers = useQuery({
    queryKey: ['eligible-drivers', auth.restaurantId, orderId],
    queryFn: () => restaurantApi.eligibleDrivers(auth),
    // Availability changes minute to minute; a cached list would offer someone
    // who has since gone off shift.
    staleTime: 0,
  });

  const assign = useMutation({
    mutationFn: (driverId: string) => restaurantApi.assignDriver(auth, orderId, driverId),
    onSuccess: () => {
      submitting.current = false;
      onAssigned();
    },
    onError: (assignError: unknown) => {
      submitting.current = false;
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
                if (submitting.current) return;
                submitting.current = true;
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
          <button type="button" className="btn btn--outline" onClick={onClose}>
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
