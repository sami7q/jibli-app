'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESTAURANT_ROLE_LABELS, dateAr } from '@jibli/ui-web';
import type { RestaurantRole } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  MfaChallenge,
  Money,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type CommissionConfigView } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';
import { SignedOut } from '@/components/signed-out';

/**
 * Restaurant detail (plan §18, §24, §122).
 *
 * The readiness checklist is the centrepiece: plan §122 says "Admin approval UI
 * shows readiness failures rather than relying on memory", and activation is
 * gated on it here rather than being a button someone can press hopefully.
 */
export default function RestaurantDetailPage() {
  const params = useParams<{ restaurantId: string }>();
  const restaurantId = params.restaurantId;
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const [suspending, setSuspending] = useState(false);
  const [editingCommission, setEditingCommission] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const restaurant = useQuery({
    queryKey: ['admin-restaurant', restaurantId],
    queryFn: () => admin.restaurant(token, restaurantId),
    enabled: session.status === 'authenticated',
  });

  const readiness = useQuery({
    queryKey: ['admin-readiness', restaurantId],
    queryFn: () => admin.readiness(token, restaurantId),
    enabled: session.status === 'authenticated',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-restaurant', restaurantId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-readiness', restaurantId] });
  };

  const suspend = useMutation({
    mutationFn: (reason: string) => admin.suspendRestaurant(token, restaurantId, reason),
    onSuccess: () => {
      setSuspending(false);
      invalidate();
    },
  });

  const activate = useMutation({
    mutationFn: () => admin.activateRestaurant(token, restaurantId),
    onSuccess: invalidate,
  });

  if (session.status !== 'authenticated') {
    return <SignedOut reason={session.status === 'unauthenticated' ? session.reason : undefined} />;
  }

  const data = restaurant.data;
  const isActive = data?.operational_status === 'ACTIVE';
  const canActivate = readiness.data?.ready === true && !isActive;

  return (
    <AdminShell
      title={data?.display_name ?? 'المطعم'}
      subtitle={
        data
          ? `رقم الشريك #${data.partner_code} · ${data.branch?.governorate_name_ar ?? ''} ${data.branch?.city_name_ar ?? ''}`
          : undefined
      }
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        data ? (
          isActive ? (
            <button type="button" className="btn btn--danger" onClick={() => setSuspending(true)}>
              إيقاف المطعم
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canActivate || activate.isPending}
              onClick={() => activate.mutate()}
              title={canActivate ? undefined : 'أكمل قائمة الجاهزية أولاً'}
            >
              {activate.isPending ? 'جاري التفعيل…' : 'تفعيل المطعم'}
            </button>
          )
        ) : undefined
      }
    >
      {restaurant.isError ? (
        <ErrorState
          message={
            restaurant.error instanceof ApiError ? restaurant.error.messageAr : 'تعذّر تحميل المطعم'
          }
          onRetry={() => void restaurant.refetch()}
        />
      ) : restaurant.isLoading ? (
        <Skeleton height={400} />
      ) : data ? (
        <>
          {data.suspended_reason ? (
            <div className="alert-bar alert-bar--danger" role="alert">
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span>المطعم موقوف. السبب: {data.suspended_reason}</span>
            </div>
          ) : null}

          {/*
            Eligibility is a conjunction of independent layers (plan §18). If the
            restaurant is ACTIVE but the city is closed, the operator needs to
            know it is the city — not the restaurant — that is blocking.
          */}
          {isActive && !data.city_ordering_enabled ? (
            <div className="alert-bar alert-bar--warning">
              <Icon name="geography" className="nav__icon" aria-hidden />
              <span>
                المطعم مفعّل لكن الطلبات معطّلة في مدينته، لذلك لا يظهر للعملاء. هذا إعداد تغطية
                وليس مشكلة في المطعم.
              </span>
            </div>
          ) : null}

          <Card title="قائمة الجاهزية" icon="applications" subtitle="ما يلزم قبل استقبال الطلبات">
            {readiness.isLoading ? (
              <Skeleton height={200} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {(readiness.data?.checks ?? []).map((check) => (
                  <div
                    key={check.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      background: check.passed
                        ? 'var(--jibli-success-50)'
                        : check.blocking
                          ? 'var(--jibli-danger-50)'
                          : 'var(--jibli-warning-50)',
                    }}
                  >
                    <Icon name={check.passed ? 'check' : 'close'} className="nav__icon" aria-hidden />
                    <span style={{ flex: 1 }}>{check.label_ar}</span>
                    {!check.blocking ? <Badge tone="neutral">غير مانع</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="العمولة" icon="commissions">
            <div className="card__header" style={{ marginBottom: 'var(--space-3)' }}>
              <div />
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setEditingCommission(true)}
              >
                تعديل النسبة
              </button>
            </div>

            <DataTable<CommissionConfigView>
              caption="سجل نسب العمولة"
              rows={data.commission_history}
              keyOf={(row) => row.effective_from}
              emptyMessage="لم تُضبط نسبة عمولة بعد"
              columns={[
                {
                  key: 'rate',
                  header: 'النسبة',
                  numeric: true,
                  render: (row) => <strong>{row.rate_display}</strong>,
                },
                {
                  key: 'policy',
                  header: 'دورة التسوية',
                  render: (row) => (row.settlement_policy === 'HALF_MONTH' ? 'نصف شهرية' : 'شهرية'),
                },
                {
                  key: 'terms',
                  header: 'مهلة السداد',
                  numeric: true,
                  render: (row) => `${row.payment_term_days} يوم`,
                },
                { key: 'from', header: 'سارية من', render: (row) => dateAr(row.effective_from) },
                {
                  key: 'to',
                  header: 'سارية حتى',
                  render: (row) =>
                    row.is_current ? <Badge tone="success">الحالية</Badge> : dateAr(row.effective_to ?? ''),
                },
              ]}
            />

            <p
              style={{
                marginTop: 'var(--space-3)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
              }}
            >
              كل طلب يحتفظ بالنسبة التي كانت سارية لحظة إنشائه. تعديل النسبة لا يؤثر على الطلبات
              أو الكشوف السابقة.
            </p>
          </Card>

          <Card title="الفرع" icon="restaurants">
            {data.branch ? (
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '8px 16px',
                  margin: 0,
                }}
              >
                <dt style={{ color: 'var(--text-muted)' }}>العنوان</dt>
                <dd style={{ margin: 0 }}>{data.branch.address_text}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>المدينة</dt>
                <dd style={{ margin: 0 }}>
                  {data.branch.governorate_name_ar} - {data.branch.city_name_ar}
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>الهاتف</dt>
                <dd style={{ margin: 0 }} className="ltr-inline">
                  {data.branch.phone ?? '—'}
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>رسوم التوصيل</dt>
                <dd style={{ margin: 0 }}>
                  <Money amount={data.branch.delivery_fee_iqd} />
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>الحد الأدنى للطلب</dt>
                <dd style={{ margin: 0 }}>
                  <Money amount={data.minimum_order_iqd} />
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>الإحداثيات</dt>
                <dd style={{ margin: 0 }} className="ltr-inline">
                  {data.branch.latitude && data.branch.longitude
                    ? `${data.branch.latitude}, ${data.branch.longitude}`
                    : 'غير محددة'}
                </dd>
              </dl>
            ) : (
              <p className="empty">لا يوجد فرع مسجّل</p>
            )}
          </Card>

          <Card title="الموظفون" icon="staff">
            <DataTable
              caption="موظفو المطعم"
              rows={data.staff}
              keyOf={(row) => `${row.user_id}-${row.role}`}
              emptyMessage="لا يوجد موظفون"
              columns={[
                { key: 'name', header: 'الاسم', render: (row) => row.name ?? '—' },
                {
                  key: 'phone',
                  header: 'الهاتف',
                  render: (row) => <span className="ltr-inline">{row.phone}</span>,
                },
                {
                  key: 'role',
                  header: 'الدور',
                  render: (row) => RESTAURANT_ROLE_LABELS[row.role as RestaurantRole] ?? row.role,
                },
                {
                  key: 'active',
                  header: 'الحالة',
                  render: (row) => (
                    <Badge tone={row.is_active ? 'success' : 'neutral'}>
                      {row.is_active ? 'نشط' : 'موقوف'}
                    </Badge>
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}

      {suspending ? (
        <ConfirmDialog
          title={`إيقاف ${data?.display_name ?? 'المطعم'}`}
          confirmLabel="إيقاف المطعم"
          requireReason
          isSubmitting={suspend.isPending}
          error={suspend.error instanceof ApiError ? suspend.error.messageAr : null}
          body={
            <div className="dialog__impact">
              <strong>
                <Icon name="alert" className="nav__icon" aria-hidden /> ماذا يحدث
              </strong>
              <p style={{ margin: 0 }}>
                يتوقف استقبال الطلبات الجديدة فوراً ويختفي المطعم من التطبيق. الطلبات النشطة
                الحالية تكمل مسارها حتى لا يضيع طعام أو نقد. لا تُحذف أي بيانات أو كشوف.
              </p>
            </div>
          }
          onConfirm={(reason) => suspend.mutate(reason)}
          onCancel={() => setSuspending(false)}
        />
      ) : null}

      {editingCommission ? (
        <CommissionDialog
          token={token}
          restaurantId={restaurantId}
          current={data?.commission_history.find((config) => config.is_current)}
          onDone={() => {
            setEditingCommission(false);
            invalidate();
          }}
          onNeedsMfa={() => {
            setEditingCommission(false);
            setNeedsMfa(true);
          }}
          onCancel={() => setEditingCommission(false)}
        />
      ) : null}

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}

function CommissionDialog({
  token,
  restaurantId,
  current,
  onDone,
  onNeedsMfa,
  onCancel,
}: {
  token: string;
  restaurantId: string;
  current: CommissionConfigView | undefined;
  onDone: () => void;
  onNeedsMfa: () => void;
  onCancel: () => void;
}) {
  const [percent, setPercent] = useState(current ? current.rate_bps / 100 : 15);
  const [reason, setReason] = useState('');

  const update = useMutation({
    mutationFn: () =>
      admin.updateCommission(token, restaurantId, {
        commission_rate_bps: Math.round(percent * 100),
        reason,
      }),
    onSuccess: onDone,
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) onNeedsMfa();
    },
  });

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="commission-title">
      <div className="dialog">
        <h2 id="commission-title">تعديل نسبة العمولة</h2>

        {current ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            النسبة الحالية: <strong>{current.rate_display}</strong>
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="commission-percent">النسبة الجديدة (%)</label>
          <input
            id="commission-percent"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={percent}
            onChange={(event) => setPercent(Number(event.target.value))}
          />
        </div>

        <div className="dialog__impact">
          <p style={{ margin: 0 }}>
            تسري النسبة الجديدة على الطلبات الجديدة فقط. الطلبات والكشوف السابقة تحتفظ بالنسبة
            التي سُجّلت عليها — هذا يمنع تغيّر الفواتير الصادرة بأثر رجعي.
          </p>
        </div>

        <div className="field">
          <label htmlFor="commission-reason">سبب التعديل (مطلوب)</label>
          <textarea
            id="commission-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {update.error && !(update.error instanceof ApiError && update.error.needsReauth) ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {update.error instanceof ApiError ? update.error.messageAr : 'تعذّر التعديل'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={reason.trim().length < 5 || update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? 'جاري الحفظ…' : 'حفظ النسبة'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
