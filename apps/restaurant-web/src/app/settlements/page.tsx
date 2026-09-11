'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { SETTLEMENT_STATUSES, type SettlementStatus } from '@jibli/contracts';
import { money, SETTLEMENT_STATUS_LABELS } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type PortalSettlement } from '@/lib/portal-endpoints';

/**
 * Settlement statements, restaurant view (plan §40–§44).
 *
 * A DRAFT statement never reaches this screen — the API filters it out, because
 * a working copy Finance has not issued is not yet a bill the restaurant owes.
 *
 * Every figure here is the statement's own snapshot. The plan is explicit that
 * a commission rate change must never rewrite an issued statement, so nothing
 * on this page recomputes anything from today's rate.
 */

/** Statuses a restaurant can actually be shown; DRAFT is Finance-only. */
const VISIBLE_STATUSES = SETTLEMENT_STATUSES.filter((status) => status !== 'DRAFT');

function statusTone(settlement: PortalSettlement): 'success' | 'warning' | 'danger' | 'neutral' {
  if (settlement.status === 'PAID') return 'success';
  if (settlement.status === 'DISPUTED') return 'warning';
  if (settlement.status === 'OVERDUE' || settlement.days_overdue > 0) return 'danger';
  if (settlement.status === 'VOID') return 'neutral';
  return 'warning';
}

export default function SettlementsPage() {
  return (
    <PortalPage permission="finance.settlement.read" permissionLabelAr="قراءة كشوف العمولة">
      {({ auth }) => <SettlementsScreen auth={auth} />}
    </PortalPage>
  );
}

function SettlementsScreen({ auth }: { auth: PortalAuth }) {
  const [status, setStatus] = useState<SettlementStatus | ''>('');

  const settlements = useQuery({
    queryKey: ['settlements', auth.restaurantId, status],
    queryFn: () => portal.settlements(auth, status ? { status } : {}),
  });

  if (settlements.isError) {
    return (
      <ErrorState
        message={
          settlements.error instanceof ApiError
            ? settlements.error.messageAr
            : 'تعذّر تحميل كشوف العمولة'
        }
        code={settlements.error instanceof ApiError ? settlements.error.code : undefined}
        onRetry={() => void settlements.refetch()}
      />
    );
  }

  if (settlements.isLoading) return <Skeleton height={400} />;

  const rows = settlements.data ?? [];
  const outstanding = rows
    .filter((row) => row.status !== 'PAID' && row.status !== 'VOID')
    .reduce((sum, row) => sum + row.remaining_iqd, 0);
  const overdue = rows.filter((row) => row.days_overdue > 0 && row.remaining_iqd > 0);

  return (
    <>
      <Card
        title="كشوف العمولة"
        icon="settlements"
        subtitle="ما يستحق لجيبلي عن الطلبات المكتملة، مقسّماً على فترات"
        actions={
          <div className="topbar__control">
            <label htmlFor="settlement-status" className="sr-only">
              تصفية حسب حالة الكشف
            </label>
            <select
              id="settlement-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as SettlementStatus | '')}
              style={{
                border: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 'var(--text-sm)',
                outline: 'none',
              }}
            >
              <option value="">كل الحالات</option>
              {VISIBLE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {SETTLEMENT_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="split">
          <div className="figure">
            <span className="figure__label">المتبقي غير المسدّد</span>
            <span
              className="figure__value"
              style={{ color: outstanding > 0 ? 'var(--jibli-danger-700)' : undefined }}
            >
              {money(outstanding)}
            </span>
          </div>
          <div className="figure">
            <span className="figure__label">كشوف متأخرة</span>
            <span className="figure__value">{overdue.length}</span>
          </div>
          <div className="figure">
            <span className="figure__label">عدد الكشوف المعروضة</span>
            <span className="figure__value">{rows.length}</span>
          </div>
        </div>

        {overdue.length > 0 ? (
          <p className="alert-bar alert-bar--danger" style={{ marginBlockStart: 'var(--space-4)' }}>
            <span style={{ flex: 1 }}>
              لديك {overdue.length === 1 ? 'كشف متأخر' : `${overdue.length} كشوف متأخرة`}. استمرار
              التأخير قد يؤدي إلى إيقاف استقبال الطلبات مؤقتاً.
            </span>
          </p>
        ) : null}
      </Card>

      <Card title="الكشوف">
        {rows.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لا توجد كشوف</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              يصدر الكشف في نهاية كل فترة تسوية ويظهر هنا فور إصداره.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">الفترة</th>
                  <th scope="col">الحالة</th>
                  <th scope="col" className="numeric">
                    الطلبات
                  </th>
                  <th scope="col" className="numeric">
                    المبيعات
                  </th>
                  <th scope="col" className="numeric">
                    العمولة المستحقة
                  </th>
                  <th scope="col" className="numeric">
                    المتبقي
                  </th>
                  <th scope="col">الاستحقاق</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="ltr-inline">
                        {formatDate(row.period_start)} — {formatDate(row.period_end)}
                      </span>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        {row.policy === 'MONTHLY' ? 'شهري' : 'نصف شهري'}
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge--${statusTone(row)}`}>
                        {SETTLEMENT_STATUS_LABELS[row.status as SettlementStatus] ?? row.status}
                      </span>
                    </td>
                    <td className="numeric">{row.order_count}</td>
                    <td className="numeric">{money(row.gross_sales_iqd)}</td>
                    <td className="numeric">{money(row.amount_due_iqd)}</td>
                    <td className="numeric">
                      <strong
                        style={{
                          color:
                            row.remaining_iqd > 0 ? 'var(--jibli-danger-700)' : 'var(--jibli-success-700)',
                        }}
                      >
                        {money(row.remaining_iqd)}
                      </strong>
                    </td>
                    <td>
                      {row.due_date ? (
                        <>
                          <span className="ltr-inline">{formatDate(row.due_date)}</span>
                          {row.days_overdue > 0 && row.remaining_iqd > 0 ? (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--jibli-danger-700)' }}>
                              متأخر {row.days_overdue} يوماً
                            </div>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Link className="btn btn--ghost btn--sm" href={`/settlements/${row.id}`}>
                        التفاصيل
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Statement periods are half-open [start, end) in Asia/Baghdad (plan §40). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
