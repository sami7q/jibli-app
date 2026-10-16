'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESTAURANT_ROLE_LABELS, dateAr, NumberField, relativeAr } from '@jibli/ui-web';
import {
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  type MerchantType,
  type RestaurantRole,
} from '@jibli/contracts';
import { AdminShell, ForbiddenShell } from '@/components/shell';
import { PortalCredentials } from '@/components/portal-credentials';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  MfaChallenge,
  Money,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type CatalogMenu, type CommissionConfigView } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

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
  const [editingKind, setEditingKind] = useState(false);
  const [kindNote, setKindNote] = useState<string | null>(null);
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
    return <SessionGate session={session} />;
  }
  if (!session.can('restaurant.read')) {
    return <ForbiddenShell session={session} requiredAr="قراءة المتاجر" />;
  }

  // Action gating (ADMIN-11): each control mirrors the permission its route
  // enforces, so a read-only role no longer sees buttons that only end in
  // «لا تملك صلاحية».
  const canSuspend = session.can('restaurant.suspend');
  const canCommission = session.can('restaurant.commission.update');
  const canChangeKind = session.can('restaurant.create');
  const canCredentials = session.can('restaurant.create');

  const data = restaurant.data;
  const isActive = data?.operational_status === 'ACTIVE';
  // An older API says nothing; the column's default is what it holds then.
  const kind: MerchantType = data?.merchant_type ?? 'RESTAURANT';
  const canActivate = readiness.data?.ready === true && !isActive;
  const isShop = kind === 'MARKET' || kind === 'COSMETICS';
  const requested = !isActive && Boolean(data?.activation_requested_at);

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
        data && canSuspend ? (
          isActive ? (
            <button type="button" className="btn btn--danger" onClick={() => setSuspending(true)}>
              {isShop ? 'إيقاف المتجر' : 'إيقاف المطعم'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canActivate || activate.isPending}
              onClick={() => activate.mutate()}
              title={canActivate ? undefined : 'أكمل قائمة الجاهزية أولاً'}
            >
              {activate.isPending ? 'جاري التفعيل…' : isShop ? 'تفعيل المتجر' : 'تفعيل المطعم'}
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
              <span>
                {isShop ? 'المتجر موقوف' : 'المطعم موقوف'}. السبب: {data.suspended_reason}
              </span>
            </div>
          ) : null}

          {/*
            The owner pressed «اطلب التفعيل» in the app. This is the one line
            that turns the page from a record into a task: everything the
            owner could do is done, and the button at the top is what is left.
          */}
          {requested ? (
            <div
              className={`alert-bar ${canActivate ? 'alert-bar--success' : 'alert-bar--warning'}`}
              role="status"
            >
              <Icon name="applications" className="nav__icon" aria-hidden />
              <span style={{ flex: 1 }}>
                طلب صاحب المتجر التفعيل من التطبيق{' '}
                {data.activation_requested_at
                  ? relativeAr(new Date(data.activation_requested_at))
                  : ''}
                {data.activation_request_note ? ` — «${data.activation_request_note}»` : ''}
                {canActivate
                  ? '. قائمة الجاهزية مكتملة؛ اضغط «تفعيل» في الأعلى ليبدأ باستقبال الطلبات.'
                  : '. بقي في قائمة الجاهزية ما يمنع التفعيل؛ راجعها أدناه.'}
              </span>
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
                {isShop ? 'المتجر مفعّل' : 'المطعم مفعّل'} لكن الطلبات معطّلة في مدينته، لذلك لا
                يظهر للعملاء. هذا إعداد تغطية وليس مشكلة في {isShop ? 'المتجر' : 'المطعم'}.
              </span>
            </div>
          ) : null}

          {/*
            Which section the shop sells in, said up front. The page never
            showed it, so a market that had been saved as a restaurant looked
            exactly like a market here — until its owner opened the app and
            was turned away.
          */}
          <Card
            title="نوع الشريك"
            icon="restaurants"
            subtitle="القسم الذي يظهر فيه داخل التطبيق، ومن أين يُدار"
            actions={
              canChangeKind ? (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => setEditingKind(true)}
                >
                  تغيير النوع
                </button>
              ) : null
            }
          >
            {kindNote ? (
              <p className="alert-bar alert-bar--warning" role="status">
                {kindNote}
              </p>
            ) : null}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                flexWrap: 'wrap',
              }}
            >
              <Badge tone={KIND_TONE[kind]}>{MERCHANT_TYPE_LABELS[kind].nameAr}</Badge>
              <span style={{ color: 'var(--text-secondary)' }}>{KIND_MANAGED[kind]}</span>
            </div>
          </Card>

          <Card
            title="قائمة الجاهزية"
            icon="applications"
            subtitle={
              isShop
                ? 'ما يلزم قبل استقبال الطلبات. للماركت والكوزمتك: الموقع وأوقات العمل لا يمنعان التفعيل — صاحب المتجر يكملهما من التطبيق، وتُكتب أوقات افتراضية عند التفعيل إن لم يضبطها.'
                : 'ما يلزم قبل استقبال الطلبات'
            }
          >
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
                    <Icon
                      name={check.passed ? 'check' : 'close'}
                      className="nav__icon"
                      aria-hidden
                    />
                    <span style={{ flex: 1 }}>
                      {check.label_ar}
                      {!check.passed ? (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {checkHint(check.key, isShop)}
                        </span>
                      ) : null}
                    </span>
                    {!check.blocking ? <Badge tone="neutral">غير مانع</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="العمولة"
            icon="commissions"
            subtitle="قيمة ثابتة عن كل طلب، لا تتغيّر بحجم الطلب"
            actions={
              canCommission ? (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => setEditingCommission(true)}
                >
                  تعديل العمولة
                </button>
              ) : null
            }
          >
            <DataTable<CommissionConfigView>
              caption="سجل قيم العمولة"
              rows={data.commission_history}
              keyOf={(row) => row.effective_from}
              emptyMessage="لم تُضبط عمولة بعد"
              columns={[
                {
                  key: 'amount',
                  header: 'العمولة',
                  numeric: true,
                  render: (row) => <strong>{row.commission_display}</strong>,
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
                    row.is_current ? (
                      <Badge tone="success">الحالية</Badge>
                    ) : (
                      dateAr(row.effective_to ?? '')
                    ),
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
              كل طلب يحتفظ بقيمة العمولة التي كانت سارية لحظة إنشائه. تعديل العمولة لا يؤثر على
              الطلبات أو الكشوف السابقة.
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
                <dd style={{ margin: 0 }}>
                  {data.branch.latitude && data.branch.longitude ? (
                    <span className="ltr-inline">
                      {data.branch.latitude}, {data.branch.longitude}
                    </span>
                  ) : isShop ? (
                    'غير محددة — يثبّتها صاحب المتجر من التطبيق (اختياري)'
                  ) : (
                    'غير محددة'
                  )}
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>ساعات العمل</dt>
                <dd style={{ margin: 0 }}>
                  {data.working_hours ? (
                    data.working_hours.configured ? (
                      <span className="ltr-inline" dir="auto">
                        {data.working_hours.summary_ar}
                      </span>
                    ) : isShop ? (
                      'لم تُضبط بعد — يضبطها صاحب المتجر من التطبيق، أو تُكتب 08:00–23:00 تلقائياً عند التفعيل'
                    ) : (
                      'لم تُضبط بعد — من لوحة التحكم'
                    )
                  ) : (
                    '—'
                  )}
                </dd>
              </dl>
            ) : (
              <p className="empty">لا يوجد فرع مسجّل</p>
            )}
          </Card>

          {/*
            Portal credentials sit directly above the staff list: they are the
            same subject seen from two sides — who can sign in, and who works
            here.
          */}
          <PortalCredentials
            token={token}
            restaurantId={restaurantId}
            restaurantName={data.display_name}
            recoveryPhone={data.password_recovery_phone ?? null}
            isShop={isShop}
            canManage={canCredentials}
          />

          {/* Read-only menu, so an operator can answer a complaint or confirm
              readiness without leaving the portal (ADMIN-15). */}
          <MenuCard token={token} restaurantId={restaurantId} />

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
                يتوقف استقبال الطلبات الجديدة فوراً ويختفي المطعم من التطبيق. الطلبات النشطة الحالية
                تكمل مسارها حتى لا يضيع طعام أو نقد. لا تُحذف أي بيانات أو كشوف.
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

      {editingKind && data ? (
        <KindDialog
          token={token}
          restaurantId={restaurantId}
          name={data.display_name}
          current={kind}
          onDone={(note) => {
            setEditingKind(false);
            setKindNote(note);
            invalidate();
          }}
          onCancel={() => setEditingKind(false)}
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
  const [amountIqd, setAmountIqd] = useState(current?.flat_iqd ?? 500);
  const [reason, setReason] = useState('');

  const update = useMutation({
    mutationFn: () =>
      admin.updateCommission(token, restaurantId, {
        commission_flat_iqd: amountIqd,
        reason,
      }),
    onSuccess: onDone,
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) onNeedsMfa();
    },
  });

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commission-title"
    >
      <div className="dialog">
        <h2 id="commission-title">تعديل عمولة هذا المطعم</h2>

        {current ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            العمولة الحالية: <strong>{current.commission_display}</strong>
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="commission-amount">العمولة الجديدة (د.ع لكل طلب)</label>
          <NumberField
            id="commission-amount"
            min={0}
            max={100000}
            value={amountIqd}
            onChange={(value) => setAmountIqd(value)}
          />
          <span className="field__hint">
            استثناء لهذا المطعم وحده. العمولة الموحّدة لكل المطاعم تُضبط من{' '}
            <Link href="/settings">إعدادات المنصة</Link>.
          </span>
        </div>

        <div className="dialog__impact">
          <p style={{ margin: 0 }}>
            تسري القيمة الجديدة على الطلبات الجديدة فقط. الطلبات والكشوف السابقة تحتفظ بالقيمة التي
            سُجّلت عليها — هذا يمنع تغيّر الفواتير الصادرة بأثر رجعي.
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
            disabled={reason.trim().length < 5 || amountIqd < 0 || update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? 'جاري الحفظ…' : 'حفظ العمولة'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Read-only menu card (ADMIN-15).
 *
 * Reuses the public catalog, which returns only active items and only for an
 * approved shop — so for a pending or suspended one it 404s, and the card says
 * so plainly rather than looking broken.
 */
function MenuCard({ token, restaurantId }: { token: string; restaurantId: string }) {
  const menu = useQuery({
    queryKey: ['admin-menu', restaurantId],
    queryFn: () => admin.catalogMenu(token, restaurantId),
    // The shop may not be public yet; a 404 is an expected answer, not a retry.
    retry: false,
  });

  const itemCount = (menu.data?.categories ?? []).reduce(
    (sum, category) => sum + category.items.length,
    0,
  );

  return (
    <Card title="القائمة" icon="orders" subtitle="الأصناف المعروضة للعملاء — للاطلاع فقط">
      {menu.isLoading ? (
        <Skeleton height={160} />
      ) : menu.isError ? (
        <EmptyState
          message="القائمة غير متاحة"
          hint="تظهر القائمة بعد اعتماد المتجر وتفعيله. تُدار الأصناف من تطبيق المتجر أو لوحته."
        />
      ) : (menu.data?.categories.length ?? 0) === 0 ? (
        <EmptyState message="لا توجد أصناف في القائمة بعد" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {menu.data?.categories.length ?? 0} تصنيفاً · {itemCount} صنفاً
          </p>
          {(menu.data?.categories ?? []).map((category) => (
            <div key={category.id}>
              <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-base)' }}>
                {category.name_ar}
              </h3>
              <DataTable<CatalogMenu['categories'][number]['items'][number]>
                caption={`أصناف ${category.name_ar}`}
                rows={category.items}
                keyOf={(item) => item.id}
                emptyMessage="لا أصناف"
                columns={[
                  {
                    key: 'name',
                    header: 'الصنف',
                    render: (item) => (
                      <span>
                        {item.name_ar}
                        {item.is_popular ? (
                          <span style={{ marginInlineStart: 6 }}>
                            <Badge tone="warning">شائع</Badge>
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: 'price',
                    header: 'السعر',
                    numeric: true,
                    render: (item) => <Money amount={item.price_iqd} />,
                  },
                  {
                    key: 'available',
                    header: 'التوفر',
                    render: (item) => (
                      <Badge tone={item.is_available ? 'success' : 'neutral'}>
                        {item.is_available ? 'متاح' : 'غير متاح'}
                      </Badge>
                    ),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const KIND_TONE: Record<MerchantType, 'neutral' | 'success' | 'rose'> = {
  RESTAURANT: 'neutral',
  MARKET: 'success',
  COSMETICS: 'rose',
};

/**
 * Who completes a failing check, and where. The owner of a market or a
 * cosmetics shop does their part from the app; a restaurant's from the web
 * portal; the rest is this page or another one of Admin's.
 */
function checkHint(key: string, isShop: boolean): string {
  const ownerFrom = isShop ? 'صاحب المتجر من التطبيق' : 'المطعم من لوحة التحكم';
  switch (key) {
    case 'hasActiveMenuItem':
      return `يضيفه ${ownerFrom}.`;
    case 'branchLocationValid':
      return isShop
        ? 'اختياري — يثبّته صاحب المتجر من التطبيق (إعدادات المتجر).'
        : 'يضبطه المطعم من لوحة التحكم عبر طلب تغيير الموقع.';
    case 'workingHoursConfigured':
      return isShop
        ? 'يضبطها صاحب المتجر من التطبيق، أو تُكتب تلقائياً عند التفعيل.'
        : `يضبطها ${ownerFrom}.`;
    case 'commissionConfigured':
    case 'settlementPolicyConfigured':
      return 'من بطاقة «العمولة» في هذه الصفحة.';
    case 'cityOrderingEnabled':
      return 'من صفحة الجغرافيا — فعّل الطلبات في المدينة.';
    case 'ownerActive':
      return 'حساب المالك موقوف أو محذوف — راجع بيانات الدخول أدناه.';
    case 'applicationApproved':
      return 'من صفحة طلبات الانضمام.';
    case 'hasActiveDriver':
      return isShop ? 'لا يلزم — يوصّل مندوبو جيبلي.' : 'اختياري — من لوحة التحكم.';
    default:
      return 'يتولاه فريق جيبلي.';
  }
}

/** Where the owner of each kind does their work — the consequence of the choice. */
const KIND_MANAGED: Record<MerchantType, string> = {
  RESTAURANT: 'يظهر في قسم «طعام». القائمة والطلبات تُدار من لوحة التحكم على المتصفّح.',
  MARKET: 'يظهر في قسم «ماركت». صاحبه يدير المنتجات والطلبات من تطبيق جيبلي أو من لوحة التحكم.',
  COSMETICS: 'يظهر في قسم «كوزمتك». صاحبه يدير المنتجات والطلبات من تطبيق جيبلي أو من لوحة التحكم.',
};

/**
 * Move the shop to another section.
 *
 * A reason is required because this is audited: the shop changes tab for
 * every customer, and its owner gains or loses the app.
 */
function KindDialog({
  token,
  restaurantId,
  name,
  current,
  onDone,
  onCancel,
}: {
  token: string;
  restaurantId: string;
  name: string;
  current: MerchantType;
  onDone: (noteAr: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<MerchantType>(current);
  const [reason, setReason] = useState('');

  const update = useMutation({
    mutationFn: () =>
      admin.updateMerchantType(token, restaurantId, { merchant_type: kind, reason }),
    onSuccess: (result) => onDone(result.note_ar),
  });

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="kind-title">
      <div className="dialog">
        <h2 id="kind-title">نوع «{name}»</h2>

        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          النوع يحدد القسم الذي يظهر فيه المتجر داخل التطبيق، وهل يستطيع صاحبه إدارته من تطبيق جيبلي
          (الماركت ومتاجر التجميل) أم من لوحة التحكم فقط (المطاعم).
        </p>

        <div className="field">
          <label htmlFor="kind-picker">النوع</label>
          <div
            id="kind-picker"
            role="radiogroup"
            aria-label="النوع"
            style={{ display: 'flex', flexDirection: 'row-reverse', gap: 'var(--space-2)' }}
          >
            {MERCHANT_TYPES.map((value) => {
              const active = kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKind(value)}
                  className={`btn btn--sm ${active ? 'btn--primary' : 'btn--ghost'}`}
                  style={{ flex: 1 }}
                >
                  {MERCHANT_TYPE_LABELS[value].nameAr}
                </button>
              );
            })}
          </div>
        </div>

        <div className="dialog__impact">
          <p style={{ margin: 0 }}>
            التصنيفات التي لا تنتمي إلى القسم الجديد تُزال من المتجر — أعد إضافتها بعد التغيير.
            الطلبات والكشوف السابقة لا تتأثر.
          </p>
        </div>

        <div className="field">
          <label htmlFor="kind-reason">سبب التغيير (مطلوب)</label>
          <textarea
            id="kind-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {update.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {update.error instanceof ApiError ? update.error.messageAr : 'تعذّر تغيير النوع'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={kind === current || reason.trim().length < 5 || update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? 'جاري الحفظ…' : 'حفظ النوع'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
