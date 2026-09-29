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
import { formatIraqiPhoneNational } from '@jibli/validation';
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
 * The merchant directory (plan §87), for either half of the marketplace.
 *
 * The column that matters most is the last one: an operator's usual question is
 * "why is this restaurant not receiving orders?", and the answer is almost
 * always one of approval, activation, branch state or city coverage — so all
 * four are visible in the row rather than three clicks away.
 *
 * One component, two routes. `/restaurants` leaves the kind open — its type
 * filter defaults to «مطاعم وماركتات», because somebody searching a partner by
 * name rarely remembers which of the two it is. `/markets` fixes it, and then
 * every word on the screen can be a market's: the title, the button, the
 * search placeholder, the empty state, the column header.
 *
 * The alternative was a second page, and a second page is how the two drift —
 * a column added to one directory and not the other, a filter fixed in one
 * place. Markets are a kind of merchant here for exactly the same reason they
 * are one column in the database rather than a parallel set of tables.
 */

/** The words that change with the kind of merchant the screen is showing. */
const COPY = {
  RESTAURANT: {
    title: 'المطاعم',
    add: 'إضافة مطعم',
    searchLabel: 'البحث عن مطعم',
    searchPlaceholder: 'اسم المطعم أو رقم الشريك…',
    nameHeader: 'المطعم',
    caption: 'قائمة المطاعم وحالتها',
    loadError: 'تعذّر تحميل قائمة المطاعم',
    empty: 'لا توجد نتائج مطابقة',
  },
  MARKET: {
    title: 'الماركتات',
    add: 'إضافة ماركت',
    searchLabel: 'البحث عن ماركت',
    searchPlaceholder: 'اسم الماركت أو رقم الشريك…',
    nameHeader: 'الماركت',
    caption: 'قائمة الماركتات وحالتها',
    loadError: 'تعذّر تحميل قائمة الماركتات',
    empty: 'لا توجد ماركتات مطابقة',
  },
  COSMETICS: {
    title: 'متاجر التجميل',
    add: 'إضافة متجر تجميل',
    searchLabel: 'البحث عن متجر تجميل',
    searchPlaceholder: 'اسم المتجر أو رقم الشريك…',
    nameHeader: 'المتجر',
    caption: 'قائمة متاجر التجميل وحالتها',
    loadError: 'تعذّر تحميل قائمة متاجر التجميل',
    empty: 'لا توجد متاجر تجميل مطابقة',
  },
  /** Both, which is what the restaurant directory shows unless told otherwise. */
  BOTH: {
    title: 'المطاعم',
    add: 'إضافة مطعم',
    searchLabel: 'البحث عن مطعم',
    searchPlaceholder: 'اسم المطعم أو رقم الشريك…',
    nameHeader: 'المطعم',
    caption: 'قائمة المطاعم وحالتها',
    loadError: 'تعذّر تحميل قائمة المطاعم',
    empty: 'لا توجد نتائج مطابقة',
  },
} as const;

/** Each section's badge, in its own colour where the palette has one. */
const KIND_TONE: Record<MerchantType, 'neutral' | 'success' | 'rose'> = {
  RESTAURANT: 'neutral',
  MARKET: 'success',
  COSMETICS: 'rose',
};

const STATUS_LABELS: Record<OperationalStatus, string> = {
  PENDING: 'قيد الإعداد',
  ACTIVE: 'نشط',
  PAUSED: 'متوقف مؤقتاً',
  SUSPENDED: 'موقوف',
};

export function MerchantDirectory({ only }: { only?: MerchantType }) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OperationalStatus | ''>('');
  /*
   * Which kind of partner. Empty is both, which is the directory as it was
   * before markets existed — and what an operator searching by name wants,
   * because they rarely remember which of the two a partner is.
   */
  const [merchantType, setMerchantType] = useState<MerchantType | ''>(only ?? '');

  /*
   * What this screen is called. A directory fixed to one kind describes itself
   * in that kind's words; the open one keeps the words it had.
   */
  const copy = COPY[only ?? 'BOTH'];
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
      title={copy.title}
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        <Link
          className="btn btn--primary"
          // The create form reads this and opens on the right kind, so the
          // button on the markets screen cannot land on a restaurant form.
          href={only && only !== 'RESTAURANT' ? `/restaurants/new?type=${only}` : '/restaurants/new'}
        >
          {copy.add}
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
            label={copy.searchLabel}
            placeholder={copy.searchPlaceholder}
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

            Absent on a screen that is already one side of it — a filter whose
            only valid value is the one it is fixed at is a control that can
            only be set wrong.
          */}
          {only ? null : (
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
          )}
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
                : copy.loadError
            }
            code={restaurants.error instanceof ApiError ? restaurants.error.code : undefined}
            onRetry={() => void restaurants.refetch()}
          />
        ) : restaurants.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AdminRestaurant>
            caption={copy.caption}
            rows={restaurants.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage={
              merchantType ? COPY[merchantType].empty : copy.empty
            }
            columns={[
              {
                key: 'name',
                header: copy.nameHeader,
                /*
                 * Name, then the two things you need about it.
                 *
                 * All three used to sit on one line inside the link: an Arabic
                 * name, then a Latin partner code, both underlined, in a
                 * right-to-left cell. The bidirectional run put the `#` on the
                 * wrong side of the code, the underline ran through the gap
                 * between two things that are not the same thing, and the code
                 * — which nobody clicks — was styled as part of the link.
                 *
                 * Now the name is the link and the rest is a quiet second
                 * line. The owner's number joins it there rather than taking a
                 * tenth column, because it is read in the same glance as the
                 * name and never sorted or compared down the page: almost
                 * every reason to look at this row ends with calling that
                 * number, and it used to be three clicks away.
                 */
                render: (row) => (
                  <div className="merchant-cell">
                    <Link href={`/restaurants/${row.id}`} className="merchant-cell__name">
                      {row.display_name}
                    </Link>
                    <span className="merchant-cell__meta">
                      <span className="ltr-inline">{row.partner_code}</span>
                      {row.owner_phone ? (
                        <>
                          <span className="merchant-cell__dot" aria-hidden>
                            ·
                          </span>
                          {/*
                            A real `tel:` link. On the tablet this portal is
                            actually used from, that is the difference between
                            calling a partner and reading their number aloud to
                            a second device.
                          */}
                          <a
                            href={`tel:${row.owner_phone}`}
                            className="merchant-cell__phone ltr-inline"
                            title={row.owner_name ?? undefined}
                          >
                            {formatIraqiPhoneNational(row.owner_phone)}
                          </a>
                        </>
                      ) : (
                        <>
                          <span className="merchant-cell__dot" aria-hidden>
                            ·
                          </span>
                          <span className="merchant-cell__missing">لا رقم للمالك</span>
                        </>
                      )}
                    </span>
                  </div>
                ),
              },
              ...(only
                ? []
                : [{
                key: 'kind',
                header: 'النوع',
                /*
                 * Beside the name rather than at the end of the row.
                 *
                 * An operator scanning the directory is asking "which of these
                 * is a market" as they read the names, and a badge four
                 * columns away is answered by scrolling instead of looking.
                 */
                render: (row: AdminRestaurant) => (
                  <Badge tone={KIND_TONE[(row.merchant_type ?? 'RESTAURANT') as MerchantType]}>
                    {
                      MERCHANT_TYPE_LABELS[(row.merchant_type ?? 'RESTAURANT') as MerchantType]
                        .nameAr
                    }
                  </Badge>
                ),
              }]),
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
