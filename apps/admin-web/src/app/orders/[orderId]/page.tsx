'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, dateTimeAr, relativeAr } from '@jibli/ui-web';
import type { ActorType, OrderStatus } from '@jibli/contracts';
import { AdminShell, ForbiddenShell } from '@/components/shell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Money,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type AdminOrderDetail } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Order detail, timeline and admin cancel (ADMIN-2).
 *
 * Every order link in «جميع الطلبات / الحية / الملغاة» pointed here and opened
 * a 404 — there was no screen anywhere that showed an order's items or timeline
 * or let an operator resolve a stuck one, though the API and the client binding
 * both existed. This is that screen: the full breakdown a support call needs,
 * and a reason-required «إلغاء الطلب» for the orders only an admin may cancel
 * (e.g. one already OUT_FOR_DELIVERY), gated on `order.override`.
 */

/** Terminal states an operator can no longer act on. */
const TERMINAL: OrderStatus[] = ['COMPLETED', 'DELIVERED', 'CANCELLED', 'REJECTED'];

const ACTOR_LABELS: Record<ActorType, string> = {
  CUSTOMER: 'العميل',
  RESTAURANT: 'المطعم',
  DRIVER: 'المندوب',
  ADMIN: 'الإدارة',
  SYSTEM: 'النظام',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'بانتظار الدفع',
  PAID: 'مدفوع',
  REFUNDED: 'مُسترد',
  FAILED: 'فشل الدفع',
};

