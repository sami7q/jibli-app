'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, relativeAr } from '@jibli/ui-web';
import { ORDER_STATUSES, type OrderStatus } from '@jibli/contracts';
import { AdminShell, ForbiddenShell } from '@/components/shell';
import {
  Card,
  DataTable,
  ErrorState,
  FilterBar,
  Money,
  Pager,
  SearchInput,
  Select,
  Skeleton,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type AdminOrder } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';
import { useDebounced } from '@/hooks/use-debounced';

const PAGE_SIZE = 25;

/**
 * The global order list, shared by three routes (plan §87).
 *
 * All, live and cancelled are the same table under a different filter, so they
 * share one component rather than three near-identical pages that drift.
 *
 * It lives here rather than in a route file because Next allows a page module
 * to export only `default` and its own reserved names — a second export from
 * `app/orders/page.tsx` fails the production build.
 */
export function OrderListScreen({
  scope,
  title,
  subtitle,
}: {
  scope: 'all' | 'live' | 'cancelled';
  title: string;
  subtitle?: string;
}) {
  const session = useAdminSession();
  const searchParams = useSearchParams();
  // Pre-fill from the header search («?q=»): typing an order number there and
  // pressing Enter lands here already filtered (ADMIN-18).
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const debouncedSearch = useDebounced(search, 350);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const orders = useQuery({
    queryKey: ['admin-orders', scope, debouncedSearch, status, offset],
    queryFn: () =>
      admin.ordersPaged(token, {
        scope,
        q: debouncedSearch || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: session.status === 'authenticated',
    // Live orders move; a stale board is misleading in a way a stale archive
    // is not.
    refetchInterval: scope === 'live' ? 15_000 : false,
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }
  if (!session.can('order.read.global')) {
    return <ForbiddenShell session={session} requiredAr="قراءة الطلبات" />;
  }

  const rows = orders.data?.data ?? [];
  const total = Number(orders.data?.meta.total ?? rows.length);

  // A filter change makes the current offset meaningless; reset to the first
  // page when the search or status moves.
  const resetAnd =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setOffset(0);
      setter(value);
    };

  return (
    <AdminShell
      title={title}
      {...(subtitle ? { subtitle } : {})}
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      liveOrders={scope === 'live' ? total : 0}
    >
      <Card>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={resetAnd(setSearch)}
            label="البحث عن طلب"
            placeholder="رقم الطلب أو اسم العميل…"
          />
          {scope === 'all' ? (
            <Select
              value={status}
              onChange={resetAnd(setStatus)}
              label="حالة الطلب"
              allLabel="كل الحالات"
              options={ORDER_STATUSES.map((value) => ({
                value,
                label: ORDER_STATUS_LABELS[value],
              }))}
            />
          ) : null}
        </FilterBar>

        {orders.isError ? (
          <ErrorState
            message={
              orders.error instanceof ApiError ? orders.error.messageAr : 'تعذّر تحميل الطلبات'
            }
            code={orders.error instanceof ApiError ? orders.error.code : undefined}
            onRetry={() => void orders.refetch()}
          />
        ) : orders.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AdminOrder>
            caption="قائمة الطلبات"
            rows={rows}
            keyOf={(row) => row.id}
            emptyMessage={scope === 'live' ? 'لا توجد طلبات نشطة الآن' : 'لا توجد طلبات مطابقة'}
            columns={[
              {
                key: 'number',
                header: 'رقم الطلب',
                render: (row) => (
                  <Link
                    href={`/orders/${row.id}`}
                    className="ltr-inline"
                    style={{ fontWeight: 700, color: 'inherit' }}
                  >
                    #{row.public_order_number}
                  </Link>
                ),
              },
              { key: 'restaurant', header: 'المطعم', render: (row) => row.restaurant_name },
              {
                key: 'customer',
                header: 'العميل',
                render: (row) => (
                  <span>
                    {row.customer_name}
                    <br />
                    {/*
                      Masked unless the role permits otherwise. The masked form
                      is still enough to match against a support call.
                    */}
                    <span
                      className="ltr-inline"
                      style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
                    >
                      {row.customer_phone}
                    </span>
                  </span>
                ),
              },
              { key: 'city', header: 'المدينة', render: (row) => row.city_name_ar },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) => (
                  <span className={`badge badge--${toneClass(row.status as OrderStatus)}`}>
                    {ORDER_STATUS_LABELS[row.status as OrderStatus]}
                  </span>
                ),
              },
              {
                key: 'total',
                header: 'المبلغ',
                numeric: true,
                render: (row) => <Money amount={row.customer_total_iqd} />,
              },
              {
                key: 'commission',
                header: 'العمولة',
                numeric: true,
                render: (row) => <Money amount={row.commission_amount_iqd} />,
              },
              { key: 'driver', header: 'المندوب', render: (row) => row.driver_name ?? '—' },
              {
                key: 'placed',
                header: 'الوقت',
                render: (row) => relativeAr(row.placed_at),
              },
            ]}
          />
        )}

        {!orders.isLoading && !orders.isError ? (
          <Pager offset={offset} pageSize={PAGE_SIZE} total={total} onOffsetChange={setOffset} />
        ) : null}
      </Card>
    </AdminShell>
  );
}

/** Map the shared status tone onto the admin badge classes. */
function toneClass(status: OrderStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (ORDER_STATUS_TONE[status]) {
    case 'done':
      return 'success';
    case 'ready':
      return 'success';
    case 'new':
    case 'progress':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}
