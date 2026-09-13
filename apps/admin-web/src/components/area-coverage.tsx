'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type AreaCoverage } from '@/lib/admin-endpoints';

/**
 * Where the restaurants are.
 *
 * The directory answers "which restaurants exist"; it cannot answer "how many
 * are actually trading in Karbala", because that means paging through it and
 * counting. This is the second question — and it lives behind a button, because
 * it is a question an operator asks sometimes, and a panel of counts sitting
 * permanently above the table pushes the table itself off the screen.
 *
 * Three numbers per row, and they are deliberately not one:
 *
 *   registered — on the platform at all
 *   active     — approved and switched on
 *   accepting  — active, with an open branch taking orders right now
 *
 * An area reading 12 / 12 / 0 is a different problem from one reading 12 / 0 /
 * 0, and a single "active" figure would hide which.
 */
export function AreaCoverageCard({
  token,
  selectedGovernorateId,
  selectedCityId,
  onSelect,
}: {
  token: string;
  selectedGovernorateId: string;
  selectedCityId: string;
  onSelect: (area: { governorateId: string; cityId: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const areas = useQuery({
    queryKey: ['admin-restaurants-by-area'],
    queryFn: () => admin.restaurantsByArea(token),
    // Only when the panel is open: a closed panel should not cost a grouped
    // scan on every visit to the directory.
    enabled: open,
    staleTime: 60_000,
  });

  const filtered = selectedGovernorateId !== '' || selectedCityId !== '';

  return (
    <Card
      title="المطاعم حسب المنطقة"
      icon="geography"
      subtitle={open ? 'اضغط على محافظة أو مدينة لتصفية القائمة' : undefined}
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {filtered ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onSelect({ governorateId: '', cityId: '' })}
            >
              إلغاء التصفية
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--outline btn--sm"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? 'إخفاء الجدول' : 'عرض الجدول'}
          </button>
        </div>
      }
    >
      {!open ? (
        <p className="area-hint">
          جدول بعدد المطاعم المسجّلة والمفعّلة والمستقبِلة للطلبات في كل محافظة ومدينة.
        </p>
      ) : areas.isError ? (
        <ErrorState
          message={areas.error instanceof ApiError ? areas.error.messageAr : 'تعذّر تحميل التغطية'}
          onRetry={() => void areas.refetch()}
        />
      ) : areas.isLoading ? (
        <Skeleton height={220} />
      ) : (
        <AreaTable
          areas={areas.data ?? []}
          expanded={expanded}
          selectedGovernorateId={selectedGovernorateId}
          selectedCityId={selectedCityId}
          onToggle={(id) => setExpanded((current) => (current === id ? null : id))}
          onSelect={onSelect}
        />
      )}
    </Card>
  );
}

function AreaTable({
  areas,
  expanded,
  selectedGovernorateId,
  selectedCityId,
  onToggle,
  onSelect,
}: {
  areas: AreaCoverage[];
  expanded: string | null;
  selectedGovernorateId: string;
  selectedCityId: string;
  onToggle: (governorateId: string) => void;
  onSelect: (area: { governorateId: string; cityId: string }) => void;
}) {
  // Areas Jibli has not opened and has no restaurants in are noise on a screen
  // about where the restaurants are.
  const shown = areas.filter((area) => area.total > 0 || area.is_enabled);

  const totals = areas.reduce(
    (sum, area) => ({
      total: sum.total + area.total,
      active: sum.active + area.active,
      accepting: sum.accepting + area.accepting,
    }),
    { total: 0, active: 0, accepting: 0 },
  );

  return (
    <div className="table-wrap">
      <table className="table area-table">
        <caption className="sr-only">المطاعم حسب المحافظة والمدينة</caption>
        <thead>
          <tr>
            <th scope="col">المنطقة</th>
            <th scope="col" className="numeric">
              مسجّل
            </th>
            <th scope="col" className="numeric">
              مفعّل
            </th>
            <th scope="col" className="numeric">
              يستقبل الآن
            </th>
            <th scope="col">التغطية</th>
          </tr>
        </thead>

        <tbody>
          {shown.map((governorate) => {
            const citiesWithRestaurants = governorate.cities.filter((city) => city.total > 0);
            const isOpen = expanded === governorate.id;

            return (
              // Keyed fragment: this branch returns a row plus its city rows,
              // and React needs the key on what the map returns, not inside it.
              <Fragment key={governorate.id}>
                <tr
                  className={
                    selectedGovernorateId === governorate.id && selectedCityId === ''
                      ? 'area-table__row area-table__row--on'
                      : 'area-table__row'
                  }
                >
                  <td>
                    <div className="area-table__name">
                      {citiesWithRestaurants.length > 0 ? (
                        <button
                          type="button"
                          className="area-table__expand"
                          onClick={() => onToggle(governorate.id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? 'إخفاء المدن' : 'عرض المدن'}
                        >
                          <Icon name="chevron" flip={!isOpen} className="nav__icon" aria-hidden />
                        </button>
                      ) : (
                        <span className="area-table__spacer" aria-hidden />
                      )}
                      <button
                        type="button"
                        className="area-table__link"
                        onClick={() => onSelect({ governorateId: governorate.id, cityId: '' })}
                      >
                        {governorate.name_ar}
                      </button>
                    </div>
                  </td>
                  <td className="numeric">{governorate.total}</td>
                  <td className="numeric">{governorate.active}</td>
                  <td className="numeric">
                    <strong
                      style={{
                        color:
                          governorate.accepting > 0
                            ? 'var(--jibli-success-700)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {governorate.accepting}
                    </strong>
                  </td>
                  <td>
                    {/*
                      The coverage switch, restated. A governorate with active
                      restaurants and ordering off looks identical to a healthy
                      one on a table that only counts.
                    */}
                    {!governorate.is_enabled ? (
                      <Badge tone="neutral">مغلقة</Badge>
                    ) : !governorate.ordering_enabled ? (
                      <Badge tone="warning">الطلبات مغلقة</Badge>
                    ) : (
                      <Badge tone="success">مفتوحة</Badge>
                    )}
                  </td>
                </tr>

                {isOpen
                  ? citiesWithRestaurants.map((city) => (
                      <tr
                        key={city.id}
                        className={
                          selectedCityId === city.id
                            ? 'area-table__city area-table__row--on'
                            : 'area-table__city'
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="area-table__link area-table__link--city"
                            onClick={() =>
                              onSelect({ governorateId: governorate.id, cityId: city.id })
                            }
                          >
                            {city.name_ar}
                          </button>
                        </td>
                        <td className="numeric">{city.total}</td>
                        <td className="numeric">{city.active}</td>
                        <td className="numeric">{city.accepting}</td>
                        <td>
                          {!city.ordering_enabled ? (
                            <Badge tone="warning">الطلبات مغلقة</Badge>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>

        <tfoot>
          <tr>
            <td>الإجمالي</td>
            <td className="numeric">{totals.total}</td>
            <td className="numeric">{totals.active}</td>
            <td className="numeric">{totals.accepting}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
