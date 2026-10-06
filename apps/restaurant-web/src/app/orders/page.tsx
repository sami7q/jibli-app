'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ORDER_STATUSES, type OrderStatus } from '@jibli/contracts';
import { money, ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError } from '@/lib/api';
import { portal, type HistoryOrder } from '@/lib/portal-endpoints';

/**
 * Order history (plan §30, §92).
 *
 * The live board is the home page; this is the record of what happened. Phone
 * numbers are masked here — a finished order is not a reason to hold a
 * customer's number on screen, and the plan makes masking the default rather
 * than an option.
 *
 * Paging is keyset: orders keep arriving while someone scrolls, and an offset
 * would make rows jump or repeat.
 */

/** Statuses an order can still be in while on the live board. */
const LIVE_STATUSES: OrderStatus[] = [
  'PLACED',
  'PENDING_RESTAURANT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
];

const HISTORY_STATUSES = ORDER_STATUSES.filter((status) => !LIVE_STATUSES.includes(status));

export default function OrdersPage() {
  return (
    <PortalPage permission="order.read" permissionLabelAr="قراءة الطلبات">
      {({ auth, can }) => <OrdersScreen auth={auth} canSeeCommission={can('finance.read')} />}
    </PortalPage>
  );
}

function OrdersScreen({ auth, canSeeCommission }: { auth: PortalAuth; canSeeCommission: boolean }) {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedSearch = useDebounced(search, 300);

  const history = useInfiniteQuery({
    queryKey: ['order-history', auth.restaurantId, status, debouncedSearch, from, to],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      portal.orderHistory(auth, {
        status: status || undefined,
        search: debouncedSearch || undefined,
        from: from || undefined,
        to: to || undefined,
        before: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
  });

  const rows = history.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <>
      <Card
        title="سجل الطلبات"
        icon="orders"
        subtitle="الطلبات المنتهية — المكتملة والملغاة والمرفوضة"
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            alignItems: 'center',
          }}
        >
          <div className="topbar__control">
            <label htmlFor="order-search" className="sr-only">
              البحث برقم الطلب
            </label>
            <input
              id="order-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="رقم الطلب…"
            />
          </div>

          <div className="topbar__control">
            <label htmlFor="order-status" className="sr-only">
              تصفية حسب الحالة
            </label>
            <select
              id="order-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as OrderStatus | '')}
              style={{
                border: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 'var(--text-sm)',
                outline: 'none',
              }}
            >
              <option value="">كل الحالات المنتهية</option>
              {HISTORY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ORDER_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="topbar__control">
            <label htmlFor="order-from" className="sr-only">
              من تاريخ
            </label>
            <input
              id="order-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div className="topbar__control">
            <label htmlFor="order-to" className="sr-only">
              إلى تاريخ
            </label>
            <input
              id="order-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          {status || search || from || to ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setStatus('');
                setSearch('');
                setFrom('');
                setTo('');
              }}
            >
              مسح التصفية
            </button>
          ) : null}
        </div>
      </Card>

      <Card title="النتائج">
        {history.isError ? (
          <ErrorState
            message={
              history.error instanceof ApiError ? history.error.messageAr : 'تعذّر تحميل الطلبات'
            }
            code={history.error instanceof ApiError ? history.error.code : undefined}
            onRetry={() => void history.refetch()}
          />
        ) : null}

        {history.isLoading ? <Skeleton height={320} /> : null}

        {!history.isLoading && rows.length === 0 && !history.isError ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لا توجد طلبات مطابقة</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              جرّب توسيع المدة أو مسح التصفية.
            </p>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <>
            <OrdersTable rows={rows} canSeeCommission={canSeeCommission} />

            {history.hasNextPage ? (
              <div style={{ marginBlockStart: 'var(--space-4)', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {history.isFetchingNextPage ? 'جاري التحميل…' : 'تحميل المزيد'}
                </button>
              </div>
            ) : (
              <p
                style={{
                  marginBlockStart: 'var(--space-4)',
                  marginBlockEnd: 0,
                  textAlign: 'center',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                }}
              >
                عُرضت كل النتائج المطابقة
              </p>
            )}
          </>
        ) : null}
      </Card>
    </>
  );
}

function OrdersTable({
  rows,
  canSeeCommission,
}: {
  rows: HistoryOrder[];
  canSeeCommission: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">رقم الطلب</th>
            <th scope="col">الحالة</th>
            <th scope="col">العميل</th>
            <th scope="col">المندوب</th>
            <th scope="col" className="numeric">
              الإجمالي
            </th>
            {canSeeCommission ? (
              <th scope="col" className="numeric">
                العمولة
              </th>
            ) : null}
            {canSeeCommission ? (
              <th scope="col" className="numeric">
                صافيك
              </th>
            ) : null}
            <th scope="col">التاريخ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <tr key={order.id}>
              <td>
                <span className="ltr-inline">{order.public_order_number}</span>
                {order.closing_reason ? (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    {order.closing_reason}
                  </div>
                ) : null}
              </td>
              <td>
                <span
                  className={`badge badge--${ORDER_STATUS_TONE[order.status as OrderStatus] ?? 'done'}`}
                >
                  {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                </span>
              </td>
              <td>
                {order.customer_name}
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  <span className="ltr-inline">{order.customer_phone_masked}</span>
                </div>
              </td>
              <td>{order.driver_name ?? '—'}</td>
              <td className="numeric">
                {money(order.customer_total_iqd)}
                {order.discount_total_iqd > 0 ? (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    خصم {money(order.discount_total_iqd)}
                  </div>
                ) : null}
              </td>
              {canSeeCommission ? (
                <td className="numeric" style={{ color: 'var(--jibli-danger-700)' }}>
                  {money(order.commission_amount_iqd)}
                </td>
              ) : null}
              {canSeeCommission ? (
                <td className="numeric">
                  <strong>{money(order.restaurant_net_iqd)}</strong>
                </td>
              ) : null}
              <td>
                <span className="ltr-inline">
                  {new Date(order.placed_at).toLocaleString('ar-IQ', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
