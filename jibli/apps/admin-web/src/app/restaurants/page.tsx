'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { OPERATIONAL_STATUSES, type OperationalStatus } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import { Badge, Card, DataTable, ErrorState, FilterBar, SearchInput, Select, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type AdminRestaurant } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';
import { useDebounced } from '@/hooks/use-debounced';

/**
 * Restaurant directory (plan §87).
 *
 * The column that matters most is the last one: an operator's usual question is
 * "why is this restaurant not receiving orders?", and the answer is almost
 * always one of approval, activation, branch state or city coverage — so all
 * four are visible in the row rather than three clicks away.
 */

const STATUS_LABELS: Record<OperationalStatus, string> = {
  PENDING: 'قيد الإعداد',
  ACTIVE: 'نشط',
  PAUSED: 'متوقف مؤقتاً',
  SUSPENDED: 'موقوف',
};

export default function RestaurantsPage() {
  const session = useAdminSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OperationalStatus | ''>('');

  // Debounced so typing does not fire a request per keystroke (plan §74).
  const debouncedSearch = useDebounced(search, 350);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const restaurants = useQuery({
    queryKey: ['admin-restaurants', debouncedSearch, status],
    queryFn: () =>
      admin.restaurants(token, {
        q: debouncedSearch || undefined,
        status: status || undefined,
      }),
    enabled: session.status === 'authenticated',
  });

  if (session.status !== 'authenticated') {
    return (
      <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <h1>الرجاء تسجيل الدخول</h1>
      </div>
    );
  }

  return (
    <AdminShell
      title="المطاعم"
      subtitle="جميع المطاعم المسجّلة في المنصة وحالتها التشغيلية"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        <Link className="btn btn--primary" href="/restaurants/new">
          إضافة مطعم
        </Link>
      }
    >
      <Card>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            label="البحث عن مطعم"
            placeholder="اسم المطعم أو رقم الشريك…"
          />
          <Select
            value={status}
            onChange={setStatus}
            label="الحالة التشغيلية"
            allLabel="كل الحالات"
            options={OPERATIONAL_STATUSES.map((value) => ({
              value,
              label: STATUS_LABELS[value],
            }))}
          />
        </FilterBar>

        {restaurants.isError ? (
          <ErrorState
            message={
              restaurants.error instanceof ApiError
                ? restaurants.error.messageAr
                : 'تعذّر تحميل قائمة المطاعم'
            }
            code={restaurants.error instanceof ApiError ? restaurants.error.code : undefined}
            onRetry={() => void restaurants.refetch()}
          />
        ) : restaurants.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AdminRestaurant>
            caption="قائمة المطاعم وحالتها"
            rows={restaurants.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage="لا توجد مطاعم مطابقة"
            columns={[
              {
                key: 'name',
                header: 'المطعم',
                render: (row) => (
                  <Link href={`/restaurants/${row.id}`} style={{ fontWeight: 700, color: 'inherit' }}>
                    {row.display_name}
                    <span
                      className="ltr-inline"
                      style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginInlineStart: 6 }}
                    >
                      #{row.partner_code}
                    </span>
                  </Link>
                ),
              },
              {
                key: 'location',
                header: 'الموقع',
                render: (row) =>
                  row.city_name_ar ? `${row.governorate_name_ar} - ${row.city_name_ar}` : '—',
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) => (
                  <Badge
                    tone={
                      row.operational_status === 'ACTIVE'
                        ? 'success'
                        : row.operational_status === 'SUSPENDED'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {STATUS_LABELS[row.operational_status as OperationalStatus]}
                  </Badge>
                ),
              },
              {
                key: 'orderable',
                header: 'يستقبل طلبات',
                render: (row) => <OrderabilityCell row={row} />,
              },
              {
                key: 'commission',
                header: 'العمولة',
                numeric: true,
                render: (row) => row.commission_display ?? '—',
              },
              {
                key: 'orders',
                header: 'طلبات 7 أيام',
                numeric: true,
                render: (row) => row.orders_7d,
              },
              {
                key: 'rating',
                header: 'التقييم',
                numeric: true,
                render: (row) =>
                  row.rating ? `${row.rating.toFixed(1)} (${row.rating_count})` : '—',
              },
            ]}
          />
        )}
      </Card>
    </AdminShell>
  );
}

/**
 * Why a restaurant is or is not taking orders.
 *
 * Marketplace eligibility is a conjunction (plan §18), so showing a single
 * yes/no would hide which layer is blocking. This names the first failing one.
 */
function OrderabilityCell({ row }: { row: AdminRestaurant }) {
  if (row.operational_status !== 'ACTIVE') {
    return <Badge tone="neutral">غير مفعّل</Badge>;
  }
  if (!row.city_ordering_enabled) {
    return <Badge tone="warning">المدينة مغلقة</Badge>;
  }
  if (!row.branch_active) {
    return <Badge tone="warning">الفرع غير نشط</Badge>;
  }
  if (!row.accepts_orders) {
    return <Badge tone="warning">متوقف عن الاستقبال</Badge>;
  }
  return <Badge tone="success">نعم</Badge>;
}
