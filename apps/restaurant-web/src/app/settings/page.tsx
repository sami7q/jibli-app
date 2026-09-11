'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BUSY_MODES, BUSY_MODE_EXTRA_MINUTES, type BusyMode } from '@jibli/contracts';
import { money } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type PortalSettings, type WorkingHour } from '@/lib/portal-endpoints';

/**
 * Restaurant settings (plan §17, §33, §105, §123).
 *
 * Two things are deliberately absent, and the page says why rather than leaving
 * a blank:
 *
 *   - **Commission** is a contractual term Admin owns, not a field to edit.
 *   - **City** cannot be changed here. Relocation is an approval workflow,
 *     because a restaurant must not be able to move between markets by picking
 *     a different dropdown value.
 */

const BUSY_MODE_LABELS: Record<BusyMode, string> = {
  NORMAL: 'طبيعي',
  BUSY: 'مزدحم',
  VERY_BUSY: 'مزدحم جداً',
  PAUSED: 'إيقاف مؤقت',
};

const BUSY_MODE_HINTS: Record<BusyMode, string> = {
  NORMAL: 'وقت التحضير المعلن كما هو.',
  BUSY: 'يُضاف ١٥ دقيقة إلى وقت التحضير المعلن للعميل.',
  VERY_BUSY: 'يُضاف ٣٠ دقيقة إلى وقت التحضير المعلن للعميل.',
  PAUSED: 'يتوقف استقبال الطلبات الجديدة مؤقتاً. الطلبات الجارية تكمل مسارها.',
};

const EXPIRY_OPTIONS = [15, 30, 60, 120, 240] as const;

const DAY_NAMES = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

export default function SettingsPage() {
  return (
    <PortalPage permission="settings.read" permissionLabelAr="قراءة الإعدادات">
      {({ auth, can }) => (
        <SettingsScreen
          auth={auth}
          canWrite={can('settings.write')}
          canSetBusy={can('order.accept')}
        />
      )}
    </PortalPage>
  );
}

