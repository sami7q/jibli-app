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

/**
 * What a single change can be about. `active` is `is_enabled` — the master
 * switch that gates all three capabilities, and the one the table never
 * offered, which is what made turning anything on impossible.
 */
type ChangeTarget = Capability | 'active';

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

/** The request body field each target writes. */
const PATCH_FIELD: Record<ChangeTarget, string> = {
  active: 'is_enabled',
  customer_signup: 'customer_signup_enabled',
  restaurant_onboarding: 'restaurant_onboarding_enabled',
  ordering: 'ordering_enabled',
};

const TARGET_LABELS: Record<ChangeTarget, string> = {
  ...CAPABILITY_LABELS,
  active: 'تفعيل المنطقة',
};

interface PendingChange {
  readonly scope: 'governorate' | 'city';
  readonly id: string;
  readonly nameAr: string;
  readonly capability: ChangeTarget;
  readonly nextValue: boolean;
}

export function GeographyCoverage({
  token,
  canManage = true,
}: {
  token: string;
  /** Whether this role may change coverage; false disables every toggle (ADMIN-11). */
  canManage?: boolean;
}) {
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
        [PATCH_FIELD[change.capability]]: change.nextValue,
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
            <p
              className="card__subtitle"
              style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}
            >
              تفعيل قدرة على مستوى المحافظة يسري على كل مدنها. تعطيلها يوقف القدرة في كل المدن
              التابعة.
            </p>
          </div>
        </div>

        {governorates.isLoading ? (
          <div className="skeleton" style={{ height: 300 }} aria-hidden />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">المحافظات وقدرات التغطية المفعّلة لكل منها</caption>
              <thead>
                <tr>
                  <th scope="col">المحافظة</th>
                  <th scope="col">الرمز</th>
                  {/*
                    The master switch, and the reason this table was a dead end
                    before it appeared: every capability is read as
                    `is_enabled && flag`, so with the master off an operator
                    could turn a capability on, see it stay grey, and press it
                    again forever. The flag was changing; nothing could show it.
                  */}
                  <th scope="col">المحافظة مفعّلة</th>
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
                    <td>
                      <CapabilityToggle
                        enabled={governorate.is_enabled}
                        label="تفعيل المحافظة"
                        entityName={governorate.name_ar}
                        onToggle={() =>
                          requestChange({
                            scope: 'governorate',
                            id: governorate.id,
                            nameAr: governorate.name_ar,
                            capability: 'active',
                            nextValue: !governorate.is_enabled,
                          })
                        }
                        disabled={applyChange.isPending || !canManage}
                      />
                    </td>
                    {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((capability) => {
                      // The row's own flag, shown as itself. Whether it is in
                      // force is the master's business, and said separately.
                      const ownFlag = Boolean(governorate[CAPABILITY_FIELD[capability]]);
                      return (
                        <td key={capability}>
                          <CapabilityToggle
                            enabled={ownFlag}
                            blockedReason={
                              governorate.is_enabled
                                ? undefined
                                : 'المحافظة غير مفعّلة، فالقدرة لا تسري'
                            }
                            label={CAPABILITY_LABELS[capability]}
                            entityName={governorate.name_ar}
                            onToggle={() =>
                              requestChange({
                                scope: 'governorate',
                                id: governorate.id,
                                nameAr: governorate.name_ar,
                                capability,
                                nextValue: !ownFlag,
                              })
                            }
                            disabled={applyChange.isPending || !canManage}
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
              busy={applyChange.isPending || !canManage}
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
            <th scope="col">المدينة مفعّلة</th>
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
              <td>
                <CapabilityToggle
                  enabled={city.is_enabled}
                  blockedReason={parent?.is_enabled ? undefined : 'المحافظة غير مفعّلة'}
                  label="تفعيل المدينة"
                  entityName={city.name_ar}
                  onToggle={() =>
                    onToggle({
                      scope: 'city',
                      id: city.id,
                      nameAr: city.name_ar,
                      capability: 'active',
                      nextValue: !city.is_enabled,
                    })
                  }
                  disabled={busy}
                />
              </td>
              {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((capability) => {
                const field = CAPABILITY_FIELD[capability];
                const ownFlag = Boolean(city[field]);
                const parentAllows = Boolean(parent?.is_enabled && parent[field]);
                /*
                 * Three separate reasons a flag may be on without being in
                 * force, said one at a time. "It is not working" is not an
                 * answer an operator can act on; "the governorate is off" is.
                 */
                const blockedReason = !city.is_enabled
                  ? 'المدينة غير مفعّلة'
                  : !parent?.is_enabled
                    ? 'المحافظة غير مفعّلة'
                    : !parentAllows
                      ? 'القدرة معطّلة على مستوى المحافظة'
                      : undefined;

                return (
                  <td key={capability}>
                    <CapabilityToggle
                      enabled={ownFlag}
                      blockedReason={blockedReason}
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
  blockedReason,
  label,
  entityName,
  onToggle,
  disabled,
}: {
  /** The row's own flag, regardless of what gates it. */
  enabled: boolean;
  /**
   * Why the flag is on but not in force. Shown instead of a plain "on", so an
   * operator is never told a city is open when it is not.
   */
  blockedReason?: string | undefined;
  label: string;
  entityName: string;
  onToggle: () => void;
  disabled: boolean;
}) {
  const blocked = enabled && Boolean(blockedReason);
  const stateText = blocked ? 'لا يسري' : enabled ? 'مفعّل' : 'معطّل';
  const className = blocked
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
      aria-label={`${label} في ${entityName}: ${stateText}${
        blocked ? ` — ${blockedReason}` : ''
      }. اضغط للتغيير`}
      title={blocked ? blockedReason : undefined}
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
          تعطيل {TARGET_LABELS[change.capability]} في {change.nameAr}
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
