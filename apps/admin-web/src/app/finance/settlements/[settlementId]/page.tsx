'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_RECORD_METHODS } from '@jibli/contracts';
import { SETTLEMENT_STATUS_LABELS, bpsPercent, dateAr, dateTimeAr } from '@jibli/ui-web';
import type { SettlementStatus } from '@jibli/contracts';
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
import { admin } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Settlement detail (plan §42, §44).
 *
 * This is the screen a restaurant disputes against, so it shows the working:
 * every order line with the commission rate that applied at the time, not a
 * single total the restaurant has to take on trust.
 *
 * Corrections are compensating entries — payments and adjustments add rows,
 * they never edit what is already there (plan §4.4).
 */

const STATUS_TONE: Record<SettlementStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  DRAFT: 'neutral',
  ISSUED: 'warning',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  DISPUTED: 'danger',
  VOID: 'neutral',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'نقداً',
  BANK_TRANSFER: 'حوالة بنكية',
  CHEQUE: 'صك',
  OTHER: 'أخرى',
};

export default function SettlementDetailPage() {
  const params = useParams<{ settlementId: string }>();
  const settlementId = params.settlementId;
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const [recordingPayment, setRecordingPayment] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const settlement = useQuery({
    queryKey: ['admin-settlement', settlementId],
    queryFn: () => admin.settlement(token, settlementId),
    enabled: session.status === 'authenticated',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-settlement', settlementId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
  };

  const issue = useMutation({
    mutationFn: () => admin.issueSettlement(token, settlementId),
    onSuccess: invalidate,
  });

  const voidSettlement = useMutation({
    mutationFn: (reason: string) => admin.voidSettlement(token, settlementId, reason),
    onSuccess: () => {
      setVoiding(false);
      invalidate();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) {
        setVoiding(false);
        setNeedsMfa(true);
      }
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const data = settlement.data;
  const isOpen = data ? !['PAID', 'VOID'].includes(data.status) : false;

  return (
    <AdminShell
      title={data ? `كشف ${data.restaurant_name}` : 'كشف العمولة'}
      subtitle={
        data ? `${dateAr(data.period_start)} — ${dateAr(data.period_end)} · #${data.partner_code}` : undefined
      }
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        data ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {data.status === 'DRAFT' ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={issue.isPending}
                onClick={() => issue.mutate()}
              >
                {issue.isPending ? 'جاري الإصدار…' : 'إصدار الكشف'}
              </button>
            ) : null}
            {isOpen && data.status !== 'DRAFT' ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setRecordingPayment(true)}
              >
                تسجيل دفعة
              </button>
            ) : null}
            {isOpen ? (
              <button type="button" className="btn btn--outline" onClick={() => setAdjusting(true)}>
                تعديل مالي
              </button>
            ) : null}
            {data.status !== 'VOID' ? (
              <button type="button" className="btn btn--danger" onClick={() => setVoiding(true)}>
                إلغاء الكشف
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {settlement.isError ? (
        <ErrorState
          message={
            settlement.error instanceof ApiError ? settlement.error.messageAr : 'تعذّر تحميل الكشف'
          }
          onRetry={() => void settlement.refetch()}
        />
      ) : settlement.isLoading ? (
        <Skeleton height={400} />
      ) : data ? (
        <>
          {/*
            A statement whose parts stopped adding up must say so rather than
            presenting itself as authoritative (plan §95).
          */}
          {!data.reconciles ? (
            <div className="alert-bar alert-bar--danger" role="alert">
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span>
                هذا الكشف لا يتطابق حسابياً: {data.reconciliation_detail}. لا تصدره أو تحصّله قبل
                المراجعة.
              </span>
            </div>
          ) : null}

          {data.status === 'VOID' ? (
            <div className="alert-bar alert-bar--warning">
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span>
                هذا الكشف ملغى. السبب: {data.void_reason}. تم عكس العمولة بقيد مقابل، والطلبات
                المرتبطة أصبحت متاحة لتسوية جديدة.
              </span>
            </div>
          ) : null}

          {data.dispute_reason ? (
            <div className="alert-bar alert-bar--warning">
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span>اعتراض من المطعم: {data.dispute_reason}</span>
            </div>
          ) : null}

          <Card title="ملخص الكشف" icon="commissions">
            <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
              <Figure label="الحالة">
                <Badge tone={STATUS_TONE[data.status as SettlementStatus]}>
                  {SETTLEMENT_STATUS_LABELS[data.status as SettlementStatus]}
                </Badge>
              </Figure>
              <Figure label="عدد الطلبات">
                <strong className="numeric">{data.order_count}</strong>
              </Figure>
              <Figure label="إجمالي المبيعات">
                <Money amount={data.gross_sales_iqd} />
              </Figure>
              <Figure label="أساس العمولة">
                <Money amount={data.commission_base_total_iqd} />
              </Figure>
              <Figure label="إجمالي العمولة">
                <strong>
                  <Money amount={data.commission_total_iqd} />
                </strong>
              </Figure>
              <Figure label="التعديلات">
                <Money amount={data.adjustments_total_iqd} />
              </Figure>
              <Figure label="المبلغ المستحق">
                <strong style={{ fontSize: 'var(--text-lg)' }}>
                  <Money amount={data.amount_due_iqd} />
                </strong>
              </Figure>
              <Figure label="المدفوع">
                <Money amount={data.amount_paid_iqd} />
              </Figure>
              <Figure label="المتبقي">
                <strong
                  style={{
                    color: data.remaining_iqd > 0 ? 'var(--jibli-warning-700)' : 'var(--jibli-success-700)',
                  }}
                >
                  <Money amount={data.remaining_iqd} />
                </strong>
              </Figure>
              {data.due_date ? (
                <Figure label="تاريخ الاستحقاق">
                  {dateAr(data.due_date)}
                  {data.days_overdue > 0 ? (
                    <Badge tone="danger">متأخر {data.days_overdue} يوم</Badge>
                  ) : null}
                </Figure>
              ) : null}
            </div>
          </Card>

          <Card
            title="الطلبات المشمولة"
            icon="orders"
            subtitle="كل طلب بنسبة العمولة التي كانت سارية لحظة إنشائه"
          >
            <DataTable
              caption="بنود الكشف"
              rows={data.lines}
              keyOf={(row) => row.order_id}
              emptyMessage="لا توجد طلبات في هذا الكشف"
              columns={[
                {
                  key: 'order',
                  header: 'رقم الطلب',
                  render: (row) => <span className="ltr-inline">#{row.public_order_number}</span>,
                },
                {
                  key: 'base',
                  header: 'أساس العمولة',
                  numeric: true,
                  render: (row) => <Money amount={row.commission_base_iqd} />,
                },
                {
                  key: 'rate',
                  header: 'النسبة',
                  numeric: true,
                  render: (row) => bpsPercent(row.rate_bps),
                },
                {
                  key: 'commission',
                  header: 'العمولة',
                  numeric: true,
                  render: (row) => <Money amount={row.commission_amount_iqd} />,
                },
                {
                  key: 'completed',
                  header: 'تاريخ الإكمال',
                  render: (row) => dateTimeAr(row.completed_at),
                },
              ]}
            />
          </Card>

          <Card title="الدفعات" icon="cash">
            <DataTable
              caption="الدفعات المسجّلة"
              rows={data.payments}
              keyOf={(row) => row.id}
              emptyMessage="لم تُسجَّل دفعات بعد"
              columns={[
                {
                  key: 'amount',
                  header: 'المبلغ',
                  numeric: true,
                  render: (row) => (
                    <span style={{ color: row.is_reversal ? 'var(--jibli-danger-700)' : undefined }}>
                      <Money amount={row.amount_iqd} />
                      {row.is_reversal ? ' (عكس قيد)' : ''}
                    </span>
                  ),
                },
                {
                  key: 'method',
                  header: 'الطريقة',
                  render: (row) => METHOD_LABELS[row.method] ?? row.method,
                },
                {
                  key: 'reference',
                  header: 'المرجع',
                  render: (row) => row.reference ?? '—',
                },
                { key: 'paid', header: 'التاريخ', render: (row) => dateTimeAr(row.paid_at) },
                { key: 'by', header: 'سجّلها', render: (row) => row.recorded_by ?? '—' },
                { key: 'note', header: 'ملاحظة', render: (row) => row.note ?? '—' },
              ]}
            />
          </Card>

          {data.adjustments.length > 0 ? (
            <Card title="التعديلات المالية" icon="reports">
              <DataTable
                caption="التعديلات"
                rows={data.adjustments}
                keyOf={(row) => row.id}
                emptyMessage="لا توجد تعديلات"
                columns={[
                  {
                    key: 'amount',
                    header: 'المبلغ',
                    numeric: true,
                    render: (row) => (
                      <span
                        style={{
                          color:
                            row.amount_iqd < 0
                              ? 'var(--jibli-success-700)'
                              : 'var(--jibli-danger-700)',
                        }}
                      >
                        <Money amount={row.amount_iqd} />
                        {row.amount_iqd < 0 ? ' (خصم)' : ' (إضافة)'}
                      </span>
                    ),
                  },
                  { key: 'reason', header: 'السبب', render: (row) => row.reason },
                  { key: 'by', header: 'اعتمدها', render: (row) => row.approved_by ?? '—' },
                  { key: 'at', header: 'التاريخ', render: (row) => dateTimeAr(row.created_at) },
                ]}
              />
            </Card>
          ) : null}
        </>
      ) : null}

      {recordingPayment && data ? (
        <PaymentDialog
          token={token}
          settlementId={settlementId}
          remaining={data.remaining_iqd}
          onDone={() => {
            setRecordingPayment(false);
            invalidate();
          }}
          onCancel={() => setRecordingPayment(false)}
        />
      ) : null}

      {adjusting && data ? (
        <AdjustmentDialog
          token={token}
          settlementId={settlementId}
          onDone={() => {
            setAdjusting(false);
            invalidate();
          }}
          onNeedsMfa={() => {
            setAdjusting(false);
            setNeedsMfa(true);
          }}
          onCancel={() => setAdjusting(false)}
        />
      ) : null}

      {voiding ? (
        <ConfirmDialog
          title="إلغاء الكشف"
          confirmLabel="إلغاء الكشف"
          requireReason
          isSubmitting={voidSettlement.isPending}
          error={voidSettlement.error instanceof ApiError ? voidSettlement.error.messageAr : null}
          body={
            <div className="dialog__impact">
              <strong>
                <Icon name="alert" className="nav__icon" aria-hidden /> ماذا يحدث
              </strong>
              <p style={{ margin: 0 }}>
                يُعكس قيد العمولة بقيد مقابل ولا يُحذف — يبقى الأصل في السجل كدليل. تُحرَّر الطلبات
                المرتبطة لتدخل في تسوية جديدة.
              </p>
              <p style={{ margin: 0 }}>
                يتطلب هذا الإجراء تحققاً بخطوتين ويُسجَّل في سجل الأنشطة باسمك.
              </p>
            </div>
          }
          onConfirm={(reason) => voidSettlement.mutate(reason)}
          onCancel={() => setVoiding(false)}
        />
      ) : null}

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ marginTop: 2 }}>{children}</div>
    </div>
  );
}

