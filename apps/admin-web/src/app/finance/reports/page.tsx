'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminShell } from '@/components/shell';
import { CollectionPanel } from '@/components/collection-panel';
import { Dropdown } from '@/components/dropdown';
import { Badge, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Financial reports (plan §39, §95, §129, §130).
 *
 * The defining rule of this screen: **accrued, collected and outstanding are
 * three different numbers and are never summed together.** Plan §130 calls this
 * out because it is the mistake that makes a platform believe it has revenue it
 * has not collected.
 *
 * The reconciliation panel sits at the top rather than the bottom: if the
 * invariants are failing, every figure below is suspect and the operator should
 * know that before reading them.
 *
 * Collection lives here too, under the reports rather than beside the
 * statements, because "how much have we earned" and "go and collect it" are the
 * same sitting: an operator reading the outstanding figure is the operator who
 * decides to ring a restaurant about it.
 */
export default function FinanceReportsPage() {
  const session = useAdminSession();
  const [days, setDays] = useState(30);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const summary = useQuery({
    queryKey: ['admin-finance-summary', days],
    queryFn: () => admin.financeSummary(token, days),
    enabled: session.status === 'authenticated',
  });

  const orderStats = useQuery({
    queryKey: ['admin-order-stats', days],
    queryFn: () => admin.orderStats(token, days),
    enabled: session.status === 'authenticated',
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const data = summary.data;
  const stats = orderStats.data;
  const failedChecks = (data?.reconciliation ?? []).filter((check) => !check.passed);

  return (
    <AdminShell
      title="التقارير المالية"
      subtitle="أداء المنصة المالي وحالة المطابقة"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        <Dropdown
          value={String(days)}
          onChange={(value) => setDays(Number(value) || 30)}
          label="الفترة"
          options={[
            { value: '7', label: 'آخر ٧ أيام' },
            { value: '30', label: 'آخر ٣٠ يوماً' },
            { value: '90', label: 'آخر ٩٠ يوماً' },
            { value: '365', label: 'آخر سنة' },
          ]}
        />
      }
    >
      {/* ── Reconciliation first (plan §95) ───────────────────────────────── */}
      <Card title="حالة المطابقة المالية" icon="reports">
        {summary.isLoading ? (
          <Skeleton height={120} />
        ) : failedChecks.length > 0 ? (
          <>
            <div className="alert-bar alert-bar--danger" role="alert">
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span>
                فشلت مطابقة واحدة أو أكثر. <strong>لا تعتمد الأرقام أدناه</strong> قبل حل الاختلاف —
                راجع دليل حوادث المالية.
              </span>
            </div>
            <ul style={{ marginTop: 'var(--space-3)', paddingInlineStart: 'var(--space-5)' }}>
              {failedChecks.map((check) => (
                <li key={`${check.check}-${check.business_date}`}>
                  <code className="ltr-inline">{check.check}</code> — {check.business_date}
                  {check.variance_iqd !== null ? (
                    <>
                      {' '}
                      (فرق <Money amount={check.variance_iqd} />)
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (data?.reconciliation.length ?? 0) === 0 ? (
          <p className="empty">لم تُشغَّل المطابقة بعد</p>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {(data?.reconciliation ?? []).map((check) => (
              <div
                key={`${check.check}-${check.business_date}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--jibli-success-50)',
                }}
              >
                <Icon name="check" className="nav__icon" aria-hidden />
                <span style={{ fontSize: 'var(--text-sm)' }}>
                  <code className="ltr-inline">{check.check}</code>
                  <br />
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                    {check.business_date}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/*
        Collection, directly under reconciliation: the outstanding figure is
        only trustworthy when the checks above pass, and an operator should see
        that before pressing a button that records money as received.
      */}
      <CollectionPanel token={token} />

      {/* ── Platform revenue, each figure named precisely ─────────────────── */}
      <Card title="إيرادات المنصة" icon="commissions">
        {summary.isLoading ? (
          <Skeleton height={180} />
        ) : summary.isError ? (
          <ErrorState
            message={summary.error instanceof ApiError ? summary.error.messageAr : 'تعذّر التحميل'}
            onRetry={() => void summary.refetch()}
          />
        ) : (
          <div className="stats">
            <FigureTile
              label="إجمالي الأرباح"
              definition="العمولة ورسوم الخدمة على الطلبات المكتملة في الفترة"
              value={(data?.commission_accrued_iqd ?? 0) + (data?.service_fee_revenue_iqd ?? 0)}
              tone="green"
            />
            <FigureTile
              label="عمولة مستحقة"
              definition={data?.definitions_ar.commission_accrued}
              value={data?.commission_accrued_iqd ?? 0}
              tone="orange"
            />
            <FigureTile
              label="أرباح محصّلة"
              definition="العمولة ورسوم الخدمة المحصّلة فعلياً من المتاجر"
              value={data?.commission_collected_iqd ?? 0}
              tone="green"
            />
            <FigureTile
              label="رسوم الخدمة"
              definition="تُضاف لرسوم التوصيل عند العميل وتُحصَّل من المتجر مع العمولة"
              value={data?.service_fee_revenue_iqd ?? 0}
              tone="blue"
            />
            <FigureTile
              label="ائتمانات صادرة"
              definition="خصومات وتعديلات لصالح المطاعم"
              value={data?.credits_issued_iqd ?? 0}
              tone="amber"
            />
          </div>
        )}

        <p
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3)',
            background: 'var(--surface-sunken)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
          }}
        >
          <strong>ملاحظة محاسبية:</strong> «العمولة المستحقة» و«العمولة المحصّلة» رقمان مختلفان ولا
          يُجمعان. المستحق هو ما تولّد على الطلبات المكتملة؛ المحصّل هو ما دفعته المطاعم فعلاً.
          الفرق بينهما هو الذمم المدينة.
        </p>
      </Card>

      {/* ── Receivables ──────────────────────────────────────────────────── */}
      <Card title="الذمم المدينة" icon="invoices">
        {summary.isLoading ? (
          <Skeleton height={120} />
        ) : (
          <div className="stats">
            <FigureTile
              label="مبالغ غير مسددة"
              definition={`${data?.outstanding_settlements ?? 0} كشف صادر`}
              value={data?.outstanding_iqd ?? 0}
              tone="blue"
            />
            <FigureTile
              label="مبالغ متأخرة"
              definition={`${data?.overdue_settlements ?? 0} كشف تجاوز تاريخ الاستحقاق`}
              value={data?.overdue_iqd ?? 0}
              tone="amber"
            />
          </div>
        )}
      </Card>

      {/* ── Operational KPIs (plan §129) ──────────────────────────────────── */}
      <Card title="مؤشرات التشغيل" icon="chart">
        {orderStats.isLoading ? (
          <Skeleton height={140} />
        ) : (
          <div className="stats">
            <StatTile label="إجمالي الطلبات" value={String(stats?.orders_total ?? 0)} />
            <StatTile label="طلبات مكتملة" value={String(stats?.orders_completed ?? 0)} />
            <StatTile
              label="معدل الإتمام"
              value={`${stats?.completion_rate ?? 0}%`}
              tone={
                (stats?.completion_rate ?? 100) < 80
                  ? 'danger'
                  : (stats?.completion_rate ?? 100) < 90
                    ? 'warning'
                    : 'success'
              }
            />
            <StatTile
              label="متوسط قيمة الطلب"
              value={new Intl.NumberFormat('en-US').format(stats?.average_order_iqd ?? 0)}
            />
            <StatTile
              label="إجمالي المبيعات"
              value={new Intl.NumberFormat('en-US').format(stats?.gmv_iqd ?? 0)}
            />
            <StatTile label="طلبات ملغاة" value={String(stats?.orders_cancelled ?? 0)} />
          </div>
        )}
      </Card>
    </AdminShell>
  );
}

function FigureTile({
  label,
  definition,
  value,
  tone,
}: {
  label: string;
  definition: string | undefined;
  value: number;
  tone: 'orange' | 'green' | 'blue' | 'amber';
}) {
  return (
    <div className="stat">
      <div className={`stat__icon stat__icon--${tone}`} aria-hidden>
        <Icon name="cash" className="nav__icon" />
      </div>
      <div className="stat__body">
        <span className="stat__value numeric">
          <Money amount={value} />
        </span>
        <span className="stat__label">{label}</span>
        {/* Each figure carries its own definition (plan §130). */}
        {definition ? (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {definition}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="stat">
      <div className="stat__body">
        <span className="stat__value numeric">{value}</span>
        <span className="stat__label">{label}</span>
        {tone ? (
          <Badge tone={tone}>
            {tone === 'success' ? 'ضمن المستهدف' : tone === 'warning' ? 'يحتاج متابعة' : 'منخفض'}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
