'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LogoUpload, NumberField } from '@jibli/ui-web';
import {
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  type MerchantType,
  categoriesFor,
} from '@jibli/contracts';
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
 * The commission is deliberately absent; see the note in the terms
 * section.
 */
export default function NewRestaurantPage() {
  const session = useAdminSession();
  const router = useRouter();
  const [needsMfa, setNeedsMfa] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [form, setForm] = useState({
    /*
     * What is being created, chosen first because it changes the words on the
     * rest of the form.
     *
     * Defaulted to a restaurant: that is the overwhelming majority of what
     * gets created, and a required choice on the common case is a choice that
     * gets made carelessly.
     */
    merchant_type: 'RESTAURANT' as MerchantType,
    display_name: '',
    owner_name: '',
    owner_phone: '',
    governorate_id: '',
    city_id: '',
    address_text: '',
    logo_asset_id: null as string | null,
    cuisine_tags: [] as string[],
    create_access: true,
    portal_username: '',
    settlement_policy: 'HALF_MONTH' as 'HALF_MONTH' | 'MONTHLY',
    minimum_order_iqd: 0,
    delivery_fee_iqd: 2000,
    override_coverage: false,
    reason: '',
  });

  /*
   * Open on the kind the caller asked for.
   *
   * «إضافة ماركت» on the markets screen links here with `?type=MARKET`, and a
   * button whose label promises a market has to produce a market form — or the
   * one field that decides everything else is left on its default and quietly
   * creates the wrong thing.
   *
   * Read in an effect rather than from `useSearchParams`: that hook forces the
   * page into a Suspense boundary, which means Next serves a placeholder
   * instead of the form. Reading `window.location` during render would instead
   * make the server and the client disagree about a toggle. This costs one
   * extra paint on a form nobody can fill in that fast.
   */
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('type');
    const known = MERCHANT_TYPES.find((value) => value === requested);
    if (known) {
      setForm((current) => ({ ...current, merchant_type: known }));
    }
  }, []);

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
   * Read so the commission can be *shown* here, not edited here. An operator
   * who remembers typing a commission on this screen needs to be told where it
   * moved, and what it is now.
   */
  const config = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => admin.config(token),
    enabled: authenticated,
    staleTime: 5 * 60_000,
  });

  const commissionIqd = Number(
    config.data?.find((entry) => entry.key === 'commission_flat_iqd')?.value ?? 500,
  );

  const create = useMutation({
    mutationFn: () =>
      admin.createRestaurant(token, {
        merchant_type: form.merchant_type,
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
        cuisine_tags: form.cuisine_tags,
        ...(form.logo_asset_id ? { logo_asset_id: form.logo_asset_id } : {}),
      }),
    onSuccess: async (result) => {
      if (!form.create_access) {
        router.push(`/restaurants/${result.restaurant_id}`);
        return;
      }

      /*
       * Credentials are issued after the restaurant exists, because the
       * username falls back to its partner code — which is minted during
       * creation. A failure here leaves a usable restaurant with no access
       * rather than no restaurant, and the page says so instead of pretending
       * nothing happened.
       */
      try {
        const username =
          form.portal_username.trim() ||
          (await admin.suggestUsername(token, result.restaurant_id)).username;

        const created = await admin.createPortalUser(token, result.restaurant_id, {
          username,
          full_name: form.owner_name.trim(),
          role: 'OWNER',
        });

        setIssued({ username: created.username, password: created.password });
        setCreatedId(result.restaurant_id);
      } catch (error) {
        setAccessError(
          error instanceof ApiError ? error.messageAr : 'أُنشئ المطعم، وتعذّر إنشاء حساب الدخول',
        );
        setCreatedId(result.restaurant_id);
      }
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) setNeedsMfa(true);
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  /*
   * The whole screen, not a toast. The password exists in exactly one place —
   * this response — and nothing can retrieve it afterwards, so it must not be
   * possible to navigate past it by accident.
   */
  if (issued || accessError) {
    return (
      <AdminShell
        title="تم إنشاء المطعم"
        userName={session.userName || 'مدير'}
        userRoleAr={session.roleAr}
      >
        {issued ? (
          <Card title="بيانات دخول المطعم" icon="roles">
            <div className="handover">
              <p className="handover__warning" role="alert">
                انسخ كلمة المرور الآن — لن تظهر مرة أخرى. لا تُخزَّن إلا كتجزئة، ولا يمكن استرجاعها.
                وإن ضاعت، أعِد تعيينها من صفحة المطعم.
              </p>

              <dl className="handover__grid">
                <dt>اسم المستخدم</dt>
                <dd>
                  <code>{issued.username}</code>
                  <CopyButton value={issued.username} label="نسخ اسم المستخدم" />
                </dd>

                <dt>كلمة المرور</dt>
                <dd>
                  <code>{issued.password}</code>
                  <CopyButton value={issued.password} label="نسخ كلمة المرور" />
                </dd>
              </dl>

              <p className="handover__note">
                سيُطلب من المالك تغييرها عند أول دخول. سلّمها عبر قناة يثق بها الطرفان، ولا ترسلها
                في رسالة تبقى محفوظة.
              </p>
            </div>
          </Card>
        ) : (
          <div className="alert-bar alert-bar--danger" role="alert">
            <Icon name="alert" className="nav__icon" aria-hidden />
            <span>{accessError} — أنشئ الحساب من صفحة المطعم.</span>
          </div>
        )}

        <div className="form-actions">
          <Link className="btn btn--primary" href={`/restaurants/${createdId}`}>
            الذهاب إلى صفحة المطعم
          </Link>
          <Link className="btn btn--outline" href="/restaurants">
            قائمة المطاعم
          </Link>
        </div>
      </AdminShell>
    );
  }

  const phoneResult = tryToE164Iraq(form.owner_phone);
  const selectedCity = (cities.data ?? []).find((city) => city.id === form.city_id);
  const cityClosed = Boolean(selectedCity && !selectedCity.restaurant_onboarding_enabled);

  /*
   * Checked here as well as on the server so the mistake is caught before a
   * restaurant is created: the credential call happens second, and a username
   * rejected at that point leaves a restaurant with no access.
   */
  const typedUsername = form.portal_username.trim();
  const usernameProblem =
    form.create_access &&
    typedUsername.length > 0 &&
    !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(typedUsername)
      ? 'أحرف إنجليزية صغيرة وأرقام و . _ - فقط، ويبدأ بحرف أو رقم، من ٣ إلى ٣٢ حرفاً'
      : null;

  const canSubmit =
    form.display_name.trim().length >= 2 &&
    form.owner_name.trim().length >= 3 &&
    phoneResult.ok &&
    form.governorate_id !== '' &&
    form.city_id !== '' &&
    form.address_text.trim().length >= 5 &&
    (!cityClosed || (form.override_coverage && form.reason.trim().length >= 5)) &&
    !usernameProblem &&
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

              {/*
                Before the name, because it decides what the name is for.
                Two radio-style buttons rather than a select: there are exactly
                two, both fit on a line, and a closed dropdown hides the fact
                that a choice exists at all.
              */}
              <div className="field">
                <label htmlFor="merchant_type">نوع الشريك</label>
                <div
                  id="merchant_type"
                  role="radiogroup"
                  aria-label="نوع الشريك"
                  style={{ display: 'flex', flexDirection: 'row-reverse', gap: 'var(--space-2)' }}
                >
                  {MERCHANT_TYPES.map((value) => {
                    const active = form.merchant_type === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() =>
                          // The tags belong to the kind: a food cuisine kept
                          // on a cosmetics shop would be refused by the API.
                          setForm((current) =>
                            current.merchant_type === value
                              ? current
                              : { ...current, merchant_type: value, cuisine_tags: [] },
                          )
                        }
                        className={`btn btn--sm ${active ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ flex: 1 }}
                      >
                        {MERCHANT_TYPE_LABELS[value].nameAr}
                      </button>
                    );
                  })}
                </div>
                <span className="field__hint">
                  {`يظهر في قسم «${KIND_COPY[form.merchant_type].section}» داخل التطبيق.`}
                </span>
              </div>

              <div className="field">
                <label htmlFor="display_name">{KIND_COPY[form.merchant_type].nameLabel}</label>
                <input
                  id="display_name"
                  value={form.display_name}
                  onChange={(event) => set('display_name', event.target.value)}
                  placeholder={KIND_COPY[form.merchant_type].namePlaceholder}
                />
                <span className="field__hint">الاسم الذي يظهر للعملاء في التطبيق.</span>
              </div>

              {/*
                Chosen from a fixed list, not typed. Free text is how the same
                category ends up spelled three ways, and the customer app filters
                on exactly these keys.
              */}
              <fieldset className="chips">
                <legend className="chips__legend">
                  التصنيف
                  <span className="chips__count">
                    {form.cuisine_tags.length > 0
                      ? `${form.cuisine_tags.length} من ٤`
                      : 'اختر حتى ٤'}
                  </span>
                </legend>

                <div className="chips__list">
                  {categoriesFor(form.merchant_type).map((cuisine) => {
                    const selected = form.cuisine_tags.includes(cuisine.key);
                    const full = form.cuisine_tags.length >= 4 && !selected;
                    return (
                      <button
                        key={cuisine.key}
                        type="button"
                        className={`chip${selected ? ' chip--on' : ''}`}
                        aria-pressed={selected}
                        disabled={full}
                        onClick={() =>
                          set(
                            'cuisine_tags',
                            selected
                              ? form.cuisine_tags.filter((tag) => tag !== cuisine.key)
                              : [...form.cuisine_tags, cuisine.key],
                          )
                        }
                      >
                        <span aria-hidden>{cuisine.emoji}</span>
                        {cuisine.labelAr}
                      </button>
                    );
                  })}
                </div>
                <span className="field__hint">
                  يحدّد أين يظهر المطعم عند تصفّح العملاء. يمكن تعديله لاحقاً.
                </span>
              </fieldset>
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

          <Card title="دخول المطعم" icon="roles">
            <div className="form-grid">
              {/*
                Issued here rather than as a separate errand afterwards: a
                restaurant that exists but cannot sign in is a restaurant nobody
                is setting up, and the step most likely to be forgotten is the
                one on its own screen.
              */}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.create_access}
                  onChange={(event) => set('create_access', event.target.checked)}
                />
                إنشاء حساب دخول لمالك المطعم
              </label>

              {form.create_access ? (
                <div className="field">
                  <label htmlFor="portal_username">اسم المستخدم</label>
                  <input
                    id="portal_username"
                    className="ltr-input"
                    value={form.portal_username}
                    onChange={(event) => set('portal_username', event.target.value.toLowerCase())}
                    placeholder="mandi-hadramout"
                    autoComplete="off"
                  />
                  <span className="field__hint">
                    أحرف إنجليزية صغيرة وأرقام و<span className="ltr-inline"> . _ - </span>فقط، من ٣
                    إلى ٣٢ حرفاً. اتركه فارغاً ليُولَّد تلقائياً من رمز الشريك.
                  </span>
                  {usernameProblem ? <span className="field__error">{usernameProblem}</span> : null}
                </div>
              ) : (
                <p className="field__hint" style={{ margin: 0 }}>
                  يمكن إنشاء الحساب لاحقاً من صفحة المطعم.
                </p>
              )}
            </div>
          </Card>

          <Card title="الموقع" icon="geography">
            {form.merchant_type !== 'RESTAURANT' ? (
              <p className="field__hint" style={{ marginBlockStart: 0 }}>
                الموقع على الخريطة يثبّته صاحب المتجر من التطبيق لاحقاً، وأوقات العمل تُكتب
                08:00–23:00 تلقائياً ويعدّلها من التطبيق. لا يمنع أيٌّ منهما التفعيل.
              </p>
            ) : null}
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
                      انضمام المطاعم معطّل في هذه المدينة. يمكنك المتابعة كتجهيز مسبق، لكن المطعم لن
                      يستقبل طلبات حتى تُفعَّل الطلبات في المدينة.
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
                up on different terms that nobody chose. Shown, not editable —
                an operator who remembers the field needs to know where it went.
              */}
              <div className="inherited">
                <div className="inherited__value">
                  {commissionIqd.toLocaleString('en-US')}
                  <span className="inherited__unit"> د.ع</span>
                </div>
                <div className="inherited__body">
                  <strong>العمولة لكل طلب</strong>
                  <span>
                    قيمة ثابتة لا تتغيّر بحجم الطلب، وموحّدة على مستوى المنصة. لتغييرها لكل المطاعم:{' '}
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
                  <NumberField
                    id="minimum"
                    min={0}
                    value={form.minimum_order_iqd}
                    onChange={(value) => set('minimum_order_iqd', value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="delivery_fee">رسوم التوصيل (د.ع)</label>
                  <NumberField
                    id="delivery_fee"
                    min={0}
                    value={form.delivery_fee_iqd}
                    onChange={(value) => set('delivery_fee_iqd', value)}
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
                <strong>
                  {form.display_name.trim() || KIND_COPY[form.merchant_type].nameLabel}
                </strong>
                <span>
                  {form.cuisine_tags.length > 0
                    ? categoriesFor(form.merchant_type)
                        .filter((cuisine) => form.cuisine_tags.includes(cuisine.key))
                        .map((cuisine) => cuisine.labelAr)
                        .join('، ')
                    : (selectedCity?.name_ar ?? 'المدينة')}
                </span>
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

/**
 * Copy to clipboard, with the result said out loud rather than implied.
 *
 * A handover screen that silently does nothing when the clipboard is blocked —
 * an insecure origin, a denied permission — is how a password gets lost between
 * two people who both believed it was copied.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('done');
          setTimeout(() => setState('idle'), 2000);
        } catch {
          setState('failed');
        }
      }}
    >
      {state === 'done' ? 'نُسخ' : state === 'failed' ? 'انسخه يدوياً' : 'نسخ'}
    </button>
  );
}

/** The words the form changes with the kind of partner being created. */
const KIND_COPY: Record<
  MerchantType,
  { readonly section: string; readonly nameLabel: string; readonly namePlaceholder: string }
> = {
  RESTAURANT: {
    section: 'جيبلي أكل',
    nameLabel: 'اسم المطعم',
    namePlaceholder: 'مطعم البيت العراقي',
  },
  MARKET: {
    section: 'جيبلي ماركت',
    nameLabel: 'اسم الماركت',
    namePlaceholder: 'ماركت الرشيد',
  },
  COSMETICS: {
    section: 'جيبلي كوزمتك',
    nameLabel: 'اسم متجر التجميل',
    namePlaceholder: 'كوزمتك الورد',
  },
};
