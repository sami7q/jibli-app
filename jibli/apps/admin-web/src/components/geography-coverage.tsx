'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, adminApi, type AdminCity, type AdminGovernorate } from '@/lib/api';
import { Icon } from './icon';

/**
 * Geography coverage management (plan §8.8, §114, §124, §127).
 *
 * Two things this screen must get right:
 *
 *  1. It shows EFFECTIVE capability, not the raw row. A city flagged enabled
 *     under a disabled governorate is not open, and displaying its own flag as
 *     "مفعّل" would mislead an operator into thinking a city is live (plan §8.6).
 *
 *  2. Disabling is a destructive action: it shows the affected counts, requires
 *     a written reason, and states plainly that existing orders continue
 *     (plan §114, §8.7).
 */

type Capability = 'customer_signup' | 'restaurant_onboarding' | 'ordering';

const CAPABILITY_LABELS: Record<Capability, string> = {
  customer_signup: 'تسجيل العملاء',
  restaurant_onboarding: 'انضمام المطاعم',
  ordering: 'الطلبات',
};

const CAPABILITY_FIELD: Record<Capability, keyof AdminGovernorate> = {
  customer_signup: 'customer_signup_enabled',
  restaurant_onboarding: 'restaurant_onboarding_enabled',
  ordering: 'ordering_enabled',
};

interface PendingChange {
  readonly scope: 'governorate' | 'city';
  readonly id: string;
  readonly nameAr: string;
  readonly capability: Capability;
  readonly nextValue: boolean;
}