function SettingsScreen({
  auth,
  canWrite,
  canSetBusy,
}: {
  auth: PortalAuth;
  canWrite: boolean;
  canSetBusy: boolean;
}) {
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', auth.restaurantId],
    queryFn: () => portal.settings(auth),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['settings'] });

  if (settings.isError) {
    return (
      <ErrorState
        message={
          settings.error instanceof ApiError ? settings.error.messageAr : 'تعذّر تحميل الإعدادات'
        }
        code={settings.error instanceof ApiError ? settings.error.code : undefined}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  if (settings.isLoading || !settings.data) return <Skeleton height={480} />;

  const data = settings.data;

  return (
    <>
      <StatusCard data={data} />
      {canSetBusy ? <BusyModeCard auth={auth} data={data} onChanged={invalidate} /> : null}
      <ProfileCard auth={auth} data={data} canWrite={canWrite} onChanged={invalidate} />
      <HoursCard auth={auth} data={data} canWrite={canWrite} onChanged={invalidate} />
      <LocationCard data={data} />
    </>
  );
}

function StatusCard({ data }: { data: PortalSettings }) {
  const open = data.accepts_orders_now;

  return (
    <Card
      title={data.restaurant.display_name}
      icon="settings"
      subtitle={`رقم الشريك #${data.restaurant.partner_code}`}
    >
      <p className={`alert-bar alert-bar--${open ? 'success' : 'danger'}`} role="status">
        <span style={{ flex: 1 }}>
          {open
            ? `المطعم يستقبل الطلبات الآن — وقت التحضير المعلن ${data.estimated_preparation_minutes} دقيقة.`
            : `المطعم لا يستقبل الطلبات حالياً: ${data.closed_reason}`}
        </span>
      </p>

      <div className="split" style={{ marginBlockStart: 'var(--space-4)' }}>
        <div className="figure">
          <span className="figure__label">الفرع</span>
          <span className="figure__value" style={{ fontSize: 'var(--text-sm)' }}>
            {data.branch.name}
          </span>
        </div>
        <div className="figure">
          <span className="figure__label">المدينة</span>
          <span className="figure__value" style={{ fontSize: 'var(--text-sm)' }}>
            {data.branch.city_name_ar} — {data.branch.governorate_name_ar}
          </span>
        </div>
        <div className="figure">
          <span className="figure__label">أجرة التوصيل</span>
          <span className="figure__value">{money(data.branch.delivery_fee_iqd)}</span>
        </div>
        <div className="figure">
          <span className="figure__label">الحد الأدنى للطلب</span>
          <span className="figure__value">{money(data.restaurant.minimum_order_iqd)}</span>
        </div>
      </div>

      {/*
        A city switched off by Admin overrides everything the restaurant can
        set here, so saying so prevents a fruitless hunt through settings
        (plan §8.6).
      */}
      {!data.city_ordering_enabled ? (
        <p className="alert-bar alert-bar--danger" style={{ marginBlockStart: 'var(--space-4)' }}>
          <span style={{ flex: 1 }}>
            الطلب موقوف حالياً على مستوى المدينة من إدارة جيبلي. لا تؤثّر إعدادات المطعم في ذلك —
            تواصل مع الدعم لمعرفة التفاصيل.
          </span>
        </p>
      ) : null}
    </Card>
  );
}

function BusyModeCard({
  auth,
  data,
  onChanged,
}: {
  auth: PortalAuth;
  data: PortalSettings;
  onChanged: () => void;
}) {
  const [expiryMinutes, setExpiryMinutes] = useState<number>(60);

  const setBusy = useMutation({
    mutationFn: (mode: BusyMode) =>
      portal.setBusyMode(auth, mode, mode === 'NORMAL' ? undefined : expiryMinutes),
    onSuccess: onChanged,
  });

  const current = data.busy_mode as BusyMode;

  return (
    <Card
      title="حالة الازدحام"
      subtitle="تعديل مؤقت لوقت التحضير المعلن للعميل"
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {BUSY_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`btn btn--${current === mode ? 'primary' : 'ghost'}`}
            aria-pressed={current === mode}
            disabled={setBusy.isPending}
            onClick={() => setBusy.mutate(mode)}
          >
            {BUSY_MODE_LABELS[mode]}
            {BUSY_MODE_EXTRA_MINUTES[mode] > 0 ? ` (+${BUSY_MODE_EXTRA_MINUTES[mode]} د)` : ''}
          </button>
        ))}
      </div>

      <p style={{ marginBlockStart: 'var(--space-3)', color: 'var(--text-secondary)' }}>
        {BUSY_MODE_HINTS[current] ?? ''}
      </p>

      <div className="field" style={{ maxWidth: 280 }}>
        <label htmlFor="busy-expiry">مدة الحالة قبل العودة للوضع الطبيعي</label>
        <select
          id="busy-expiry"
          value={expiryMinutes}
          onChange={(event) => setExpiryMinutes(Number(event.target.value))}
        >
          {EXPIRY_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} دقيقة
            </option>
          ))}
        </select>
        {/*
          Auto-expiry is the whole point: staff switch to "very busy" during a
          rush and forget, and the restaurant then under-promises all day
          (plan §33).
        */}
        <span className="field__hint">
          تُطبَّق عند اختيار حالة غير «طبيعي». تعود الحالة تلقائياً بعدها حتى لو نُسيت.
        </span>
      </div>

      {data.busy_mode_expires_at && current !== 'NORMAL' ? (
        <p className="alert-bar alert-bar--warning">
          <span style={{ flex: 1 }}>
            تعود الحالة إلى «طبيعي» في{' '}
            <span className="ltr-inline">
              {new Date(data.busy_mode_expires_at).toLocaleTimeString('ar-IQ', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            .
          </span>
        </p>
      ) : null}

      {setBusy.error ? (
        <ErrorState
          message={setBusy.error instanceof ApiError ? setBusy.error.messageAr : 'تعذّر التغيير'}
        />
      ) : null}
    </Card>
  );
}

