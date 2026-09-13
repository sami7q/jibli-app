'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type AreaCoverage } from '@/lib/admin-endpoints';

/**
 * Where the restaurants are.
 *
 * The directory answers "which restaurants exist"; it cannot answer "how many
 * are actually trading in Karbala", because that means paging through it and
 * counting. This is the second question, which is the one that decides where
 * onboarding effort goes.
 *
 * Three numbers per area, and they are deliberately not one:
 *
 *   registered — on the platform at all
 *   active     — approved and switched on
 *   accepting  — active, with an open branch taking orders right now
 *
 * A governorate where those read 12 / 12 / 0 is a different problem from one
 * that reads 12 / 0 / 0, and a single "active" figure would hide which.
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
  const [expanded, setExpanded] = useState<string | null>(null);

  const areas = useQuery({
    queryKey: ['admin-restaurants-by-area'],
    queryFn: () => admin.restaurantsByArea(token),
    staleTime: 60_000,
  });

  if (areas.isError) {
    return (
      <Card title="المطاعم حسب المنطقة" icon="geography">
        <ErrorState
          message={areas.error instanceof ApiError ? areas.error.messageAr : 'تعذّر تحميل التغطية'}
          onRetry={() => void areas.refetch()}
        />
      </Card>
    );
  }

  if (areas.isLoading) {
    return (
      <Card title="المطاعم حسب المنطقة" icon="geography">
        <Skeleton height={160} />
      </Card>
    );
  }

  const governorates = areas.data ?? [];
  // Areas Jibli has not opened and has no restaurants in are noise on a screen
  // about where the restaurants are.
  const shown = governorates.filter((g) => g.total > 0 || g.is_enabled);
  const totals = governorates.reduce(
    (sum, g) => ({
      total: sum.total + g.total,
      active: sum.active + g.active,
      accepting: sum.accepting + g.accepting,
    }),
    { total: 0, active: 0, accepting: 0 },
  );

  return (
    <Card
      title="المطاعم حسب المنطقة"
      icon="geography"
      subtitle="اضغط على محافظة أو مدينة لتصفية القائمة"
      actions={
        selectedGovernorateId || selectedCityId ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onSelect({ governorateId: '', cityId: '' })}
          >
            إلغاء التصفية
          </button>
        ) : undefined
      }
    >
      <div className="area-grid">
        {shown.map((governorate) => (
          <GovernorateTile
            key={governorate.id}
            governorate={governorate}
            isSelected={selectedGovernorateId === governorate.id && selectedCityId === ''}
            isExpanded={expanded === governorate.id}
            selectedCityId={selectedCityId}
            onToggle={() =>
              setExpanded((current) => (current === governorate.id ? null : governorate.id))
            }
            onSelect={onSelect}
          />
        ))}
      </div>

      <p className="area-total">
        الإجمالي: <strong>{totals.total}</strong> مطعماً مسجّلاً ·{' '}
        <strong>{totals.active}</strong> مفعّل · <strong>{totals.accepting}</strong> يستقبل طلبات
        الآن
      </p>
    </Card>
  );
}

function GovernorateTile({
  governorate,
  isSelected,
  isExpanded,
  selectedCityId,
  onToggle,
  onSelect,
}: {
  governorate: AreaCoverage;
  isSelected: boolean;
  isExpanded: boolean;
  selectedCityId: string;
  onToggle: () => void;
  onSelect: (area: { governorateId: string; cityId: string }) => void;
}) {
  const citiesWithRestaurants = governorate.cities.filter((city) => city.total > 0);

  return (
    <div className={`area${isSelected ? ' area--on' : ''}`}>
      <div className="area__head">
        <button
          type="button"
          className="area__name"
          onClick={() => onSelect({ governorateId: governorate.id, cityId: '' })}
        >
          {governorate.name_ar}
        </button>

        {/*
          The coverage switch, restated here. A governorate with active
          restaurants and ordering off looks identical to a healthy one on a
          screen that only counts.
        */}
        {!governorate.ordering_enabled ? (
          <span className="badge badge--warning">الطلبات مغلقة</span>
        ) : null}

        {citiesWithRestaurants.length > 0 ? (
          <button
            type="button"
            className="area__expand"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'إخفاء المدن' : 'عرض المدن'}
          >
            <Icon name="chevron" flip={!isExpanded} className="nav__icon" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="area__counts">
        <span className="area__count">
          <strong>{governorate.total}</strong> مسجّل
        </span>
        <span className="area__count area__count--active">
          <strong>{governorate.active}</strong> مفعّل
        </span>
        <span className="area__count area__count--live">
          <strong>{governorate.accepting}</strong> يستقبل
        </span>
      </div>

      {isExpanded ? (
        <ul className="area__cities">
          {citiesWithRestaurants.map((city) => (
            <li key={city.id}>
              <button
                type="button"
                className={`area__city${selectedCityId === city.id ? ' area__city--on' : ''}`}
                onClick={() =>
                  onSelect({ governorateId: governorate.id, cityId: city.id })
                }
              >
                <span>{city.name_ar}</span>
                <span className="area__city-counts">
                  {city.active}/{city.total}
                  {!city.ordering_enabled ? (
                    <span className="badge badge--warning">مغلقة</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