export function GeographyCoverage({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [selectedGovernorate, setSelectedGovernorate] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const governorates = useQuery({
    queryKey: ['admin-governorates'],
    queryFn: () => adminApi.governorates(token),
  });

  const cities = useQuery({
    queryKey: ['admin-cities', selectedGovernorate],
    queryFn: () => adminApi.cities(token, selectedGovernorate ?? undefined),
    enabled: Boolean(selectedGovernorate),
  });

  const governorateById = useMemo(() => {
    const map = new Map<string, AdminGovernorate>();
    for (const g of governorates.data ?? []) map.set(g.id, g);
    return map;
  }, [governorates.data]);

  const applyChange = useMutation({
    mutationFn: async (change: PendingChange & { reason?: string }) => {
      const patch = {
        [CAPABILITY_FIELD[change.capability]]: change.nextValue,
        ...(change.reason ? { reason: change.reason } : {}),
      };
      return change.scope === 'governorate'
        ? adminApi.updateGovernorate(token, change.id, patch)
        : adminApi.updateCity(token, change.id, patch);
    },
    onSuccess: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-governorates'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-cities'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-coverage'] });
    },
  });

  /** Enabling is immediate; disabling opens the impact dialog first. */
  const requestChange = (change: PendingChange) => {
    if (change.nextValue) {
      applyChange.mutate(change);
      return;
    }
    setPending(change);
  };

  return (
    <>
      <section className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">
              <Icon name="geography" className="nav__icon" aria-hidden />
              المحافظات
            </h2>
            <p className="card__subtitle" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              تفعيل قدرة على مستوى المحافظة يسري على كل مدنها. تعطيلها يوقف القدرة في كل المدن التابعة.
            </p>
          </div>
        </div>

        {governorates.isLoading ? (
          <div className="skeleton" style={{ height: 300 }} aria-hidden />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                المحافظات وقدرات التغطية المفعّلة لكل منها
              </caption>
              <thead>
                <tr>
                  <th scope="col">المحافظة</th>
                  <th scope="col">الرمز</th>
                  {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((capability) => (
                    <th scope="col" key={capability}>
                      {CAPABILITY_LABELS[capability]}
                    </th>
                  ))}
                  <th scope="col">المدن</th>
                </tr>
              </thead>
              <tbody>
                {(governorates.data ?? []).map((governorate) => (
                  <tr key={governorate.id}>
                    <th scope="row" style={{ fontWeight: 700 }}>
                      {governorate.name_ar}
                    </th>
                    <td className="ltr-inline">{governorate.code}</td>
                    {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((capability) => {
                      const enabled =
                        governorate.is_enabled &&
                        Boolean(governorate[CAPABILITY_FIELD[capability]]);
                      return (
                        <td key={capability}>
                          <CapabilityToggle
                            enabled={enabled}
                            label={CAPABILITY_LABELS[capability]}
                            entityName={governorate.name_ar}
                            onToggle={() =>
                              requestChange({
                                scope: 'governorate',
                                id: governorate.id,
                                nameAr: governorate.name_ar,
                                capability,
                                nextValue: !enabled,
                              })
                            }
                            disabled={applyChange.isPending}
                          />
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() =>
                          setSelectedGovernorate(
                            selectedGovernorate === governorate.id ? null : governorate.id,
                          )
                        }
                        aria-expanded={selectedGovernorate === governorate.id}
                      >
                        {selectedGovernorate === governorate.id ? 'إخفاء المدن' : 'عرض المدن'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedGovernorate ? (
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">
              مدن {governorateById.get(selectedGovernorate)?.name_ar ?? ''}
            </h2>
          </div>

          {cities.isLoading ? (
            <div className="skeleton" style={{ height: 200 }} aria-hidden />
          ) : (
            <CityTable
              cities={cities.data ?? []}
              parent={governorateById.get(selectedGovernorate)}
              onToggle={requestChange}
              busy={applyChange.isPending}
            />
          )}
        </section>
      ) : null}

      {pending ? (
        <DisableDialog
          token={token}
          change={pending}
          onCancel={() => setPending(null)}
          onConfirm={(reason) => applyChange.mutate({ ...pending, reason })}
          isSubmitting={applyChange.isPending}
          error={applyChange.error instanceof ApiError ? applyChange.error.messageAr : null}
        />
      ) : null}
    </>
  );
}

function CityTable({
  cities,
  parent,
  onToggle,
  busy,
}: {
  cities: AdminCity[];
  parent: AdminGovernorate | undefined;
  onToggle: (change: PendingChange) => void;
  busy: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">المدينة</th>
            <th scope="col">الرمز</th>
            {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((capability) => (
              <th scope="col" key={capability}>
                {CAPABILITY_LABELS[capability]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cities.map((city) => (
            <tr key={city.id}>
              <th scope="row" style={{ fontWeight: 600 }}>
                {city.name_ar}
              </th>
              <td className="ltr-inline">{city.code}</td>
              {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((capability) => {
                const field = CAPABILITY_FIELD[capability];
                const ownFlag = city.is_enabled && Boolean(city[field]);
                const parentAllows = Boolean(parent?.is_enabled && parent[field]);
                // Effective state: the parent override made visible, so an
                // operator is never told a city is open when it is not.
                const effective = ownFlag && parentAllows;
                const blockedByParent = ownFlag && !parentAllows;

                return (
                  <td key={capability}>
                    <CapabilityToggle
                      enabled={effective}
                      blockedByParent={blockedByParent}
                      label={CAPABILITY_LABELS[capability]}
                      entityName={city.name_ar}
                      onToggle={() =>
                        onToggle({
                          scope: 'city',
                          id: city.id,
                          nameAr: city.name_ar,
                          capability,
                          nextValue: !ownFlag,
                        })
                      }
                      disabled={busy}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CapabilityToggle({
  enabled,
  blockedByParent,
  label,
  entityName,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  blockedByParent?: boolean;
  label: string;
  entityName: string;
  onToggle: () => void;
  disabled: boolean;
}) {
  const stateText = blockedByParent ? 'معطّل بالمحافظة' : enabled ? 'مفعّل' : 'معطّل';
  const className = blockedByParent
    ? 'capability capability--blocked'
    : enabled
      ? 'capability capability--on'
      : 'capability capability--off';

  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      disabled={disabled}
      style={{ border: 'none', cursor: disabled ? 'not-allowed' : 'pointer' }}
      // The full sentence is what a screen reader announces; the colour is
      // decoration (plan §134).
      aria-label={`${label} في ${entityName}: ${stateText}. اضغط للتغيير`}
      title={
        blockedByParent
          ? 'المدينة مفعّلة لكن المحافظة معطّلة، لذلك القدرة غير فعّالة'
          : undefined
      }
    >
      <Icon name={enabled ? 'check' : 'close'} className="nav__icon" aria-hidden />
      {stateText}
    </button>
  );
}

/**
 * Disable confirmation (plan §114).
 *
 * Shows affected counts, requires a reason, and states the consequence
 * explicitly before the operator can proceed.
 */
function DisableDialog({
  token,
  change,
  onCancel,
  onConfirm,
  isSubmitting,
  error,
}: {
  token: string;
  change: PendingChange;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const impact = useQuery({
    queryKey: ['coverage-impact', change.id],
    queryFn: () => adminApi.cityImpact(token, change.id),
    enabled: change.scope === 'city',
  });

  const reasonTooShort = reason.trim().length < 5;

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disable-dialog-title"
    >
      <div className="dialog">
        <h2 id="disable-dialog-title">
          تعطيل {CAPABILITY_LABELS[change.capability]} في {change.nameAr}
        </h2>

        <div className="dialog__impact">
          <strong>
            <Icon name="alert" className="nav__icon" aria-hidden /> تأثير هذا الإجراء
          </strong>

          {change.scope === 'city' && impact.data ? (
            <dl>
              <dt>مطاعم نشطة</dt>
              <dd className="numeric">{impact.data.active_restaurants}</dd>
              <dt>طلبات نشطة الآن</dt>
              <dd className="numeric">{impact.data.active_orders}</dd>
              <dt>حسابات عملاء</dt>
              <dd className="numeric">{impact.data.customer_profiles}</dd>
            </dl>
          ) : change.scope === 'city' ? (
            <div className="skeleton" style={{ height: 60 }} aria-hidden />
          ) : (
            <p style={{ margin: 0 }}>
              تعطيل القدرة على مستوى المحافظة يوقفها في كل المدن التابعة لها.
            </p>
          )}

          {/* The non-destructive guarantee, stated before confirmation (plan §8.7). */}
          <p style={{ margin: 0 }}>
            {impact.data?.note_ar ??
              'تعطيل الطلبات لا يحذف أي بيانات. الطلبات النشطة الحالية تكمل مسارها بشكل طبيعي.'}
          </p>
        </div>

        <div className="field">
          <label htmlFor="disable-reason">سبب التعطيل (مطلوب)</label>
          <textarea
            id="disable-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-describedby="disable-reason-hint"
            aria-invalid={touched && reasonTooShort}
          />
          <span id="disable-reason-hint" className="field__hint">
            يُسجَّل السبب في سجل الأنشطة ولا يمكن تعديله لاحقاً.
          </span>
          {touched && reasonTooShort ? (
            <span className="field__error">الرجاء كتابة سبب واضح (5 أحرف على الأقل)</span>
          ) : null}
        </div>

        {error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--danger"
            disabled={reasonTooShort || isSubmitting}
            onClick={() => onConfirm(reason.trim())}
          >
            {isSubmitting ? 'جاري التنفيذ…' : 'تأكيد التعطيل'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
