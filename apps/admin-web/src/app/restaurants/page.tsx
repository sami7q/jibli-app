'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  type MerchantType,
  CUISINES,
  OPERATIONAL_STATUSES,
  type OperationalStatus,
} from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import { AreaCoverageCard } from '@/components/area-coverage';
import { IssuePortalAccess } from '@/components/portal-credentials';
import {
  Badge,
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
import { admin, type AdminRestaurant } from '@/lib/admin-endpoints';
import { adminApi } from '@/lib/api';
import { SessionGate } from '@/components/session-gate';
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OperationalStatus | ''>('');
  /*
   * Which kind of partner. Empty is both, which is the directory as it was
   * before markets existed — and what an operator searching by name wants,
   * because they rarely remember which of the two a partner is.
   */
  const [merchantType, setMerchantType] = useState<MerchantType | ''>('');
  const [governorateId, setGovernorateId] = useState('');
  const [cityId, setCityId] = useState('');
  const [cuisine, setCuisine] = useState('');
  /** The restaurant whose owner is being given a username and password. */
  const [issuingFor, setIssuingFor] = useState<AdminRestaurant | null>(null);

  // Debounced so typing does not fire a request per keystroke (plan §74).
  const debouncedSearch = useDebounced(search, 350);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const restaurants = useQuery({
    queryKey: [
      'admin-restaurants',
      debouncedSearch,
      status,
      merchantType,
      governorateId,
      cityId,
      cuisine,
    ],
    queryFn: () =>
      admin.restaurants(token, {
        q: debouncedSearch || undefined,
        status: status || undefined,
        merchant_type: merchantType || undefined,
        governorate_id: governorateId || undefined,
        city_id: cityId || undefined,
        cuisine: cuisine || undefined,
      }),
    enabled: session.status === 'authenticated',
  });

  const governorates = useQuery({
    queryKey: ['admin-governorates'],
    queryFn: () => adminApi.governorates(token),
    enabled: session.status === 'authenticated',
    staleTime: 5 * 60_000,
  });

  /*
   * Cities for the chosen governorate only. Loading all of Iraq's cities into
   * one select produces a list nobody can use, and the pair is how an address
   * is actually written.
   */
  const cities = useQuery({
    queryKey: ['admin-cities', governorateId],
    queryFn: () => adminApi.cities(token, governorateId),
    enabled: session.status === 'authenticated' && governorateId !== '',
    staleTime: 5 * 60_000,
  });

  const selectArea = (area: { governorateId: string; cityId: string }) => {
    setGovernorateId(area.governorateId);
    setCityId(area.cityId);
  };

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  return (
    <AdminShell
      title="المطاعم"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        <Link className="btn btn--primary" href="/restaurants/new">
          إضافة مطعم
        </Link>
      }
    >
      <AreaCoverageCard
        token={token}
        selectedGovernorateId={governorateId}
        selectedCityId={cityId}
        onSelect={selectArea}
      />

      <Card>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            label="البحث عن مطعم"
            placeholder="اسم المطعم أو رقم الشريك…"
          />
          <Select
            value={governorateId}
            onChange={(value) => {
              setGovernorateId(value);
              // The chosen city belongs to the old governorate; keeping it
              // would filter to an impossible pair and show nothing.
              setCityId('');
            }}
            label="المحافظة"
            allLabel="كل المحافظات"
            options={(governorates.data ?? []).map((governorate) => ({
              value: governorate.id,
              label: governorate.name_ar,
            }))}
          />
          <Select
            value={cityId}
            onChange={setCityId}
            label="المدينة"
            allLabel={governorateId ? 'كل المدن' : 'اختر المحافظة أولاً'}
            options={(cities.data ?? []).map((city) => ({
              value: city.id,
              label: city.name_ar,
            }))}
          />
          <Select
            value={cuisine}
            onChange={setCuisine}
            label="التصنيف"
            allLabel="كل التصنيفات"
            options={CUISINES.map((entry) => ({
              value: entry.key,
              label: `${entry.emoji} ${entry.labelAr}`,
            }))}
          />
          {/*
            First among the filters, because it narrows the directory more than
            any other: an operator is usually working on one side of the
            business at a time.
          */}
          <Select
            value={merchantType}
            onChange={setMerchantType}
            label="النوع"
            allLabel="مطاعم وماركتات"
            options={MERCHANT_TYPES.map((value) => ({
              value,
              label: MERCHANT_TYPE_LABELS[value].nameAr,
            }))}
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
            emptyMessage={
              merchantType === 'MARKET' ? 'لا توجد ماركتات مطابقة' : 'لا توجد نتائج مطابقة'
            }
            columns={[
              {
                key: 'name',
                header: 'المطعم',
                render: (row) => (
                  <Link
                    href={`/restaurants/${row.id}`}
                    style={{ fontWeight: 700, color: 'inherit' }}
                  >
                    {row.display_name}
                    <span
                      className="ltr-inline"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--text-xs)',
                        marginInlineStart: 6,
                      }}
                    >
                      #{row.partner_code}
                    </span>
                  </Link>
                ),
              },
              {
                key: 'kind',
                header: 'النوع',
                /*
                 * Beside the name rather than at the end of the row.
                 *
                 * An operator scanning the directory is asking "which of these
                 * is a market" as they read the names, and a badge four
                 * columns away is answered by scrolling instead of looking.
                 */
                render: (row) => (
                  <Badge tone={row.merchant_type === 'MARKET' ? 'success' : 'neutral'}>
                    {
                      MERCHANT_TYPE_LABELS[(row.merchant_type ?? 'RESTAURANT') as MerchantType]
                        .nameAr
                    }
                  </Badge>
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
                key: 'access',
                header: 'حساب الدخول',
                render: (row) =>
                  row.has_portal_user ? (
                    <Badge tone="success">موجود</Badge>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      onClick={() => setIssuingFor(row)}
                    >
                      إنشاء حساب
                    </button>
                  ),
              },
              {
                key: 'commission',
                header: 'العمولة',
                numeric: true,
                render: (row) =>
                  row.commission_flat_iqd === null ? (
                    '—'
                  ) : (
                    <Money amount={row.commission_flat_iqd} />
                  ),
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

      {issuingFor ? (
        <IssuePortalAccess
          token={token}
          restaurantId={issuingFor.id}
          restaurantName={issuingFor.display_name}
          onIssued={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin-restaurants'] });
            void queryClient.invalidateQueries({ queryKey: ['portal-users', issuingFor.id] });
          }}
          onClose={() => setIssuingFor(null)}
        />
      ) : null}
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