function ProfileCard({
  auth,
  data,
  canWrite,
  onChanged,
}: {
  auth: PortalAuth;
  data: PortalSettings;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [description, setDescription] = useState(data.restaurant.description_ar ?? '');
  const [minimumOrder, setMinimumOrder] = useState(data.restaurant.minimum_order_iqd);
  const [deliveryFee, setDeliveryFee] = useState(data.branch.delivery_fee_iqd);
  const [prepMinutes, setPrepMinutes] = useState(data.branch.base_preparation_minutes);
  const [radius, setRadius] = useState(data.branch.service_radius_meters ?? 0);
  const [phone, setPhone] = useState(data.branch.phone ?? '');
  const [addressText, setAddressText] = useState(data.branch.address_text);
  const [districtText, setDistrictText] = useState(data.branch.district_text ?? '');
  const [acceptsOrders, setAcceptsOrders] = useState(data.branch.accepts_orders);

  const save = useMutation({
    mutationFn: () =>
      portal.updateSettings(auth, {
        description_ar: description.trim(),
        minimum_order_iqd: minimumOrder,
        delivery_fee_iqd: deliveryFee,
        base_preparation_minutes: prepMinutes,
        // Zero means "no radius limit"; the server expects null for that.
        service_radius_meters: radius > 0 ? radius : null,
        phone: phone.trim(),
        address_text: addressText.trim(),
        district_text: districtText.trim(),
        accepts_orders: acceptsOrders,
      }),
    onSuccess: onChanged,
  });

  const prepInvalid = prepMinutes < 5 || prepMinutes > 240;
  const radiusInvalid = radius !== 0 && (radius < 500 || radius > 50_000);
  const addressInvalid = addressText.trim().length < 5;

  return (
    <Card title="بيانات المطعم" subtitle="ما يراه العميل وما يحكم استقبال الطلبات">
      <div className="split">
        <div className="field">
          <label htmlFor="set-min">الحد الأدنى للطلب (دينار)</label>
          <input
            id="set-min"
            type="number"
            min={0}
            step={250}
            value={minimumOrder}
            disabled={!canWrite}
            onChange={(event) => setMinimumOrder(Math.trunc(Number(event.target.value)))}
          />
        </div>

        <div className="field">
          <label htmlFor="set-fee">أجرة التوصيل (دينار)</label>
          <input
            id="set-fee"
            type="number"
            min={0}
            step={250}
            value={deliveryFee}
            disabled={!canWrite}
            onChange={(event) => setDeliveryFee(Math.trunc(Number(event.target.value)))}
          />
          <span className="field__hint">لا تدخل في أساس احتساب عمولة جيبلي.</span>
        </div>

        <div className="field">
          <label htmlFor="set-prep">وقت التحضير الأساسي (دقيقة)</label>
          <input
            id="set-prep"
            type="number"
            min={5}
            max={240}
            value={prepMinutes}
            disabled={!canWrite}
            onChange={(event) => setPrepMinutes(Math.trunc(Number(event.target.value)))}
            aria-invalid={prepInvalid}
          />
          {prepInvalid ? <span className="field__error">بين ٥ و ٢٤٠ دقيقة</span> : null}
        </div>

        <div className="field">
          <label htmlFor="set-radius">نطاق التوصيل (متر)</label>
          <input
            id="set-radius"
            type="number"
            min={0}
            step={500}
            value={radius}
            disabled={!canWrite}
            onChange={(event) => setRadius(Math.trunc(Number(event.target.value)))}
            aria-invalid={radiusInvalid}
          />
          <span className="field__hint">صفر يعني بلا حد. غير ذلك بين ٥٠٠ و ٥٠٬٠٠٠ متر.</span>
          {radiusInvalid ? (
            <span className="field__error">القيمة خارج المدى المسموح</span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="set-phone">هاتف الفرع</label>
          <input
            id="set-phone"
            type="tel"
            dir="ltr"
            value={phone}
            disabled={!canWrite}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="set-district">المنطقة</label>
          <input
            id="set-district"
            value={districtText}
            disabled={!canWrite}
            onChange={(event) => setDistrictText(event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="set-address">العنوان التفصيلي</label>
        <input
          id="set-address"
          value={addressText}
          disabled={!canWrite}
          onChange={(event) => setAddressText(event.target.value)}
          aria-invalid={addressInvalid}
        />
        <span className="field__hint">
          تصحيح العنوان داخل المدينة نفسها. الانتقال إلى مدينة أخرى يحتاج طلب موافقة.
        </span>
      </div>

      <div className="field">
        <label htmlFor="set-desc">وصف المطعم</label>
        <textarea
          id="set-desc"
          rows={3}
          maxLength={300}
          value={description}
          disabled={!canWrite}
          onChange={(event) => setDescription(event.target.value)}
        />
        <span className="field__hint">{description.length} / 300 حرف</span>
      </div>

      <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={acceptsOrders}
          disabled={!canWrite}
          onChange={(event) => setAcceptsOrders(event.target.checked)}
        />
        <span>
          استقبال الطلبات
          <span className="field__hint" style={{ display: 'block' }}>
            إيقافها يمنع الطلبات الجديدة حتى داخل ساعات العمل. للإيقاف القصير استخدم «إيقاف مؤقت»
            في حالة الازدحام بدلاً من هذا.
          </span>
        </span>
      </label>

      {save.isSuccess ? (
        <p className="alert-bar alert-bar--success" role="status">
          <span style={{ flex: 1 }}>حُفظت التعديلات.</span>
        </p>
      ) : null}

      {save.error ? (
        <p className="alert-bar alert-bar--danger" role="alert">
          {save.error instanceof ApiError ? save.error.messageAr : 'تعذّر حفظ التعديلات'}
        </p>
      ) : null}

      {canWrite ? (
        <div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={prepInvalid || radiusInvalid || addressInvalid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'جاري الحفظ…' : 'حفظ التعديلات'}
          </button>
        </div>
      ) : null}
    </Card>
  );
}

interface DayRow {
  dayOfWeek: number;
  opensAtMinute: number;
  closesAtMinute: number;
  isClosed: boolean;
}

function HoursCard({
  auth,
  data,
  canWrite,
  onChanged,
}: {
  auth: PortalAuth;
  data: PortalSettings;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [days, setDays] = useState<DayRow[]>(() => toDayRows(data.working_hours));

  // The server is the source of truth; refetching after a save must not leave
  // the form showing what the user typed if the server stored something else.
  useEffect(() => {
    setDays(toDayRows(data.working_hours));
  }, [data.working_hours]);

  const save = useMutation({
    mutationFn: () =>
      portal.setWorkingHours(
        auth,
        days.map((day) => ({
          day_of_week: day.dayOfWeek,
          opens_at_minute: day.opensAtMinute,
          closes_at_minute: day.closesAtMinute,
          is_closed: day.isClosed,
        })),
      ),
    onSuccess: onChanged,
  });

  const update = (dayOfWeek: number, patch: Partial<DayRow>) => {
    setDays((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    );
  };

  // A zero-length window is a data error, not "open all day" — the same rule
  // the server applies, checked here so the button explains itself.
  const invalidDay = days.find(
    (day) => !day.isClosed && day.opensAtMinute === day.closesAtMinute,
  );

  return (
    <Card title="ساعات العمل" subtitle="بتوقيت بغداد. يمكن أن تمتد الفترة بعد منتصف الليل">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">اليوم</th>
              <th scope="col">يفتح</th>
              <th scope="col">يغلق</th>
              <th scope="col">مغلق</th>
              <th scope="col">ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const overnight = !day.isClosed && day.closesAtMinute <= day.opensAtMinute;
              return (
                <tr key={day.dayOfWeek}>
                  <td>
                    <strong>{DAY_NAMES[day.dayOfWeek]}</strong>
                  </td>
                  <td>
                    <input
                      type="time"
                      aria-label={`وقت الفتح يوم ${DAY_NAMES[day.dayOfWeek]}`}
                      value={toTimeValue(day.opensAtMinute)}
                      disabled={!canWrite || day.isClosed}
                      onChange={(event) =>
                        update(day.dayOfWeek, { opensAtMinute: toMinutes(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      aria-label={`وقت الإغلاق يوم ${DAY_NAMES[day.dayOfWeek]}`}
                      value={toTimeValue(day.closesAtMinute)}
                      disabled={!canWrite || day.isClosed}
                      onChange={(event) =>
                        update(day.dayOfWeek, { closesAtMinute: toMinutes(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`مغلق يوم ${DAY_NAMES[day.dayOfWeek]}`}
                      checked={day.isClosed}
                      disabled={!canWrite}
                      onChange={(event) =>
                        update(day.dayOfWeek, { isClosed: event.target.checked })
                      }
                    />
                  </td>
                  <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    {day.isClosed
                      ? 'اليوم مغلق'
                      : day.opensAtMinute === day.closesAtMinute
                        ? 'وقتا الفتح والإغلاق متطابقان — حدّد فترة فعلية'
                        : overnight
                          ? 'تمتد بعد منتصف الليل إلى اليوم التالي'
                          : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
        The overnight case is the one that bites: a Monday 18:00–02:00 window
        belongs to Monday's shift, so 01:00 on Tuesday is still Monday's
        opening, not Tuesday's (plan §105).
      */}
      <p
        style={{
          marginBlockStart: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
        }}
      >
        إذا كان وقت الإغلاق قبل وقت الفتح فالفترة تمتد إلى اليوم التالي. مثلاً الاثنين ١٨:٠٠ حتى
        ٠٢:٠٠ تعني أن الساعة الواحدة فجراً ما زالت ضمن دوام الاثنين.
      </p>

      {invalidDay ? (
        <p className="alert-bar alert-bar--danger" role="alert">
          <span style={{ flex: 1 }}>
            يوم {DAY_NAMES[invalidDay.dayOfWeek]}: وقتا الفتح والإغلاق متطابقان. حدّد فترة فعلية أو
            علّم اليوم كمغلق.
          </span>
        </p>
      ) : null}

      {save.error ? (
        <p className="alert-bar alert-bar--danger" role="alert">
          {save.error instanceof ApiError ? save.error.messageAr : 'تعذّر حفظ ساعات العمل'}
        </p>
      ) : null}

      {save.isSuccess && !invalidDay ? (
        <p className="alert-bar alert-bar--success" role="status">
          <span style={{ flex: 1 }}>حُفظت ساعات العمل.</span>
        </p>
      ) : null}

      {canWrite ? (
        <div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={invalidDay !== undefined || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'جاري الحفظ…' : 'حفظ ساعات العمل'}
          </button>
        </div>
      ) : null}
    </Card>
  );
}

function LocationCard({ data }: { data: PortalSettings }) {
  return (
    <Card title="الموقع والعمولة" subtitle="بنود تديرها إدارة جيبلي وليست قابلة للتعديل هنا">
      <div className="split">
        <div className="figure">
          <span className="figure__label">المحافظة</span>
          <span className="figure__value" style={{ fontSize: 'var(--text-sm)' }}>
            {data.branch.governorate_name_ar}
          </span>
        </div>
        <div className="figure">
          <span className="figure__label">المدينة</span>
          <span className="figure__value" style={{ fontSize: 'var(--text-sm)' }}>
            {data.branch.city_name_ar}
          </span>
        </div>
      </div>

      <p style={{ color: 'var(--text-secondary)' }}>
        نسبة العمولة بند تعاقدي تديره إدارة جيبلي، ولا تُعدَّل من لوحة المطعم. تجد النسبة المطبّقة
        على كل طلب في صفحة العمولات.
      </p>

      <p style={{ color: 'var(--text-secondary)', marginBlockEnd: 0 }}>
        الانتقال إلى مدينة أخرى يتطلّب طلب موافقة من الإدارة — لا يتغيّر الموقع بمجرّد تعديل حقل.
        يبقى الفرع الحالي يعمل حتى تُعتمد الموافقة، وتحتفظ الطلبات السابقة بموقعها الأصلي. تواصل مع
        الدعم لبدء الطلب.
      </p>
    </Card>
  );
}

/**
 * One row per weekday, filled from the server's schedule.
 *
 * The API allows several windows per day (a lunch and a dinner shift); this
 * form edits one window per day, so a day that already has several is shown as
 * its first window and the rest are left untouched until multi-window editing
 * exists. Defaults are a plain 10:00–23:00 for days with no rule at all.
 */
function toDayRows(hours: WorkingHour[]): DayRow[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const existing = hours.find((hour) => hour.day_of_week === dayOfWeek);
    return {
      dayOfWeek,
      opensAtMinute: existing?.opens_at_minute ?? 10 * 60,
      closesAtMinute: existing?.closes_at_minute ?? 23 * 60,
      isClosed: existing?.is_closed ?? false,
    };
  });
}

function toTimeValue(minuteOfDay: number): string {
  const clamped = Math.max(0, Math.min(minuteOfDay, 1440));
  const hours = Math.floor(clamped / 60) % 24;
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours ?? 0) * 60 + Number(minutes ?? 0);
}
