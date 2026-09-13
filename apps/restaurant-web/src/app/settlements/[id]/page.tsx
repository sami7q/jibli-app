'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettlementStatus } from '@jibli/contracts';
import { money, SETTLEMENT_STATUS_LABELS } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type PortalSettlementDetail } from '@/lib/portal-endpoints';

/**
 * One settlement statement in full (plan §41, §42, §44).
 *
 * The plan requires the statement to show its *working* — every order, its
 * commission base, the rate that applied at the time, and the resulting amount
 * — so the restaurant can verify the total rather than take it on trust. The
 * rate shown is the snapshot stored on the line, not today's contract rate.
 */
export default function SettlementDetailPage() {
  const params = useParams<{ id: string }>();
  const settlementId = params.id;

  return (
    <PortalPage permission="finance.settlement.read" permissionLabelAr="قراءة كشوف العمولة">
      {({ auth, can }) => (
        <SettlementDetail
          auth={auth}
          settlementId={settlementId}
          canDispute={can('finance.settlement.dispute')}
        />
      )}
    </PortalPage>
  );
}

function SettlementDetail({
  auth,
  settlementId,
  canDispute,
}: {
  auth: PortalAuth;
  settlementId: string;
  canDispute: boolean;
}) {
  const queryClient = useQueryClient();
  const [disputing, setDisputing] = useState(false);

  const settlement = useQuery({
    queryKey: ['settlement', settlementId],
    queryFn: () => portal.settlement(auth, settlementId),
  });

  const dispute = useMutation({
    mutationFn: (reason: string) => portal.disputeSettlement(auth, settlementId, reason),
    onSuccess: () => {
      setDisputing(false);
      void queryClient.invalidateQueries({ queryKey: ['settlement', settlementId] });
      void queryClient.invalidateQueries({ queryKey: ['settlements'] });
    },
  });

  if (settlement.isError) {
    return (
      <ErrorState
        message={
          settlement.error instanceof ApiError ? settlement.error.messageAr : 'تعذّر تحميل الكشف'
        }
        code={settlement.error instanceof ApiError ? settlement.error.code : undefined}
        onRetry={() => void settlement.refetch()}
      />
    );
  }

  if (settlement.isLoading || !settlement.data) return <Skeleton height={480} />;

  const data = settlement.data;
  // Only an issued, unpaid statement can be objected to; the server enforces
  // the same list and would reject anything else with SETTLEMENT_INVALID_STATE.
  const disputable = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(data.status);

  return (
    <>
      <Card
        title={`كشف عمولة ${formatDate(data.period_start)} — ${formatDate(data.period_end)}`}
        icon="settlements"
        subtitle={data.policy === 'MONTHLY' ? 'فترة شهرية' : 'فترة نصف شهرية'}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Link className="btn btn--ghost btn--sm" href="/settlements">
              رجوع للكشوف
            </Link>
            {canDispute && disputable ? (
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => setDisputing(true)}
              >
                تسجيل اعتراض
              </button>
            ) : null}
          </div>
        }
      >
        <StatusBanner data={data} />

        <div className="split" style={{ marginBlockStart: 'var(--space-4)' }}>
          <div className="figure">
            <span className="figure__label">عدد الطلبات</span>
            <span className="figure__value">{data.order_count}</span>
          </div>
          <div className="figure">
            <span className="figure__label">إجمالي المبيعات</span>
            <span className="figure__value">{money(data.gross_sales_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">مجموع العمولة</span>
            <span className="figure__value">{money(data.commission_total_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">تسويات</span>
            <span className="figure__value">{money(data.adjustments_total_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">المستحق</span>
            <span className="figure__value">{money(data.amount_due_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">المتبقي</span>
            <span
              className="figure__value"
              style={{
                color:
                  data.remaining_iqd > 0 ? 'var(--jibli-danger-700)' : 'var(--jibli-success-700)',
              }}
            >
              {money(data.remaining_iqd)}
            </span>
          </div>
        </div>
      </Card>

      <Card
        title="تفصيل الطلبات"
        subtitle="أساس العمولة لكل طلب وقيمة العمولة التي طُبّقت عليه وقت اكتماله"
      >
        {data.lines.length === 0 ? (
          <p className="empty">لا توجد أسطر في هذا الكشف</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">رقم الطلب</th>
                  <th scope="col">تاريخ الاكتمال</th>
                  <th scope="col" className="numeric">
                    أساس العمولة
                  </th>
                  <th scope="col" className="numeric">
                    العمولة
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.public_order_number}>
                    <td>
                      <span className="ltr-inline">{line.public_order_number}</span>
                    </td>
                    <td>
                      <span className="ltr-inline">{formatDateTime(line.completed_at)}</span>
                    </td>
                    <td className="numeric">{money(line.commission_base_iqd)}</td>
                    <td className="numeric">{money(line.commission_amount_iqd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={3}>مجموع العمولة</td>
                  <td className="numeric">{money(data.commission_total_iqd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/*
          Rates are snapshots, not lookups. A later change to the contract rate
          must not silently restate an issued bill (plan §24, §42).
        */}
        <p
          style={{
            marginBlockStart: 'var(--space-3)',
            marginBlockEnd: 0,
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          العمولة المعروضة لكل سطر هي القيمة المسجّلة وقت اكتمال الطلب، ولا تتغيّر إذا عُدّلت
          عمولة العقد لاحقاً. أجور التوصيل ليست جزءاً من أساس العمولة.
        </p>
      </Card>

      <Card title="الدفعات" subtitle="ما سُجّل من سداد على هذا الكشف">
        {data.payments.length === 0 ? (
          <p className="empty">لم تُسجَّل أي دفعة بعد</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المبلغ</th>
                  <th scope="col">الطريقة</th>
                  <th scope="col">المرجع</th>
                  <th scope="col">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((payment, index) => (
                  <tr key={`${payment.paid_at}-${index}`}>
                    <td className="numeric">{money(payment.amount_iqd)}</td>
                    <td>{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}</td>
                    <td>
                      {payment.reference ? (
                        <span className="ltr-inline">{payment.reference}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className="ltr-inline">{formatDateTime(payment.paid_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {disputing ? (
        <ConfirmDialog
          title="تسجيل اعتراض على الكشف"
          confirmLabel="إرسال الاعتراض"
          requireReason
          isSubmitting={dispute.isPending}
          error={dispute.error instanceof ApiError ? dispute.error.messageAr : null}
          body={
            <div style={{ color: 'var(--text-secondary)' }}>
              <p style={{ marginBlockStart: 0 }}>
                اكتب سبب الاعتراض بوضوح — أي طلب تحديداً، وما الفرق الذي تراه. يصل الاعتراض إلى
                الإدارة المالية مع تفاصيل الكشف.
              </p>
              <p style={{ marginBlockEnd: 0 }}>
                يتوقف احتساب التأخير على هذا الكشف حتى تُراجَع الحالة ويُرد عليك.
              </p>
            </div>
          }
          onConfirm={(reason) => dispute.mutate(reason)}
          onCancel={() => setDisputing(false)}
        />
      ) : null}
    </>
  );
}

function StatusBanner({ data }: { data: PortalSettlementDetail }) {
  if (data.status === 'DISPUTED') {
    return (
      <p className="alert-bar alert-bar--warning" role="status">
        <span style={{ flex: 1 }}>
          هذا الكشف قيد الاعتراض — الإدارة المالية تراجعه ولا يُحتسب تأخير عليه حالياً.
          {data.dispute_reason ? ` السبب المسجّل: ${data.dispute_reason}` : ''}
        </span>
      </p>
    );
  }

  if (data.status === 'PAID') {
    return (
      <p className="alert-bar alert-bar--success" role="status">
        <span style={{ flex: 1 }}>هذا الكشف مسدّد بالكامل.</span>
      </p>
    );
  }

  if (data.days_overdue > 0 && data.remaining_iqd > 0) {
    return (
      <p className="alert-bar alert-bar--danger" role="status">
        <span style={{ flex: 1 }}>
          متأخر {data.days_overdue} يوماً عن تاريخ الاستحقاق
          {data.due_date ? ` (${formatDate(data.due_date)})` : ''}. المتبقي{' '}
          {money(data.remaining_iqd)}.
        </span>
      </p>
    );
  }

  return (
    <p className="alert-bar alert-bar--warning" role="status">
      <span style={{ flex: 1 }}>
        الحالة: {SETTLEMENT_STATUS_LABELS[data.status as SettlementStatus] ?? data.status}
        {data.due_date ? ` — تاريخ الاستحقاق ${formatDate(data.due_date)}` : ''}
      </span>
    </p>
  );
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'نقداً',
  BANK_TRANSFER: 'حوالة بنكية',
  OFFSET: 'مقاصّة',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
}
