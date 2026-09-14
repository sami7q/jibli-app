'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DRIVER_AVAILABILITY_LABELS, JibliLogo, money, relativeAr } from '@jibli/ui-web';
import type { DriverAvailability } from '@jibli/contracts';
import { ApiError, apiRequest } from '@/lib/api';
import { driverApi, type DriverDelivery, type NavigationLinks } from '@/lib/driver-endpoints';
import { useDriverSession } from '@/hooks/use-driver-session';
import { Icon } from '@/components/icon';

/**
 * The courier's screen: one job at a time, and the way to it.
 *
 * Deliberately not a dashboard. A driver reads this on a phone, one-handed,
 * often while the engine is running — so it is a single column of the tasks
 * assigned to them, each carrying the two things the job needs: where it goes,
 * and what to press when it gets there. Everything a restaurant would want to
 * see about a delivery is on the restaurant's own board.
 *
 * The navigation link goes to whatever maps app the phone already has, with
 * the coordinates the customer pinned. No token, PIN or secret ever goes into
 * an external URL (plan §50) — the server builds these links and this only
 * follows them.
 */
export default function DriverPage() {
  const session = useDriverSession();
  const router = useRouter();

  if (session.status === 'loading') {
    return (
      <main className="auth">
        <div className="auth__card">
          <p>جارٍ التحميل…</p>
        </div>
      </main>
    );
  }

  if (session.status === 'unauthenticated') {
    return <SignedOutDriver reason={session.reason} onGo={() => router.replace('/driver/login')} />;
  }

  return <DriverShell session={session} />;
}

function SignedOutDriver({ reason, onGo }: { reason?: string; onGo: () => void }) {
  /*
   * Two different situations, and telling them apart is the whole point.
   *
   * FORBIDDEN here means the session is real but the account is not a driver —
   * usually a restaurant login that arrived at the wrong door. Anything else
   * is an expired or missing session, which signing in again fixes.
   */
  const notADriver = reason === 'FORBIDDEN' || reason === 'DRIVER_NOT_ACTIVE';

  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <JibliLogo size={40} tone="onLight" />
        </div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>
          {notADriver ? 'هذا الحساب ليس حساب مندوب' : 'انتهت الجلسة'}
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          {notADriver
            ? 'اطلب من المطعم إصدار بيانات دخول مندوب، أو ادخل إلى لوحة المطعم.'
            : 'أعد تسجيل الدخول للمتابعة.'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" onClick={onGo}>
            دخول المندوبين
          </button>
          {notADriver ? (
            <a className="btn btn--ghost" href="/">
              لوحة المطعم
            </a>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function DriverShell({
  session,
}: {
  session: Extract<ReturnType<typeof useDriverSession>, { status: 'ready' }>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, me } = session;

  const deliveries = useQuery({
    queryKey: ['driver-deliveries'],
    queryFn: () => driverApi.deliveries(accessToken, 'active'),
    // A new assignment can land at any moment and there is no realtime client
    // here; fifteen seconds is short enough that nobody waits on a refresh.
    refetchInterval: 15_000,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['driver-deliveries'] });
    session.refresh();
  };

  const availability = useMutation({
    mutationFn: (next: 'AVAILABLE' | 'OFFLINE') => driverApi.availability(accessToken, next),
    onSuccess: invalidate,
  });

  const signOut = useMutation({
    mutationFn: () => apiRequest('/api/v1/auth/session/logout', { method: 'POST' }),
    onSettled: () => router.replace('/driver/login'),
  });

  const online = me.availability !== 'OFFLINE';
  const list = deliveries.data ?? [];

  return (
    <main className="driver">
      <header className="driver__bar">
        <JibliLogo size={28} tone="onLight" />

        <button
          type="button"
          className={`badge badge--${online ? 'ready' : 'done'}`}
          style={{ border: 'none', cursor: 'pointer' }}
          disabled={availability.isPending}
          onClick={() => availability.mutate(online ? 'OFFLINE' : 'AVAILABLE')}
        >
          {DRIVER_AVAILABILITY_LABELS[me.availability as DriverAvailability] ?? me.availability}
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => signOut.mutate()}
          style={{ marginInlineStart: 'auto' }}
        >
          خروج
        </button>
      </header>

      <div className="driver__body">
        {!online ? (
          <p className="alert-bar alert-bar--warning" role="status">
            أنت خارج الدوام الآن — لن تصلك طلبات جديدة. اضغط على الحالة بالأعلى لتصبح متاحاً.
          </p>
        ) : null}

        {deliveries.isLoading ? (
          <p>جارٍ تحميل الطلبات…</p>
        ) : deliveries.isError ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {deliveries.error instanceof ApiError
              ? deliveries.error.messageAr
              : 'تعذّر تحميل الطلبات'}
          </p>
        ) : list.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لا توجد طلبات معيّنة لك الآن</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              ستظهر هنا فور أن يعيّنك المطعم على طلب.
            </p>
          </div>
        ) : (
          list.map((delivery) => (
            <DeliveryCard
              key={delivery.assignment_id}
              delivery={delivery}
              accessToken={accessToken}
              onChanged={invalidate}
            />
          ))
        )}
      </div>
    </main>
  );
}

/** The two Arabic words for each state a courier's task can be in. */
const ASSIGNMENT_LABELS: Record<string, string> = {
  ASSIGNED: 'بانتظار قبولك',
  ACCEPTED: 'قبلت الطلب',
  PICKED_UP: 'استلمت الطلب',
  ARRIVED_CUSTOMER: 'وصلت إلى الزبون',
};

