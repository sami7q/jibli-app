'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COUPON_FUNDING_SOURCES,
  COUPON_TYPES,
  type CouponFundingSource,
  type CouponType,
} from '@jibli/contracts';
import {
  bpsPercent,
  COUPON_FUNDING_LABELS,
  COUPON_STATE_LABELS,
  COUPON_TYPE_LABELS,
  money,
} from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import { Card, ConfirmDialog, ErrorState, ForbiddenState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type AdminCoupon } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';
import { SignedOut } from '@/components/signed-out';

/**
 * Coupons (plan §60).
 *
 * The funding source is the important column, and this screen keeps it next to
 * the money at all times: it decides whether a discount reduces what Jibli
 * charges commission on, or whether the restaurant is charged as if the
 * discount never happened. Getting it wrong is a billing dispute, not a
 * cosmetic error.
 *
 * A coupon's terms are never editable after creation — only enable/disable.
 * Orders snapshot the discount and its funding, so a later edit would make the
 * definition disagree with money already charged.
 */

const STATE_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  SCHEDULED: 'warning',
  EXPIRED: 'neutral',
  DISABLED: 'neutral',
  EXHAUSTED: 'warning',
};

export default function CouponsPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<AdminCoupon | null>(null);
  const [status, setStatus] = useState('');

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const coupons = useQuery({
    queryKey: ['admin-coupons', status],
    queryFn: () => admin.coupons(token, status || undefined),
    enabled: session.status === 'authenticated',
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive, reason }: { id: string; isActive: boolean; reason: string }) =>
      admin.setCouponActive(token, id, isActive, reason),
    onSuccess: () => {
      setToggling(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-coupons'] });
    },
  });

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <Skeleton height={400} />
      </div>
    );
  }

  if (session.status === 'unauthenticated') {
    return <SignedOut reason={session.status === 'unauthenticated' ? session.reason : undefined} />;
  }

  // Marketing holds coupon.manage without holding finance or operations.
  const canManage = session.permissions.includes('coupon.manage');

  return (
    <AdminShell
      title="الكوبونات والعروض"
      subtitle="خصومات العملاء ومصدر تمويل كل منها"
      userName={session.userName}
      userRoleAr={session.roleAr}
      actions={
        canManage ? (
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            إنشاء كوبون
          </button>
        ) : null
      }
    >
      {!canManage ? (
        <ForbiddenState requiredAr="إدارة الكوبونات" />
      ) : (
        <>
          <Card>
            <p className="alert-bar alert-bar--warning" role="note">
              <span style={{ flex: 1 }}>
                مصدر التمويل يحدّد أساس احتساب العمولة: الخصم الذي تموّله جيبلي لا يُنقص ما
                يُحتسب على المطعم، بينما الخصم الذي يموّله المطعم يُنقصه. لا يمكن تعديل شروط
                الكوبون بعد إنشائه — فقط إيقافه.
              </span>
            </p>

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBlockStart: 'var(--space-4)' }}>
              {[
                { value: '', label: 'الكل' },
                { value: 'active', label: 'فعّال' },
                { value: 'scheduled', label: 'مجدول' },
                { value: 'expired', label: 'منتهي' },
                { value: 'disabled', label: 'موقوف' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`btn btn--${status === option.value ? 'primary' : 'ghost'} btn--sm`}
                  aria-pressed={status === option.value}
                  onClick={() => setStatus(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="الكوبونات">
            {coupons.isError ? (
              <ErrorState
                message={
                  coupons.error instanceof ApiError
                    ? coupons.error.messageAr
                    : 'تعذّر تحميل الكوبونات'
                }
                onRetry={() => void coupons.refetch()}
              />
            ) : null}

            {coupons.isLoading ? <Skeleton height={260} /> : null}

            {coupons.data ? (
              coupons.data.length === 0 ? (
                <div className="empty">
                  <p style={{ margin: 0, fontWeight: 600 }}>لا توجد كوبونات</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">الرمز</th>
                        <th scope="col">الخصم</th>
                        <th scope="col">مصدر التمويل</th>
                        <th scope="col">النطاق</th>
                        <th scope="col" className="numeric">
                          الاستخدام
                        </th>
                        <th scope="col" className="numeric">
                          إجمالي الخصم
                        </th>
                        <th scope="col">الحالة</th>
                        <th scope="col" />
                      </tr>
                    </thead>
                    <tbody>
                      {coupons.data.map((coupon) => (
                        <tr key={coupon.id}>
                          <td>
                            <strong className="ltr-inline">{coupon.code}</strong>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                              حد أدنى للطلب {money(coupon.minimum_order_iqd)}
                            </div>
                          </td>
                          <td>
                            {coupon.type === 'PERCENTAGE'
                              ? bpsPercent(coupon.value)
                              : money(coupon.value)}
                            {coupon.max_discount_iqd ? (
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                                بحد أقصى {money(coupon.max_discount_iqd)}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {COUPON_FUNDING_LABELS[coupon.funding_source as CouponFundingSource] ??
                              coupon.funding_source}
                            {coupon.restaurant_share_bps !== null ? (
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                                حصة المطعم {bpsPercent(coupon.restaurant_share_bps)}
                              </div>
                            ) : null}
                          </td>
                          <td>{coupon.restaurant_name ?? 'كل المطاعم'}</td>
                          <td className="numeric">
                            {coupon.usage_count}
                            {coupon.total_usage_limit !== null
                              ? ` / ${coupon.total_usage_limit}`
                              : ''}
                          </td>
                          <td className="numeric">{money(coupon.discount_given_iqd)}</td>
                          <td>
                            <span className={`badge badge--${STATE_TONES[coupon.state] ?? 'neutral'}`}>
                              {COUPON_STATE_LABELS[coupon.state] ?? coupon.state}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`btn btn--${coupon.is_active ? 'danger' : 'ghost'} btn--sm`}
                              onClick={() => setToggling(coupon)}
                            >
                              {coupon.is_active ? 'إيقاف' : 'تفعيل'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}
          </Card>
        </>
      )}

      {creating ? (
        <CreateCouponDialog
          token={token}
          onDone={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['admin-coupons'] });
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {toggling ? (
        <ConfirmDialog
          title={`${toggling.is_active ? 'إيقاف' : 'تفعيل'} الكوبون ${toggling.code}`}
          confirmLabel={toggling.is_active ? 'إيقاف' : 'تفعيل'}
          requireReason
          isSubmitting={setActive.isPending}
          error={setActive.error instanceof ApiError ? setActive.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {toggling.is_active
                ? 'لن يقبل النظام هذا الرمز في طلبات جديدة. الطلبات السابقة تحتفظ بخصمها كما هو.'
                : 'سيعود الرمز صالحاً للاستخدام ضمن فترته وحدوده.'}
            </p>
          }
          onConfirm={(reason) =>
            setActive.mutate({ id: toggling.id, isActive: !toggling.is_active, reason })
          }
          onCancel={() => setToggling(null)}
        />
      ) : null}
    </AdminShell>
  );
}

function CreateCouponDialog({
  token,
  onDone,
  onCancel,
}: {
  token: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<CouponType>('PERCENTAGE');
  const [value, setValue] = useState(1000);
  const [maxDiscount, setMaxDiscount] = useState(0);
  const [minimumOrder, setMinimumOrder] = useState(0);
  const [funding, setFunding] = useState<CouponFundingSource>('PLATFORM');
  const [shareBps, setShareBps] = useState(5000);
  const [totalLimit, setTotalLimit] = useState(0);
  const [perUserLimit, setPerUserLimit] = useState(1);
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState('');

  const create = useMutation({
    mutationFn: () =>
      admin.createCoupon(token, {
        code: code.trim().toUpperCase(),
        type,
        value,
        max_discount_iqd: type === 'PERCENTAGE' && maxDiscount > 0 ? maxDiscount : undefined,
        minimum_order_iqd: minimumOrder,
        funding_source: funding,
        restaurant_share_bps: funding === 'SHARED' ? shareBps : undefined,
        total_usage_limit: totalLimit > 0 ? totalLimit : undefined,
        per_user_usage_limit: perUserLimit,
        starts_at: new Date(`${startsAt}T00:00:00Z`).toISOString(),
        ends_at: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : undefined,
      }),
    onSuccess: onDone,
  });

  const codeValid = /^[A-Z0-9-]{3,24}$/.test(code.trim().toUpperCase());
  const valueValid =
    value > 0 && (type === 'FIXED_AMOUNT' || value <= 10_000) && Number.isInteger(value);
  // RESTAURANT funding needs a named restaurant, which this dialog does not yet
  // pick — so it is offered only for platform-wide and shared coupons.
  const fundingOptions = COUPON_FUNDING_SOURCES.filter((source) => source !== 'RESTAURANT');

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="cpn-title">
      <div className="dialog">
        <h2 id="cpn-title">إنشاء كوبون</h2>

        <div className="field">
          <label htmlFor="cpn-code">الرمز</label>
          <input
            id="cpn-code"
            dir="ltr"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="WELCOME25"
            aria-invalid={code !== '' && !codeValid}
          />
          <span className="field__hint">
            أحرف إنجليزية كبيرة وأرقام وشرطة فقط — العميل يقرأه ويكتبه بيده.
          </span>
        </div>

        <div className="field">
          <label htmlFor="cpn-type">نوع الخصم</label>
          <select
            id="cpn-type"
            value={type}
            onChange={(event) => setType(event.target.value as CouponType)}
          >
            {COUPON_TYPES.map((option) => (
              <option key={option} value={option}>
                {COUPON_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="cpn-value">
            {type === 'PERCENTAGE' ? 'النسبة (نقطة أساس — 1000 = 10%)' : 'المبلغ (دينار)'}
          </label>
          <input
            id="cpn-value"
            type="number"
            min={1}
            step={type === 'PERCENTAGE' ? 100 : 250}
            value={value}
            onChange={(event) => setValue(Math.trunc(Number(event.target.value)))}
            aria-invalid={!valueValid}
          />
          {type === 'PERCENTAGE' ? (
            <span className="field__hint">القيمة الحالية تعادل {bpsPercent(value)}</span>
          ) : null}
        </div>

        {type === 'PERCENTAGE' ? (
          <div className="field">
            <label htmlFor="cpn-max">الحد الأقصى للخصم (اختياري)</label>
            <input
              id="cpn-max"
              type="number"
              min={0}
              step={250}
              value={maxDiscount}
              onChange={(event) => setMaxDiscount(Math.trunc(Number(event.target.value)))}
            />
            <span className="field__hint">صفر يعني بلا حد أقصى.</span>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="cpn-min">الحد الأدنى لقيمة الطلب</label>
          <input
            id="cpn-min"
            type="number"
            min={0}
            step={250}
            value={minimumOrder}
            onChange={(event) => setMinimumOrder(Math.trunc(Number(event.target.value)))}
          />
        </div>

        <div className="field">
          <label htmlFor="cpn-funding">مصدر التمويل</label>
          <select
            id="cpn-funding"
            value={funding}
            onChange={(event) => setFunding(event.target.value as CouponFundingSource)}
          >
            {fundingOptions.map((option) => (
              <option key={option} value={option}>
                {COUPON_FUNDING_LABELS[option]}
              </option>
            ))}
          </select>
          <span className="field__hint">
            {funding === 'PLATFORM'
              ? 'تتحمّله جيبلي بالكامل — يُحتسب على المطعم كأن الخصم لم يحدث.'
              : 'يُقسَّم الخصم؛ حصة المطعم تُنقص ما يُحتسب عليه.'}
          </span>
        </div>

        {funding === 'SHARED' ? (
          <div className="field">
            <label htmlFor="cpn-share">حصة المطعم (نقطة أساس)</label>
            <input
              id="cpn-share"
              type="number"
              min={0}
              max={10000}
              step={500}
              value={shareBps}
              onChange={(event) => setShareBps(Math.trunc(Number(event.target.value)))}
            />
            <span className="field__hint">
              {bpsPercent(shareBps)} على المطعم و {bpsPercent(10_000 - shareBps)} على جيبلي.
            </span>
          </div>
        ) : null}

        <div className="split">
          <div className="field">
            <label htmlFor="cpn-total">حد الاستخدام الكلي</label>
            <input
              id="cpn-total"
              type="number"
              min={0}
              value={totalLimit}
              onChange={(event) => setTotalLimit(Math.trunc(Number(event.target.value)))}
            />
            <span className="field__hint">صفر يعني بلا حد.</span>
          </div>

          <div className="field">
            <label htmlFor="cpn-per-user">حد الاستخدام لكل عميل</label>
            <input
              id="cpn-per-user"
              type="number"
              min={1}
              value={perUserLimit}
              onChange={(event) => setPerUserLimit(Math.trunc(Number(event.target.value)))}
            />
          </div>
        </div>

        <div className="split">
          <div className="field">
            <label htmlFor="cpn-start">يبدأ في</label>
            <input
              id="cpn-start"
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="cpn-end">ينتهي في (اختياري)</label>
            <input
              id="cpn-end"
              type="date"
              min={startsAt}
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>
        </div>

        <p className="alert-bar alert-bar--warning">
          <span style={{ flex: 1 }}>
            لا يمكن تعديل شروط الكوبون بعد الإنشاء. لتغييرها أوقف هذا الرمز وأنشئ رمزاً جديداً.
          </span>
        </p>

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر إنشاء الكوبون'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!codeValid || !valueValid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الإنشاء…' : 'إنشاء'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
