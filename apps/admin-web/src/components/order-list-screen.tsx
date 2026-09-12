'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, relativeAr } from '@jibli/ui-web';
import { ORDER_STATUSES, type OrderStatus } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import {
  Card,
  DataTable,
  ErrorState,
  FilterBar,
  Money,
  SearchInput,
  Select,
  Skeleton,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type AdminOrder } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';
import { useDebounced } from '@/hooks/use-debounced';

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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const debouncedSearch = useDebounced(search, 350);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const orders = useQuery({
    queryKey: ['admin-orders', scope, debouncedSearch, status],
    queryFn: () =>
      admin.orders(token, {
        scope,
        q: debouncedSearch || undefined,
        status: status || undefined,
      }),
    enabled: session.status === 'authenticated',
    // Live orders move; a stale board is misleading in a way a stale archive
    // is not.
    refetchInterval: scope === 'live' ? 15_000 : false,
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  return (
    <AdminShell
      title={title}
      {...(subtitle ? { subtitle } : {})}
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      liveOrders={scope === 'live' ? (orders.data?.length ?? 0) : 0}
    >
      <Card>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            label="البحث عن طلب"
            placeholder="رقم الطلب أو اسم العميل…"
          />
          {scope === 'all' ? (
            <Select
              value={status}
              onChange={setStatus}
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
            rows={orders.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage={
              scope === 'live' ? 'لا توجد طلبات نشطة الآن' : 'لا توجد طلبات مطابقة'
            }
            columns={[
              {
                key: 'number',
                header: 'رقم الطلب',
                render: (row) => (
                  <Link href={`/orders/${row.id}`} className="ltr-inline" style={{ fontWeight: 700, color: 'inherit' }}>
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
