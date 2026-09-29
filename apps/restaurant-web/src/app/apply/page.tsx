'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { categoriesFor, MERCHANT_TYPES, type MerchantType } from '@jibli/contracts';
import { normalizeDigits, tryToE164Iraq } from '@jibli/validation';
import { JibliLogo } from '@jibli/ui-web';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * Apply to join Jibli.
 *
 * The applications queue has been in the schema from the beginning and Admin
 * has been able to review and approve — but nothing could put a row in it, so
 * the only way onto the platform was to know someone. This is the other end of
 * that queue.
 *
 * Public: the visitor has no account, and asking them to sign in to ask for an
 * account is the loop this page exists to break.
 */

interface CoverageGovernorate {
  id: string;
  name_ar: string;
  cities: { id: string; name_ar: string }[];
}

export default function ApplyPage() {
  const [form, setForm] = useState({
    /*
     * What kind of shop, asked first because it changes the words on the rest
     * of the form and the list of categories. A cosmetics shop that applied
     * through a restaurant-only form landed in the food tab.
     */
    merchant_type: 'RESTAURANT' as MerchantType,
    display_name: '',
    applicant_name: '',
    applicant_phone: '',
    governorate_id: '',
    city_id: '',
    address_text: '',
    cuisine_tags: [] as string[],
    note: '',
  });

  const coverage = useQuery({
    queryKey: ['apply-coverage'],
    queryFn: () =>
      // No token: this page is for a visitor who has no account.
      apiRequest<CoverageGovernorate[]>('/api/v1/applications/coverage'),
    staleTime: 5 * 60_000,
  });

  const submit = useMutation({
    mutationFn: () =>
      apiRequest<{ received: boolean; note_ar: string }>('/api/v1/applications', {
        method: 'POST',
        body: {
          merchant_type: form.merchant_type,
          display_name: form.display_name.trim(),
          applicant_name: form.applicant_name.trim(),
          applicant_phone: form.applicant_phone,
          governorate_id: form.governorate_id,
          city_id: form.city_id,
          address_text: form.address_text.trim(),
          cuisine_tags: form.cuisine_tags,
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      }),
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const governorates = coverage.data ?? [];
  const selectedGovernorate = governorates.find((g) => g.id === form.governorate_id);
  const phone = tryToE164Iraq(form.applicant_phone);

  const canSubmit =
    form.display_name.trim().length >= 2 &&
    form.applicant_name.trim().length >= 3 &&
    phone.ok &&
    form.city_id !== '' &&
    form.address_text.trim().length >= 5 &&
    !submit.isPending;

  if (submit.isSuccess) {
    return (
      <main className="apply">
        <div className="apply__card apply__card--done">
          <JibliLogo />
          <h1>وصل طلبك</h1>
          <p>{submit.data.note_ar}</p>
          <p className="apply__muted">
            احتفظ بهاتفك قريباً — سنتصل بك للتحقق من البيانات وإكمال الاتفاق، ثم تصلك بيانات الدخول
            إلى بوابة الشركاء.
          </p>
          <Link className="btn btn--outline" href="/login">
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="apply">
      <form
        className="apply__card"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) submit.mutate();
        }}
      >
        <header className="apply__head">
          <JibliLogo />
          <h1>انضم إلى جيبلي</h1>
          <p>املأ البيانات وسيتواصل معك فريقنا. لا تحتاج حساباً — نُنشئه لك بعد الموافقة.</p>
        </header>

        {/*
          Coverage first, and it is read from the server rather than listed
          here: a restaurant in a city Jibli has not opened should find that out
          on this page, not after waiting a week for a reply.
        */}
        {coverage.isSuccess && governorates.length === 0 ? (
          <p className="apply__closed" role="status">
            لا يستقبل جيبلي طلبات انضمام جديدة حالياً. تابعنا، وسنفتح المدن تباعاً.
          </p>
        ) : null}

        <fieldset className="chips">
          <legend className="chips__legend">نوع المتجر</legend>
          <div className="chips__list" role="radiogroup" aria-label="نوع المتجر">
            {MERCHANT_TYPES.map((value) => {
              const active = form.merchant_type === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`chip${active ? ' chip--on' : ''}`}
                  onClick={() =>
                    // The categories belong to the kind; keeping food tags on a
                    // cosmetics application would be refused by the server.
                    setForm((current) =>
                      current.merchant_type === value
                        ? current
                        : { ...current, merchant_type: value, cuisine_tags: [] },
                    )
                  }
                >
                  <span aria-hidden>{KIND[value].emoji}</span>
                  {KIND[value].label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="apply__grid">
          <div className="field">
            <label htmlFor="display_name">{KIND[form.merchant_type].nameLabel}</label>
            <input
              id="display_name"
              value={form.display_name}
              onChange={(event) => set('display_name', event.target.value)}
              placeholder={KIND[form.merchant_type].namePlaceholder}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="applicant_name">اسمك</label>
            <input
              id="applicant_name"
              value={form.applicant_name}
              onChange={(event) => set('applicant_name', event.target.value)}
              placeholder="أحمد كريم"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="applicant_phone">رقم الهاتف</label>
            <input
              id="applicant_phone"
              className="ltr-input"
              value={form.applicant_phone}
              onChange={(event) => set('applicant_phone', normalizeDigits(event.target.value))}
              placeholder="07712345678"
              inputMode="tel"
              required
            />
            {form.applicant_phone && !phone.ok ? (
              <span className="field__error">رقم هاتف عراقي غير صالح</span>
            ) : (
              <span className="field__hint">سنتصل بك على هذا الرقم.</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="governorate">المحافظة</label>
            <select
              id="governorate"
              value={form.governorate_id}
              onChange={(event) => {
                set('governorate_id', event.target.value);
                set('city_id', '');
              }}
              disabled={coverage.isLoading}
              required
            >
              <option value="">{coverage.isLoading ? 'جارٍ التحميل…' : 'اختر المحافظة'}</option>
              {governorates.map((governorate) => (
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
              disabled={!selectedGovernorate}
              required
            >
              <option value="">
                {selectedGovernorate ? 'اختر المدينة' : 'اختر المحافظة أولاً'}
              </option>
              {(selectedGovernorate?.cities ?? []).map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name_ar}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="address">عنوان المتجر</label>
          <textarea
            id="address"
            rows={2}
            value={form.address_text}
            onChange={(event) => set('address_text', event.target.value)}
            placeholder="المنصور، شارع الأميرات، مقابل..."
            required
          />
        </div>

        <fieldset className="chips">
          <legend className="chips__legend">
            {KIND[form.merchant_type].categoriesLabel}
            <span className="chips__count">
              {form.cuisine_tags.length > 0 ? `${form.cuisine_tags.length} من ٤` : 'اختياري'}
            </span>
          </legend>
          <div className="chips__list">
            {categoriesFor(form.merchant_type).map((cuisine) => {
              const selected = form.cuisine_tags.includes(cuisine.key);
              return (
                <button
                  key={cuisine.key}
                  type="button"
                  className={`chip${selected ? ' chip--on' : ''}`}
                  aria-pressed={selected}
                  disabled={form.cuisine_tags.length >= 4 && !selected}
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
        </fieldset>

        <div className="field">
          <label htmlFor="note">ملاحظة (اختياري)</label>
          <textarea
            id="note"
            rows={2}
            value={form.note}
            onChange={(event) => set('note', event.target.value)}
            placeholder="عدد الفروع، أوقات العمل، أي شيء يفيدنا."
          />
        </div>

        {submit.error ? (
          <p className="apply__error" role="alert">
            {submit.error instanceof ApiError ? submit.error.messageAr : 'تعذّر إرسال الطلب'}
          </p>
        ) : null}

        <div className="apply__actions">
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            {submit.isPending ? 'جارٍ الإرسال…' : 'إرسال الطلب'}
          </button>
          <Link className="btn btn--ghost" href="/login">
            لدي حساب بالفعل
          </Link>
        </div>
      </form>
    </main>
  );
}

/** The words and categories the form changes with the kind of shop. */
const KIND: Record<
  MerchantType,
  {
    readonly label: string;
    readonly emoji: string;
    readonly nameLabel: string;
    readonly namePlaceholder: string;
    readonly categoriesLabel: string;
  }
> = {
  RESTAURANT: {
    label: 'مطعم',
    emoji: '🍽️',
    nameLabel: 'اسم المطعم',
    namePlaceholder: 'مطعم البيت العراقي',
    categoriesLabel: 'نوع المأكولات',
  },
  MARKET: {
    label: 'ماركت',
    emoji: '🛒',
    nameLabel: 'اسم الماركت',
    namePlaceholder: 'ماركت الرشيد',
    categoriesLabel: 'الأقسام التي تبيعها',
  },
  COSMETICS: {
    label: 'متجر تجميل',
    emoji: '💄',
    nameLabel: 'اسم متجر التجميل',
    namePlaceholder: 'كوزمتك الورد',
    categoriesLabel: 'الأقسام التي تبيعها',
  },
};