function toneClass(status: OrderStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (ORDER_STATUS_TONE[status]) {
    case 'done':
    case 'ready':
      return 'success';
    case 'new':
    case 'progress':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const order = useQuery({
    queryKey: ['admin-order', orderId],
    queryFn: () => admin.order(token, orderId),
    enabled: session.status === 'authenticated',
    // The live board auto-refreshes; a detail opened from a complaint should at
    // least not go stale while it is read.
    refetchInterval: 20_000,
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => admin.cancelOrder(token, orderId, reason),
    onSuccess: () => {
      setCancelling(false);
      void queryClient.invalidateQueries({ queryKey: ['admin-order', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }
  if (!session.can('order.read.global')) {
    return <ForbiddenShell session={session} requiredAr="قراءة الطلبات" />;
  }

  const data = order.data;
  const status = (data?.status ?? '') as OrderStatus;
  const canCancel =
    data !== undefined && session.can('order.override') && !TERMINAL.includes(status);

  return (
    <AdminShell
      title={data ? `طلب #${data.public_order_number}` : 'تفاصيل الطلب'}
      subtitle={data ? `${data.restaurant_name} · ${data.city_name_ar}` : undefined}
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        canCancel ? (
          <button type="button" className="btn btn--danger" onClick={() => setCancelling(true)}>
            إلغاء الطلب
          </button>
        ) : null
      }
    >
      {order.isError ? (
        <ErrorState
          message={order.error instanceof ApiError ? order.error.messageAr : 'تعذّر تحميل الطلب'}
          code={order.error instanceof ApiError ? order.error.code : undefined}
          onRetry={() => void order.refetch()}
        />
      ) : order.isLoading || !data ? (
        <Skeleton height={520} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Card title="ملخّص الطلب" icon="orders">
            <div className="detail-grid">
              <DetailRow label="الحالة">
                <span className={`badge badge--${toneClass(status)}`}>
                  {ORDER_STATUS_LABELS[status] ?? status}
                </span>
              </DetailRow>
              <DetailRow label="حالة الدفع">
                {PAYMENT_STATUS_LABELS[data.payment_status] ?? data.payment_status}
              </DetailRow>
              <DetailRow label="المطعم">
                <Link href={`/restaurants/${data.restaurant_id}`} style={{ color: 'inherit' }}>
                  {data.restaurant_name}
                </Link>
              </DetailRow>
              <DetailRow label="العميل">
                {data.customer_name}
                {' · '}
                <span className="ltr-inline">{data.customer_phone}</span>
              </DetailRow>
              <DetailRow label="المندوب">{data.driver_name ?? '—'}</DetailRow>
              <DetailRow label="وقت الطلب">{dateTimeAr(data.placed_at)}</DetailRow>
              {data.completed_at ? (
                <DetailRow label="وقت الاكتمال">{dateTimeAr(data.completed_at)}</DetailRow>
              ) : null}
            </div>

            {data.customer_notes ? (
              <p
                style={{
                  marginTop: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  background: 'var(--surface-sunken, #f2f4f7)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <strong>ملاحظة العميل:</strong> {data.customer_notes}
              </p>
            ) : null}

            {data.cancellation_reason ? (
              <p className="alert-bar alert-bar--danger" style={{ marginTop: 'var(--space-3)' }}>
                <Icon name="alert" className="nav__icon" aria-hidden />
                <span>سبب الإلغاء: {data.cancellation_reason}</span>
              </p>
            ) : null}
          </Card>

          <Card title="الأصناف" icon="orders">
            <DataTable<AdminOrderDetail['items'][number]>
              caption="أصناف الطلب"
              rows={data.items}
              keyOf={(row) => `${row.name_ar}-${row.unit_price_iqd}-${row.quantity}`}
              emptyMessage="لا توجد أصناف"
              columns={[
                {
                  key: 'name',
                  header: 'الصنف',
                  render: (row) => (
                    <span>
                      {row.name_ar}
                      {row.notes ? (
                        <>
                          <br />
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                            {row.notes}
                          </span>
                        </>
                      ) : null}
                    </span>
                  ),
                },
                { key: 'qty', header: 'الكمية', numeric: true, render: (row) => row.quantity },
                {
                  key: 'unit',
                  header: 'سعر الوحدة',
                  numeric: true,
                  render: (row) => <Money amount={row.unit_price_iqd} />,
                },
                {
                  key: 'line',
                  header: 'الإجمالي',
                  numeric: true,
                  render: (row) => <Money amount={row.line_total_iqd} />,
                },
              ]}
            />

            <div className="detail-grid" style={{ marginTop: 'var(--space-4)' }}>
              <DetailRow label="مجموع الأصناف">
                <Money amount={data.items_subtotal_iqd} />
              </DetailRow>
              <DetailRow label="رسوم التوصيل">
                <Money amount={data.delivery_fee_iqd} />
              </DetailRow>
              <DetailRow label="رسوم الخدمة">
                <Money amount={data.platform_service_fee_iqd} />
              </DetailRow>
              {data.discount_total_iqd > 0 ? (
                <DetailRow label="الخصم">
                  −<Money amount={data.discount_total_iqd} />
                </DetailRow>
              ) : null}
              <DetailRow label="إجمالي العميل">
                <strong>
                  <Money amount={data.customer_total_iqd} />
                </strong>
              </DetailRow>
              <DetailRow label="العمولة">
                <Money amount={data.commission_amount_iqd} />
              </DetailRow>
              <DetailRow label="صافي المطعم">
                <Money amount={data.restaurant_net_iqd} />
              </DetailRow>
            </div>
          </Card>

          <Card title="مسار الطلب" icon="clock">
            {data.timeline.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>لا يوجد سجل بعد.</p>
            ) : (
              <ol className="timeline">
                {data.timeline.map((entry, index) => (
                  <li key={`${entry.to_status}-${entry.at}-${index}`} className="timeline__item">
                    <span className={`badge badge--${toneClass(entry.to_status as OrderStatus)}`}>
                      {ORDER_STATUS_LABELS[entry.to_status as OrderStatus] ?? entry.to_status}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {ACTOR_LABELS[entry.actor_type as ActorType] ?? entry.actor_type}
                      {entry.actor_name ? ` · ${entry.actor_name}` : ''}
                    </span>
                    {entry.reason ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                        {entry.reason}
                      </span>
                    ) : null}
                    <time
                      style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}
                      dateTime={entry.at}
                    >
                      {relativeAr(entry.at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {data.assignments.length > 0 ? (
            <Card title="التوصيل" icon="drivers">
              <DataTable<AdminOrderDetail['assignments'][number]>
                caption="محاولات التوصيل"
                rows={data.assignments}
                keyOf={(row) => row.id}
                emptyMessage="لا توجد محاولات"
                columns={[
                  { key: 'driver', header: 'المندوب', render: (row) => row.driver_name ?? '—' },
                  {
                    key: 'status',
                    header: 'الحالة',
                    render: (row) => <Badge tone="neutral">{row.status}</Badge>,
                  },
                  {
                    key: 'assigned',
                    header: 'أُسند',
                    render: (row) => relativeAr(row.assigned_at),
                  },
                  {
                    key: 'delivered',
                    header: 'سُلّم',
                    render: (row) => (row.delivered_at ? relativeAr(row.delivered_at) : '—'),
                  },
                  {
                    key: 'reject',
                    header: 'سبب الرفض',
                    render: (row) => row.rejection_reason ?? '—',
                  },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}

      {cancelling && data ? (
        <ConfirmDialog
          title={`إلغاء الطلب #${data.public_order_number}`}
          confirmLabel="إلغاء الطلب"
          requireReason
          isSubmitting={cancel.isPending}
          error={cancel.error instanceof ApiError ? cancel.error.messageAr : null}
          body={
            <div className="dialog__impact">
              <p style={{ margin: 0 }}>
                تدخّل إداري: يُلغى الطلب فوراً ويُشعَر العميل والمطعم. لا يمكن التراجع، ويُسجَّل
                السبب في سجل الأنشطة.
              </p>
            </div>
          }
          onConfirm={(reason) => cancel.mutate(reason)}
          onCancel={() => setCancelling(false)}
        />
      ) : null}
    </AdminShell>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-row__label">{label}</span>
      <span className="detail-row__value">{children}</span>
    </div>
  );
}
