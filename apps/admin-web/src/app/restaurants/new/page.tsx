'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { tryToE164Iraq, normalizeDigits } from '@jibli/validation';
import { AdminShell } from '@/components/shell';
import { Card, MfaChallenge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { adminApi, ApiError } from '@/lib/api';
import { admin } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Admin-created restaurant (plan §15.1).
 *
 * The geography selectors read from the master registry filtered by effective
 * restaurant-onboarding capability — Admin cannot type a city name, and cannot
 * silently place a restaurant in a closed area without an explicit, audited
 * override.
 */
export default function NewRestaurantPage() {
  const session = useAdminSession();
  const router = useRouter();
  const [needsMfa, setNeedsMfa] = useState(false);

  const [form, setForm] = useState({
    display_name: '',
    owner_name: '',
    owner_phone: '',
    governorate_id: '',
    city_id: '',
    address_text: '',
    commission_percent: 15,
    settlement_policy: 'HALF_MONTH' as 'HALF_MONTH' | 'MONTHLY',
    minimum_order_iqd: 0,
    delivery_fee_iqd: 2000,
    override_coverage: false,
    reason: '',
  });

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const governorates = useQuery({
    queryKey: ['admin-governorates'],
    queryFn: () => adminApi.governorates(token),
    enabled: session.status === 'authenticated',
  });

  const cities = useQuery({
    queryKey: ['admin-cities', form.governorate_id],
    queryFn: () => adminApi.cities(token, form.governorate_id),
    enabled: Boolean(form.governorate_id),
  });

  // Changing governorate invalidates the city: keeping a stale one would send a
  // mismatched pair the composite FK would reject anyway.
  useEffect(() => {
    setForm((current) => ({ ...current, city_id: '' }));
  }, [form.governorate_id]);

  const create = useMutation({
    mutationFn: () =>
      admin.createRestaurant(token, {
        display_name: form.display_name,
        owner_name: form.owner_name,
        owner_phone: form.owner_phone,
        governorate_id: form.governorate_id,
        city_id: form.city_id,
        address_text: form.address_text,
        commission_rate_bps: Math.round(form.commission_percent * 100),
        settlement_policy: form.settlement_policy,
        minimum_order_iqd: form.minimum_order_iqd,
        delivery_fee_iqd: form.delivery_fee_iqd,
        override_coverage: form.override_coverage,
        reason: form.reason || undefined,
      }),
    onSuccess: (result) => router.push(`/restaurants/${result.restaurant_id}`),
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) setNeedsMfa(true);
    },
  });

  if (session.status !== 'authenticated') {
    return (
      <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <h1>الرجاء تسجيل الدخول</h1>
      </div>
    );
  }

  const phoneResult = tryToE164Iraq(form.owner_phone);
  const selectedCity = (cities.data ?? []).find((city) => city.id === form.city_id);
  // The list already filters to onboarding-enabled cities; a chosen city whose
  // capability is off means Admin used an unfiltered path.
  const cityClosed = selectedCity ? !selectedCity.restaurant_onboarding_enabled : false;

  const canSubmit =
    form.display_name.trim().length >= 2 &&
    form.owner_name.trim().length >= 3 &&
    phoneResult.ok &&
    form.governorate_id !== '' &&
    form.city_id !== '' &&
    form.address_text.trim().length >= 5 &&
    (!cityClosed || (form.override_coverage && form.reason.trim().length >= 5)) &&
    !create.isPending;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <AdminShell
      title="إضافة مطعم"
      subtitle="إنشاء مطعم وحساب مالكه مباشرة دون المرور بطلب انضمام"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <Card title="بيانات المطعم" icon="restaurants">
        <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 640 }}>
          <div className="field">
            <label htmlFor="display_name">اسم المطعم</label>
            <input
              id="display_name"
              value={form.display_name}
              onChange={(event) => set('display_name', event.target.value)}
              placeholder="مطعم البيت العراقي"
            />
          </div>

          <div className="field">
            <label htmlFor="owner_name">اسم المالك</label>
            <input
              id="owner_name"
              value={form.owner_name}
              onChange={(event) => set('owner_name', event.target.value)}
              placeholder="أحمد كريم"
            />
          </div>

          <div className="field">
            <label htmlFor="owner_phone">هاتف المالك</label>
            <input
              id="owner_phone"
              value={form.owner_phone}
              onChange={(event) => set('owner_phone', normalizeDigits(event.target.value))}
              placeholder="07712345678"
              style={{ direction: 'ltr', textAlign: 'left' }}
              inputMode="tel"
            />
            <span className="field__hint">
              إن كان لدى المالك حساب جيبلي بهذا الرقم، سيُستخدم الحساب نفسه — رقم واحد لهوية واحدة.
            </span>
            {form.owner_phone && !phoneResult.ok ? (
              <span className="field__error">رقم هاتف عراقي غير صالح</span>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="governorate">المحافظة</label>
            <select
              id="governorate"
              value={form.governorate_id}
              onChange={(event) => set('governorate_id', event.target.value)}
            >
              <option value="">اختر المحافظة</option>
              {(governorates.data ?? []).map((governorate) => (
                <option key={governorate.id} value={governorate.id}>
                  {governorate.name_ar}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="city">المدينة</label>
            <select
              id="city"
              value={form.city_id}
              onChange={(event) => set('city_id', event.target.value)}
              disabled={!form.governorate_id || cities.isLoading}
            >
              <option value="">
                {form.governorate_id ? 'اختر المدينة' : 'اختر المحافظة أولاً'}
              </option>
              {(cities.data ?? []).map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name_ar}
                  {city.restaurant_onboarding_enabled ? '' : ' (الانضمام معطّل)'}
                </option>
              ))}
            </select>
          </div>

          {cityClosed ? (
            <div className="alert-bar alert-bar--warning">
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span>
                انضمام المطاعم معطّل في هذه المدينة. يمكنك المتابعة كتجهيز مسبق، لكن المطعم لن
                يستقبل طلبات حتى تُفعَّل الطلبات في المدينة.
              </span>
            </div>
          ) : null}

          {cityClosed ? (
            <>
              <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.override_coverage}
                  onChange={(event) => set('override_coverage', event.target.checked)}
                />
                أؤكد الإنشاء في مدينة غير مفعّلة للانضمام
              </label>
              <div className="field">
                <label htmlFor="reason">سبب التجاوز (مطلوب)</label>
                <textarea
                  id="reason"
                  rows={2}
                  value={form.reason}
                  onChange={(event) => set('reason', event.target.value)}
                />
              </div>
            </>
          ) : null}

          <div className="field">
            <label htmlFor="address">العنوان التفصيلي</label>
            <textarea
              id="address"
              rows={2}
              value={form.address_text}
              onChange={(event) => set('address_text', event.target.value)}
              placeholder="المنصور، شارع الأميرات، مقابل..."
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div className="field">
              <label htmlFor="commission">نسبة العمولة (%)</label>
              <input
                id="commission"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.commission_percent}
                onChange={(event) => set('commission_percent', Number(event.target.value))}
              />
            </div>

            <div className="field">
              <label htmlFor="policy">دورة التسوية</label>
              <select
                id="policy"
                value={form.settlement_policy}
                onChange={(event) =>
                  set('settlement_policy', event.target.value as 'HALF_MONTH' | 'MONTHLY')
                }
              >
                <option value="HALF_MONTH">نصف شهرية</option>
                <option value="MONTHLY">شهرية</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="minimum">الحد الأدنى للطلب (د.ع)</label>
              <input
                id="minimum"
                type="number"
                min={0}
                step={500}
                value={form.minimum_order_iqd}
                onChange={(event) => set('minimum_order_iqd', Number(event.target.value))}
              />
            </div>

            <div className="field">
              <label htmlFor="delivery_fee">رسوم التوصيل (د.ع)</label>
              <input
                id="delivery_fee"
                type="number"
                min={0}
                step={500}
                value={form.delivery_fee_iqd}
                onChange={(event) => set('delivery_fee_iqd', Number(event.target.value))}
              />
            </div>
          </div>

          {create.error && !(create.error instanceof ApiError && create.error.needsReauth) ? (
            <p className="alert-bar alert-bar--danger" role="alert">
              {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر إنشاء المطعم'}
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canSubmit}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'جاري الإنشاء…' : 'إنشاء المطعم'}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => router.back()}>
              إلغاء
            </button>
          </div>

          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            يُنشأ المطعم بحالة «قيد الإعداد». أكمل المنيو وأوقات العمل والسائقين، ثم فعّله من صفحة
            المطعم بعد اجتياز قائمة الجاهزية.
          </p>
        </div>
      </Card>

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}
