'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { dateAr, money } from '@jibli/ui-web';
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
import { adminApi } from '@/lib/api';
import { admin, type CommissionOverview } from '@/lib/admin-endpoints';
import { useDebounced } from '@/hooks/use-debounced';

/**
 * What Jibli has earned, and where it still is.
 *
 * The figure that matters on this screen is not the total — it is the part of
 * the total that has not been collected, because a flat 500 per order becomes
 * real money only once it leaves the restaurant's till. So "معلّقة" is the
 * headline and everything else is context for it.
 *
 * Read from completed orders rather than from issued statements: a statement
 * exists only after the worker closes a period, and an operator asking "how
 * much have we earned this month" is asking about the month that has not
 * closed.
 */

/** The ranges an operator actually asks for, as offsets from today. */
const RANGES = [
  { key: 'MONTH', labelAr: 'هذا الشهر' },
  { key: 'LAST_MONTH', labelAr: 'الشهر الماضي' },
  { key: 'WEEK', labelAr: 'آخر ٧ أيام' },
  { key: 'ALL', labelAr: 'منذ البداية' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/** Baghdad is UTC+3 with no daylight saving, so the day can be named directly. */
function baghdadToday(): Date {
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeToDays(range: RangeKey): { from?: string; to?: string } {
  const today = baghdadToday();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  switch (range) {
    case 'MONTH':
      return { from: isoDay(new Date(Date.UTC(year, month, 1))), to: isoDay(today) };
    case 'LAST_MONTH':
      return {
        from: isoDay(new Date(Date.UTC(year, month - 1, 1))),
        // Day zero of this month is the last day of the previous one.
        to: isoDay(new Date(Date.UTC(year, month, 0))),
      };
    case 'WEEK':
      return {
        from: isoDay(new Date(today.getTime() - 6 * 86_400_000)),
        to: isoDay(today),
      };
    case 'ALL':
      return {};
  }
}

export function CommissionOverviewCards({ token }: { token: string }) {
  const [range, setRange] = useState<RangeKey>('MONTH');
  const [governorateId, setGovernorateId] = useState('');
  const [cityId, setCityId] = useState('');
  const [settlement, setSettlement] = useState<'ALL' | 'SETTLED' | 'UNSETTLED'>('ALL');
  const [search, setSearch] = useState('');

  // Debounced so a request does not leave per keystroke; the query is three
  // grouped scans and typing "مطعم" should not fire five of them.
  const debouncedSearch = useDebounced(search, 350);
  const days = rangeToDays(range);

  const overview = useQuery({
    queryKey: [
      'admin-commission-overview',
      range,
      governorateId,
      cityId,
      settlement,
      debouncedSearch,
    ],
    queryFn: () =>
      admin.commissionOverview(token, {
        ...days,
        governorate_id: governorateId || undefined,
        city_id: cityId || undefined,
        settlement,
        q: debouncedSearch || undefined,
      }),
    // Money figures should not flicker between cached and fresh on every
    // filter change, but they must not go stale while someone is chasing a
    // payment either.
    staleTime: 30_000,
  });

  const governorates = useQuery({
    queryKey: ['admin-governorates'],
    queryFn: () => adminApi.governorates(token),
    staleTime: 5 * 60_000,
  });

  const cities = useQuery({
    queryKey: ['admin-cities', governorateId],
    queryFn: () => adminApi.cities(token, governorateId),
    enabled: governorateId !== '',
    staleTime: 5 * 60_000,
  });

  if (overview.isError) {
    return (
      <Card title="العمولات" icon="commissions">
        <ErrorState
          message={
            overview.error instanceof ApiError ? overview.error.messageAr : 'تعذّر حساب العمولات'
          }
          onRetry={() => void overview.refetch()}
        />
      </Card>
    );
  }

  const data = overview.data;

  return (
    <>
      <Card
        title="العمولات"
        icon="commissions"
        subtitle="محسوبة من الطلبات المكتملة، بالقيمة المثبّتة على كل طلب"
      >
        <FilterBar>
          <Select
            value={range}
            onChange={(value) => setRange((value || 'MONTH') as RangeKey)}
            label="الفترة"
            options={RANGES.map((entry) => ({ value: entry.key, label: entry.labelAr }))}
          />
          <Select
            value={governorateId}
            onChange={(value) => {
              setGovernorateId(value);
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
            value={settlement}
            onChange={(value) =>
              setSettlement((value || 'ALL') as 'ALL' | 'SETTLED' | 'UNSETTLED')
            }
            label="حالة التحصيل"
            options={[
              { value: 'ALL', label: 'الكل' },
              { value: 'UNSETTLED', label: 'غير محصّلة' },
              { value: 'SETTLED', label: 'ضمن كشف' },
            ]}
          />
        </FilterBar>

        {overview.isLoading || !data ? (
          <Skeleton height={120} />
        ) : (
          <div className="kpi-row">
            <Kpi
              label="إجمالي العمولة"
              value={money(data.totals.commission_iqd)}
              tone="primary"
            />
            <Kpi
              label="معلّقة لدى المطاعم"
              value={money(data.totals.outstanding_iqd)}
              tone="warning"
              note="مكتسبة ولم تدخل كشفاً بعد"
            />
            <Kpi label="عدد الطلبات" value={String(data.totals.order_count)} />
            <Kpi label="المطاعم" value={String(data.totals.restaurant_count)} />
            <Kpi label="مبيعات الفترة" value={money(data.totals.gross_sales_iqd)} />
          </div>
        )}
      </Card>

      <Card title="حسب المنطقة" icon="geography" subtitle="المحافظة ثم المدينة">
        {overview.isLoading || !data ? (
          <Skeleton height={200} />
        ) : data.by_area.length === 0 ? (
          <p className="empty">لا توجد طلبات مكتملة في هذه الفترة</p>
        ) : (
          <div className="area-money">
            {data.by_area.map((governorate) => (
              <div key={governorate.id} className="area-money__block">
                <div className="area-money__head">
                  <button
                    type="button"
                    className="area__name"
                    onClick={() => {
                      setGovernorateId(governorate.id);
                      setCityId('');
                    }}
                  >
                    {governorate.name_ar}
                  </button>
                  <strong>{money(governorate.commission_iqd)}</strong>
                </div>
                <div className="area-money__bar" aria-hidden>
                  <span
                    style={{
                      // Share of the largest governorate, so the eye compares
                      // areas rather than reading five identical bars.
                      inlineSize: `${Math.max(
                        2,
                        Math.round(
                          (governorate.commission_iqd /
                            Math.max(1, data.by_area[0]?.commission_iqd ?? 1)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                <ul className="area-money__cities">
                  {governorate.cities.map((city) => (
                    <li key={city.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setGovernorateId(governorate.id);
                          setCityId(city.id);
                        }}
                      >
                        <span>{city.name_ar}</span>
                        <span className="area-money__city-value">
                          {money(city.commission_iqd)}
                          {city.outstanding_iqd > 0 ? (
                            <em>{money(city.outstanding_iqd)} معلّقة</em>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="حسب المطعم"
        icon="restaurants"
        subtitle="الأكثر تعليقاً للعمولة أولاً"
      >
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            label="بحث عن مطعم"
            placeholder="اسم المطعم أو رقم الشريك…"
          />
        </FilterBar>

        {overview.isLoading || !data ? (
          <Skeleton height={260} />
        ) : (
          <>
            <DataTable<CommissionOverview['by_restaurant'][number]>
              caption="عمولة كل مطعم"
              rows={data.by_restaurant}
              keyOf={(row) => row.restaurant_id}
              emptyMessage="لا توجد طلبات مكتملة مطابقة"
              columns={[
                {
                  key: 'name',
                  header: 'المطعم',
                  render: (row) => (
                    <Link
                      href={`/restaurants/${row.restaurant_id}`}
                      style={{ color: 'inherit', fontWeight: 700 }}
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
                  key: 'area',
                  header: 'المنطقة',
                  render: (row) => `${row.governorate_name_ar} - ${row.city_name_ar}`,
                },
                { key: 'orders', header: 'الطلبات', numeric: true, render: (row) => row.order_count },
                {
                  key: 'sales',
                  header: 'المبيعات',
                  numeric: true,
                  render: (row) => <Money amount={row.gross_sales_iqd} />,
                },
                {
                  key: 'commission',
                  header: 'العمولة',
                  numeric: true,
                  render: (row) => <Money amount={row.commission_iqd} />,
                },
                {
                  key: 'outstanding',
                  header: 'معلّقة',
                  numeric: true,
                  render: (row) =>
                    row.outstanding_iqd > 0 ? (
                      <strong style={{ color: 'var(--jibli-warning-700)' }}>
                        <Money amount={row.outstanding_iqd} />
                      </strong>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    ),
                },
                {
                  key: 'last',
                  header: 'آخر طلب',
                  render: (row) => (row.last_order_at ? dateAr(row.last_order_at) : '—'),
                },
              ]}
            />

            {data.truncated ? (
              <p className="alert-bar alert-bar--warning" role="status">
                <span>
                  معروض أعلى ٢٠٠ مطعم في هذه الفترة. ضيّق النطاق بالمحافظة أو البحث لرؤية البقية.
                </span>
              </p>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'primary' | 'warning';
}) {
  return (
    <div className={`kpi${tone ? ` kpi--${tone}` : ''}`}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      {note ? <span className="kpi__note">{note}</span> : null}
    </div>
  );
}