function PaymentDialog({
  token,
  settlementId,
  remaining,
  onDone,
  onCancel,
}: {
  token: string;
  settlementId: string;
  remaining: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState<string>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const record = useMutation({
    mutationFn: () =>
      admin.recordPayment(token, settlementId, {
        amount_iqd: amount,
        method,
        reference: reference || undefined,
        note: note || undefined,
      }),
    onSuccess: onDone,
  });

  // The server refuses over-collection; mirroring it here means the operator
  // sees the problem before submitting (plan §76).
  const exceedsRemaining = amount > remaining;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="dialog">
        <h2 id="payment-title">تسجيل دفعة</h2>

        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          المتبقي على المطعم: <strong><Money amount={remaining} /></strong>
        </p>

        <div className="field">
          <label htmlFor="payment-amount">المبلغ (د.ع)</label>
          <input
            id="payment-amount"
            type="number"
            min={1}
            max={remaining}
            step={1000}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
          {exceedsRemaining ? (
            <span className="field__error">المبلغ يتجاوز المتبقي على الكشف</span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="payment-method">طريقة الدفع</label>
          <select
            id="payment-method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            {PAYMENT_RECORD_METHODS.map((value) => (
              <option key={value} value={value}>
                {METHOD_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="payment-reference">رقم المرجع (اختياري)</label>
          <input
            id="payment-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="رقم الحوالة أو الصك"
          />
        </div>

        <div className="field">
          <label htmlFor="payment-note">ملاحظة (اختياري)</label>
          <textarea
            id="payment-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          الدفعات سجلّات ثابتة لا تُعدَّل. إذا حدث خطأ، يُسجَّل قيد عكسي بدل التعديل.
        </p>

        {record.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {record.error instanceof ApiError ? record.error.messageAr : 'تعذّر تسجيل الدفعة'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={amount < 1 || exceedsRemaining || record.isPending}
            onClick={() => record.mutate()}
          >
            {record.isPending ? 'جاري التسجيل…' : 'تسجيل الدفعة'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustmentDialog({
  token,
  settlementId,
  onDone,
  onNeedsMfa,
  onCancel,
}: {
  token: string;
  settlementId: string;
  onDone: () => void;
  onNeedsMfa: () => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');

  const create = useMutation({
    mutationFn: () =>
      admin.createAdjustment(token, settlementId, {
        // Credit reduces what the restaurant owes, so it goes in negative.
        amount_iqd: direction === 'credit' ? -Math.abs(amount) : Math.abs(amount),
        reason,
      }),
    onSuccess: onDone,
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) onNeedsMfa();
    },
  });

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="adjust-title">
      <div className="dialog">
        <h2 id="adjust-title">تعديل مالي</h2>

        <div className="field">
          <label htmlFor="adjust-direction">نوع التعديل</label>
          <select
            id="adjust-direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as 'credit' | 'debit')}
          >
            <option value="credit">خصم لصالح المطعم (يقلل المستحق)</option>
            <option value="debit">إضافة على المطعم (يزيد المستحق)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="adjust-amount">المبلغ (د.ع)</label>
          <input
            id="adjust-amount"
            type="number"
            min={1}
            step={1000}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="adjust-reason">السبب (مطلوب)</label>
          <textarea
            id="adjust-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثال: تعويض عن طلب أُلغي بعد التحضير بخطأ من المنصة"
          />
          <span className="field__hint">
            يظهر السبب للمطعم في كشفه ويُسجَّل في سجل الأنشطة.
          </span>
        </div>

        <div className="dialog__impact">
          <p style={{ margin: 0 }}>
            يتطلب هذا الإجراء تحققاً بخطوتين. يُضاف التعديل كقيد جديد ولا يُعدَّل أي رقم سابق.
          </p>
        </div>

        {create.error && !(create.error instanceof ApiError && create.error.needsReauth) ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر إنشاء التعديل'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={amount < 1 || reason.trim().length < 5 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الحفظ…' : 'إنشاء التعديل'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
