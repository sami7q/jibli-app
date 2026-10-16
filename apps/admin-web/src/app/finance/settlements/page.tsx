'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTLEMENT_STATUS_LABELS, dateAr, pluralAr } from '@jibli/ui-web';
import { SETTLEMENT_STATUSES, type SettlementStatus } from '@jibli/contracts';
import { AdminShell, ForbiddenShell } from '@/components/shell';
import { CommissionOverviewCards } from '@/components/commission-overview';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  FilterBar,
  MfaChallenge,
  Money,
  Select,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type AdminSettlement } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Commissions and statements (plan §41, §42, §44).
 *
 * Two questions on one screen, in the order they get asked. First: how much
 * have we earned, where, and how much of it is still sitting at restaurants —
 * read live from completed orders, because the money an operator chases is
 * exactly the part no statement covers yet. Then: the statements themselves.
 *
 * Generation is automatic and stops at DRAFT; issuing is a deliberate human
 * action, which is why it is a button here and not a background job. Finance
 * reviews before a restaurant is billed.
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

export default function SettlementsPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SettlementStatus | ''>('');
  const [issuing, setIssuing] = useState<AdminSettlement | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const settlements = useQuery({
    queryKey: ['admin-settlements', status],
    queryFn: () => admin.settlements(token, { status: status || undefined }),
    enabled: session.status === 'authenticated',
  });

  const summary = useQuery({
    queryKey: ['admin-finance-summary'],
    queryFn: () => admin.financeSummary(token, 30),
    enabled: session.status === 'authenticated',
  });

  const issue = useMutation({
    mutationFn: (id: string) => admin.issueSettlement(token, id),
    onSuccess: () => {
      setIssuing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-finance-summary'] });
    },
    onError: (error: unknown) => {
      // The server demands a fresh MFA challenge for sensitive finance actions
      // (plan §88); prompt rather than showing a bare 401.
      if (error instanceof ApiError && error.needsReauth) setNeedsMfa(true);
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }
  if (!session.can('finance.read.global')) {
    return <ForbiddenShell session={session} requiredAr="قراءة المالية" />;
  }

  const canIssue = session.can('finance.settlement.issue');
  const failedChecks = (summary.data?.reconciliation ?? []).filter((check) => !check.passed);

  return (
    <AdminShell
      title="العمولات والتسويات"
      subtitle="كشوف العمولة لكل مطعم، وحالة التحصيل"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <CommissionOverviewCards token={token} />

      {/*
        A finance dashboard whose underlying invariants are failing must say so
        rather than presenting its numbers as authoritative (plan §95).
      */}
      {failedChecks.length > 0 ? (
        <div className="alert-bar alert-bar--danger" role="alert">
          <Icon name="alert" className="nav__icon" aria-hidden />
          <span>
            فشلت{' '}
            {pluralAr(failedChecks.length, 'مطابقة مالية', 'مطابقتان ماليتان', 'مطابقات مالية')}. لا
            تعتمد أرقام التقارير قبل حل الاختلاف — راجع دليل حوادث المالية.
          </span>
        </div>
      ) : null}

      <div className="stats">
        <SummaryTile
          label="عمولة مستحقة (30 يوم)"
          hint="على الطلبات المكتملة — ليست مبالغ محصّلة"
          value={summary.data?.commission_accrued_iqd}
          loading={summary.isLoading}
          tone="orange"
        />
        <SummaryTile
          label="عمولة محصّلة (30 يوم)"
          hint="مدفوعات مسجّلة فعلياً"
          value={summary.data?.commission_collected_iqd}
          loading={summary.isLoading}
          tone="green"
        />
        <SummaryTile
          label="مبالغ غير مسددة"
          hint={`${summary.data?.outstanding_settlements ?? 0} كشف صادر`}
          value={summary.data?.outstanding_iqd}
          loading={summary.isLoading}
          tone="blue"
        />
        <SummaryTile
          label="مبالغ متأخرة"
          hint={`${summary.data?.overdue_settlements ?? 0} كشف متأخر`}
          value={summary.data?.overdue_iqd}
          loading={summary.isLoading}
          tone="amber"
        />
      </div>

      <Card>
        <FilterBar>
          <Select
            value={status}
            onChange={setStatus}
            label="حالة التسوية"
            allLabel="كل الحالات"
            options={SETTLEMENT_STATUSES.map((value) => ({
              value,
              label: SETTLEMENT_STATUS_LABELS[value],
            }))}
          />
        </FilterBar>

        {settlements.isError ? (
          <ErrorState
            message={
              settlements.error instanceof ApiError
                ? settlements.error.messageAr
                : 'تعذّر تحميل التسويات'
            }
            onRetry={() => void settlements.refetch()}
          />
        ) : settlements.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AdminSettlement>
            caption="كشوف العمولة"
            rows={settlements.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage="لا توجد تسويات بعد"
            columns={[
              {
                key: 'restaurant',
                header: 'المطعم',
                render: (row) => (
                  <Link
                    href={`/finance/settlements/${row.id}`}
                    style={{ fontWeight: 700, color: 'inherit' }}
                  >
                    {row.restaurant_name}
                    <span
                      className="ltr-inline"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--text-xs)',
                        marginInlineStart: 6,
                      }}
                    >
                      #{row.partner_code}
                    </span>
                  </Link>
                ),
              },
              {
                key: 'period',
                header: 'الفترة',
                render: (row) => (
                  <span style={{ fontSize: 'var(--text-xs)' }}>
                    {dateAr(row.period_start)} — {dateAr(row.period_end)}
                  </span>
                ),
              },
              { key: 'orders', header: 'الطلبات', numeric: true, render: (row) => row.order_count },
              {
                key: 'commission',
                header: 'العمولة',
                numeric: true,
                render: (row) => <Money amount={row.commission_total_iqd} />,
              },
              {
                key: 'due',
                header: 'المستحق',
                numeric: true,
                render: (row) => <Money amount={row.amount_due_iqd} />,
              },
              {
                key: 'remaining',
                header: 'المتبقي',
                numeric: true,
                render: (row) => <Money amount={row.remaining_iqd} />,
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) => (
                  <Badge tone={STATUS_TONE[row.status as SettlementStatus]}>
                    {SETTLEMENT_STATUS_LABELS[row.status as SettlementStatus]}
                    {row.days_overdue > 0 ? ` (${row.days_overdue} يوم)` : ''}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) =>
                  row.status === 'DRAFT' && canIssue ? (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => setIssuing(row)}
                    >
                      إصدار
                    </button>
                  ) : (
                    <Link
                      className="btn btn--outline btn--sm"
                      href={`/finance/settlements/${row.id}`}
                    >
                      التفاصيل
                    </Link>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {issuing ? (
        <ConfirmDialog
          title={`إصدار كشف ${issuing.restaurant_name}`}
          confirmLabel="إصدار الكشف"
          tone="primary"
          isSubmitting={issue.isPending}
          error={issue.error instanceof ApiError ? issue.error.messageAr : null}
          body={
            <div className="dialog__impact">
              <strong>بعد الإصدار يصبح الكشف مستحقاً على المطعم</strong>
              <dl>
                <dt>عدد الطلبات</dt>
                <dd className="numeric">{issuing.order_count}</dd>
                <dt>إجمالي المبيعات</dt>
                <dd className="numeric">
                  <Money amount={issuing.gross_sales_iqd} />
                </dd>
                <dt>العمولة</dt>
                <dd className="numeric">
                  <Money amount={issuing.commission_total_iqd} />
                </dd>
                <dt>التعديلات</dt>
                <dd className="numeric">
                  <Money amount={issuing.adjustments_total_iqd} />
                </dd>
                <dt>المبلغ المستحق</dt>
                <dd className="numeric">
                  <Money amount={issuing.amount_due_iqd} />
                </dd>
              </dl>
              <p style={{ margin: 0 }}>
                يتم إشعار المطعم فور الإصدار. التصحيح بعد ذلك يكون بقيود مقابلة وليس بالتعديل.
              </p>
            </div>
          }
          onConfirm={() => issue.mutate(issuing.id)}
          onCancel={() => setIssuing(null)}
        />
      ) : null}

      {needsMfa ? (
        <MfaChallenge
          onVerified={() => {
            setNeedsMfa(false);
            // Deliberately not auto-retried: the operator confirms again so a
            // sensitive action is never executed by a stale click.
          }}
          onCancel={() => setNeedsMfa(false)}
        />
      ) : null}
    </AdminShell>
  );
}

function SummaryTile({
  label,
  hint,
  value,
  loading,
  tone,
}: {
  label: string;
  hint: string;
  value: number | undefined;
  loading: boolean;
  tone: 'orange' | 'green' | 'blue' | 'amber';
}) {
  return (
    <div className="stat">
      <div className={`stat__icon stat__icon--${tone}`} aria-hidden>
        <Icon name="commissions" className="nav__icon" />
      </div>
      <div className="stat__body">
        {loading ? (
          <span className="skeleton" style={{ height: 24, width: 100 }} aria-hidden />
        ) : (
          <span className="stat__value numeric">
            <Money amount={value ?? 0} />
          </span>
        )}
        <span className="stat__label">{label}</span>
        {/* Each tile states exactly which number it is (plan §130). */}
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{hint}</span>
      </div>
    </div>
  );
}
