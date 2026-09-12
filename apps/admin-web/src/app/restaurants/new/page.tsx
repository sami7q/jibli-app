'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LogoUpload } from '@jibli/ui-web';
import { normalizeDigits, tryToE164Iraq } from '@jibli/validation';
import { AdminShell } from '@/components/shell';
import { Card, MfaChallenge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';
import { admin } from '@/lib/admin-endpoints';
import { adminApi, ApiError } from '@/lib/api';

/**
 * Create a restaurant.
 *
 * Laid out as the four decisions it actually contains rather than as one
 * column of ten inputs: who the customer sees, who holds the account, where it
 * trades, and on what terms. The preview beside them is the listing being
 * built — an operator setting a logo should see the card the customer will see,
 * not a filename.
 *
 * The commission rate is deliberately absent; see the note in the terms
 * section.
 */
export default function NewRestaurantPage() {
  const session = useAdminSession();
  const router = useRouter();
  const [needsMfa, setNeedsMfa] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [form, setForm] = useState({
    display_name: '',
    owner_name: '',
    owner_phone: '',
    governorate_id: '',
    city_id: '',
    address_text: '',
    logo_asset_id: null as string | null,
    settlement_policy: 'HALF_MONTH' as 'HALF_MONTH' | 'MONTHLY',
    minimum_order_iqd: 0,
    delivery_fee_iqd: 2000,
    override_coverage: false,
    reason: '',
  });

  const token = session.status === 'authenticated' ? session.accessToken : '';
  const authenticated = session.status === 'authenticated';

  const governorates = useQuery({
    queryKey: ['admin-governorates'],
    queryFn: () => adminApi.governorates(token),
    enabled: authenticated,
  });

  const cities = useQuery({
    queryKey: ['admin-cities', form.governorate_id],
    queryFn: () => adminApi.cities(token, form.governorate_id),
    enabled: authenticated && form.governorate_id !== '',
  });

  /*
   * Read so the rate can be *shown* here, not edited here. An operator who
   * remembers typing a commission on this screen needs to be told where it
   * moved, and what it is now.
   */
  const config = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => admin.config(token),
    enabled: authenticated,
    staleTime: 5 * 60_000,
  });

  const commissionBps = Number(
    config.data?.find((entry) => entry.key === 'default_commission_rate_bps')?.value ?? 1500,
  );

  const create = useMutation({
    mutationFn: () =>
      admin.createRestaurant(token, {
        display_name: form.display_name,
        owner_name: form.owner_name,
        owner_phone: form.owner_phone,
        governorate_id: form.governorate_id,
        city_id: form.city_id,
        address_text: form.address_text,
        settlement_policy: form.settlement_policy,
        minimum_order_iqd: form.minimum_order_iqd,
        delivery_fee_iqd: form.delivery_fee_iqd,
        override_coverage: form.override_coverage,
        reason: form.reason || undefined,
        ...(form.logo_asset_id ? { logo_asset_id: form.logo_asset_id } : {}),
      }),
    onSuccess: (result) => router.push(`/restaurants/${result.restaurant_id}`),
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) setNeedsMfa(true);
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const phoneResult = tryToE164Iraq(form.owner_phone);
  const selectedCity = (cities.data ?? []).find((city) => city.id === form.city_id);
  const cityClosed = Boolean(selectedCity && !selectedCity.restaurant_onboarding_enabled);

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
      <div className="form-layout">
        <div className="form-layout__main">
          <Card title="هوية المطعم" icon="restaurants">
            <div className="form-grid">
              <LogoUpload
                value={logoPreview}
                upload={(dataUrl) =>
                  adminApi.uploadImage(token, { data: dataUrl, purpose: 'RESTAURANT_LOGO' })
                }
                onChange={(assetId, previewUrl) => {
                  set('logo_asset_id', assetId);
                  setLogoPreview(previewUrl);
                }}
              />

              <div className="field">
                <label htmlFor="display_name">اسم المطعم</label>
                <input
                  id="display_name"
                  value={form.display_name}
                  onChange={(event) => set('display_name', event.target.value)}
                  placeholder="مطعم البيت العراقي"
                />
                <span className="field__hint">الاسم الذي يظهر للعملاء في التطبيق.</span>
              </div>
            </div>
          </Card>

          <Card title="المالك" icon="users">
            <div className="form-grid form-grid--pair">
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
                  className="ltr-input"
                  value={form.owner_phone}
                  onChange={(event) => set('owner_phone', normalizeDigits(event.target.value))}
                  placeholder="07712345678"
                  inputMode="tel"
                />
                {form.owner_phone && !phoneResult.ok ? (
                  <span className="field__error">رقم هاتف عراقي غير صالح</span>
                ) : (
                  <span className="field__hint">
                    رقم واحد لهوية واحدة: إن كان له حساب جيبلي، سيُستخدم الحساب نفسه.
                  </span>
                )}
              </div>
            </div>
          </Card>

          <Card title="الموقع" icon="geography">
            <div className="form-grid">
              <div className="form-grid form-grid--pair">
                <div className="field">
                  <label htmlFor="governorate">المحافظة</label>
                  <select
                    id="governorate"
                    value={form.governorate_id}
                    onChange={(event) => {
                      set('governorate_id', event.target.value);
                      set('city_id', '');
                    }}
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
              </div>

              {cityClosed ? (
                <>
                  <div className="alert-bar alert-bar--warning">
                    <Icon name="alert" className="nav__icon" aria-hidden />
                    <span>
                      انضمام المطاعم معطّل في هذه المدينة. يمكنك المتابعة كتجهيز مسبق، لكن المطعم
                      لن يستقبل طلبات حتى تُفعَّل الطلبات في المدينة.
                    </span>
                  </div>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={form.override_coverage}
                      onChange={(event) => set('override_coverage', event.target.checked)}
                    />
                    أؤكد الإنشاء في مدينة غير مفعّلة للانضمام
                  </label>

                  <div className="field">
                    <label htmlFor="reason">سبب التجاوز</label>
                    <textarea
                      id="reason"
                      rows={2}
                      value={form.reason}
                      onChange={(event) => set('reason', event.target.value)}
                      placeholder="يُسجَّل في سجل التدقيق باسمك."
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
            </div>
          </Card>

          <Card title="شروط التشغيل" icon="commissions">
            <div className="form-grid">
              {/*
                The commission used to be an input here. It is one platform-wide
                number, and typing it per restaurant is how two restaurants end
                up on different rates that nobody chose. Shown, not editable —
                an operator who remembers the field needs to know where it went.
              */}
              <div className="inherited">
                <div className="inherited__value">
                  {(commissionBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%
                </div>
                <div className="inherited__body">
                  <strong>نسبة العمولة</strong>
                  <span>
                    موحّدة على مستوى المنصة. لتغييرها لكل المطاعم:{' '}
                    <Link href="/settings">إعدادات المنصة</Link>. ولاستثناء مطعم واحد، عدّلها من
                    صفحته بعد الإنشاء.
                  </span>
                </div>
              </div>

              <div className="form-grid form-grid--pair">
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
            </div>
          </Card>
        </div>

        {/*
          The listing as the customer will meet it. A logo picker that shows a
          filename asks the operator to imagine the result; this shows it.
        */}
        <aside className="form-layout__aside">
          <div className="preview">
            <div className="preview__eyebrow">كما سيظهر للعملاء</div>

            <div className="preview__card">
              <div className="preview__logo">
                {logoPreview ? (
                  <img src={logoPreview} alt="" />
                ) : (
                  <Icon name="restaurants" className="nav__icon" aria-hidden />
                )}
              </div>
              <div className="preview__text">
                <strong>{form.display_name.trim() || 'اسم المطعم'}</strong>
                <span>
                  {selectedCity?.name_ar ?? 'المدينة'}
                  {form.delivery_fee_iqd > 0
                    ? ` · توصيل ${form.delivery_fee_iqd.toLocaleString('en-US')} د.ع`
                    : ' · توصيل مجاني'}
                </span>
              </div>
            </div>

            <p className="preview__note">
              يُنشأ المطعم بحالة «قيد الإعداد». أكمل المنيو وأوقات العمل والمندوبين، ثم فعّله من
              صفحة المطعم بعد اجتياز قائمة الجاهزية.
            </p>
          </div>

          {create.error && !(create.error instanceof ApiError && create.error.needsReauth) ? (
            <p className="alert-bar alert-bar--danger" role="alert">
              {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر إنشاء المطعم'}
            </p>
          ) : null}

          <div className="form-actions">
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
        </aside>
      </div>

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}