function DeliveryCard({
  delivery,
  accessToken,
  onChanged,
}: {
  delivery: DriverDelivery;
  accessToken: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  /*
   * The detail is fetched per card rather than folded into the list, because
   * it is the only thing that carries the navigation links — and those depend
   * on coordinates the list deliberately withholds for a finished job
   * (plan §107).
   */
  const detail = useQuery({
    queryKey: ['driver-delivery', delivery.assignment_id],
    queryFn: () => driverApi.delivery(accessToken, delivery.assignment_id),
  });

  const act = useMutation({
    mutationFn: (action: 'accept' | 'pickup' | 'arrived-customer') =>
      driverApi.transition(accessToken, delivery.assignment_id, action),
    onSuccess: () => {
      setError(null);
      onChanged();
      void detail.refetch();
    },
    onError: (caught: unknown) =>
      setError(caught instanceof ApiError ? caught.messageAr : 'تعذّر تنفيذ الإجراء'),
  });

  const confirm = useMutation({
    mutationFn: () =>
      driverApi.confirmDelivery(accessToken, delivery.assignment_id, pin.trim() || undefined),
    onSuccess: () => {
      setError(null);
      setPin('');
      onChanged();
    },
    onError: (caught: unknown) =>
      setError(caught instanceof ApiError ? caught.messageAr : 'تعذّر تأكيد التسليم'),
  });

  const address = delivery.delivery_address as Record<string, unknown>;
  const addressText = [address.districtText, address.street, address.building, address.landmark]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' — ');

  const busy = act.isPending || confirm.isPending;

  return (
    <article className="driver__task">
      <div className="driver__task-head">
        <span className="ltr-inline">#{delivery.public_order_number}</span>
        <span className="badge badge--new">
          {ASSIGNMENT_LABELS[delivery.status] ?? delivery.status}
        </span>
      </div>

      <h2 className="driver__task-title">{delivery.restaurant_name}</h2>
      <p className="driver__task-meta">{relativeAr(delivery.assigned_at)}</p>

      <div className="driver__row">
        <Icon name="drivers" className="nav__icon" aria-hidden />
        <div>
          <strong>{delivery.customer.name}</strong>
          {delivery.customer.phone ? (
            <div>
              <a className="driver__call" href={`tel:${delivery.customer.phone}`}>
                <span className="ltr-inline">{delivery.customer.phone}</span> — اتصال
              </a>
            </div>
          ) : null}
        </div>
      </div>

      <div className="driver__row">
        <Icon name="location" className="nav__icon" aria-hidden />
        <div>
          <strong>عنوان التوصيل</strong>
          <div className="driver__task-meta">{addressText || 'بلا تفاصيل إضافية'}</div>
        </div>
      </div>

      <NavigationButtons links={detail.data?.navigation} />

      <div className="driver__total">
        <span>المطلوب تحصيله نقداً</span>
        <strong className="numeric">{money(delivery.cash_to_collect_iqd)}</strong>
      </div>

      {error ? (
        <p className="alert-bar alert-bar--danger" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        One button, and only the next one.

        The API accepts four transitions and this offers whichever is due,
        because a courier holding a phone in one hand and food in the other
        should never have to decide which of four buttons applies now.
      */}
      {delivery.status === 'ASSIGNED' ? (
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={busy}
          onClick={() => act.mutate('accept')}
        >
          قبول الطلب
        </button>
      ) : delivery.status === 'ACCEPTED' ? (
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={busy}
          onClick={() => act.mutate('pickup')}
        >
          استلمت الطلب من المطعم
        </button>
      ) : delivery.status === 'PICKED_UP' ? (
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={busy}
          onClick={() => act.mutate('arrived-customer')}
        >
          وصلت إلى الزبون
        </button>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div className="field">
            <label htmlFor={`pin-${delivery.assignment_id}`}>رمز التسليم من الزبون</label>
            <input
              id={`pin-${delivery.assignment_id}`}
              dir="ltr"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              placeholder="1234"
            />
            <span className="field__hint">
              اسأل الزبون عن الرمز الظاهر في تطبيقه، ثم أكّد التسليم واستلام المبلغ.
            </span>
          </div>
          <button
            type="button"
            className="btn btn--success btn--block"
            disabled={busy}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? 'جارٍ التأكيد…' : 'تأكيد التسليم'}
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * Out to the phone's own maps app.
 *
 * Three links because three platforms disagree: `geo:` is Android's, Apple
 * Maps is iOS's, and the Google URL is the one that works in any browser. The
 * server decides what each contains; this only picks the one the device will
 * honour, and falls back to the universal link.
 */
function NavigationButtons({ links }: { links?: NavigationLinks }) {
  if (!links) return null;

  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {links.googleMaps ? (
        <a className="btn btn--primary" href={links.googleMaps} target="_blank" rel="noreferrer">
          <Icon name="location" className="nav__icon" aria-hidden />
          {links.hasCoordinates ? 'فتح الموقع في الخرائط' : 'بحث عن العنوان في الخرائط'}
        </a>
      ) : null}

      {/*
        * Waze only when there is a pin.
        *
        * It navigates to coordinates and has nothing to do with a landmark
        * address, so the server returns null for it without one — and a
        * button that is there half the time is better than a button that
        * opens an app with nowhere to go.
        */}
      {links.waze ? (
        <a className="btn btn--ghost" href={links.waze} target="_blank" rel="noreferrer">
          Waze
        </a>
      ) : null}

      {!links.hasCoordinates ? (
        <p className="driver__task-meta" style={{ width: '100%' }}>
          لم يحدّد الزبون موقعه على الخريطة — البحث بالعنوان تقريبي، واتصل به عند اللزوم.
        </p>
      ) : null}
    </div>
  );
}
