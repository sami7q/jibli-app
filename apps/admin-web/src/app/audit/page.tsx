'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dateTimeAr, relativeAr } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import { Card, DataTable, ErrorState, FilterBar, Select, Skeleton } from '@/components/ui';
import { adminApi, ApiError, type AuditEntry } from '@/lib/api';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Audit trail (plan §64).
 *
 * Every high-risk action the plan enumerates writes here: geography changes,
 * restaurant approval and suspension, commission changes, role changes,
 * settlement issue and void, payment recording, finance adjustments, delivery
 * overrides, driver suspension and customer blocks.
 *
 * The request ID column matters more than it looks: it ties a row back to the
 * exact HTTP request in the application logs (plan §89), which is how a support
 * escalation gets from "a customer complained" to "here is what happened".
 */

/** Arabic labels for the action codes, grouped as an operator thinks of them. */
const ACTION_LABELS: Record<string, string> = {
  'geography.governorate.update': 'تعديل تغطية محافظة',
  'geography.city.update': 'تعديل تغطية مدينة',
  'restaurant.create': 'إنشاء مطعم',
  'restaurant.approve': 'اعتماد مطعم',
  'restaurant.reject': 'رفض طلب انضمام',
  'restaurant.request_info': 'طلب معلومات إضافية',
  'restaurant.suspend': 'إيقاف مطعم',
  'restaurant.reactivate': 'تفعيل مطعم',
  'restaurant.commission.update': 'تعديل نسبة عمولة',
  'restaurant.location_change.approve': 'اعتماد نقل موقع مطعم',
  'roles.grant': 'منح دور',
  'roles.revoke': 'سحب دور',
  'staff.invite': 'دعوة موظف',
  'staff.deactivate': 'إيقاف موظف',
  'finance.settlement.generate': 'توليد تسوية',
  'finance.settlement.issue': 'إصدار كشف عمولة',
  'finance.settlement.void': 'إلغاء كشف عمولة',
  'finance.payment.record': 'تسجيل دفعة',
  'finance.adjustment.create': 'إنشاء تعديل مالي',
  'order.override': 'تدخل إداري على طلب',
  'delivery.pin.override': 'تجاوز رمز التسليم',
  'driver.create': 'إنشاء سائق',
  'driver.suspend': 'إيقاف سائق',
  'customer.block': 'حظر عميل',
  'customer.phone.unmask': 'إظهار رقم هاتف عميل',
  'config.update': 'تعديل إعداد منصة',
  'inventory.adjust': 'تعديل مخزون',
  'export.create': 'تصدير بيانات',
};

/** Actions that move money or grant power — highlighted in the list. */
const HIGH_RISK = new Set([
  'finance.settlement.void',
  'finance.adjustment.create',
  'restaurant.commission.update',
  'roles.grant',
  'roles.revoke',
  'customer.phone.unmask',
  'delivery.pin.override',
  'config.update',
]);

const ENTITY_TYPES = [
  { value: 'governorate', label: 'محافظة' },
  { value: 'city', label: 'مدينة' },
  { value: 'restaurant', label: 'مطعم' },
  { value: 'settlement', label: 'تسوية' },
  { value: 'order', label: 'طلب' },
  { value: 'driver', label: 'سائق' },
  { value: 'user', label: 'مستخدم' },
  { value: 'platform_config', label: 'إعداد' },
] as const;

export default function AuditPage() {
  const session = useAdminSession();
  const [entityType, setEntityType] = useState<string>('');
  const [action, setAction] = useState<string>('');

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const logs = useQuery({
    queryKey: ['admin-audit', entityType, action],
    queryFn: () =>
      adminApi.auditLogs(token, {
        entity_type: entityType || undefined,
        action: action || undefined,
      }),
    enabled: session.status === 'authenticated',
  });

  if (session.status !== 'authenticated') {
    return (
      <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <h1>الرجاء تسجيل الدخول</h1>
      </div>
    );
  }

  return (
    <AdminShell
      title="السجلات والأنشطة"
      subtitle="سجل غير قابل للتعديل لكل إجراء حسّاس على المنصة"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <Card>
        <FilterBar>
          <Select
            value={entityType}
            onChange={setEntityType}
            label="نوع العنصر"
            allLabel="كل الأنواع"
            options={[...ENTITY_TYPES]}
          />
          <Select
            value={action}
            onChange={setAction}
            label="نوع الإجراء"
            allLabel="كل الإجراءات"
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </FilterBar>

        {logs.isError ? (
          <ErrorState
            message={logs.error instanceof ApiError ? logs.error.messageAr : 'تعذّر تحميل السجل'}
            code={logs.error instanceof ApiError ? logs.error.code : undefined}
            onRetry={() => void logs.refetch()}
          />
        ) : logs.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AuditEntry>
            caption="سجل الأنشطة"
            rows={logs.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage="لا توجد سجلات مطابقة"
            columns={[
              {
                key: 'action',
                header: 'الإجراء',
                render: (row) => (
                  <span style={{ fontWeight: HIGH_RISK.has(row.action) ? 700 : 400 }}>
                    {HIGH_RISK.has(row.action) ? '🔒 ' : ''}
                    {ACTION_LABELS[row.action] ?? row.action}
                  </span>
                ),
              },
              {
                key: 'entity',
                header: 'العنصر',
                render: (row) => (
                  <span>
                    {row.entity_type}
                    {row.entity_id ? (
                      <>
                        <br />
                        <span
                          className="ltr-inline"
                          style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
                        >
                          {row.entity_id.slice(0, 8)}…
                        </span>
                      </>
                    ) : null}
                  </span>
                ),
              },
              { key: 'actor', header: 'المنفّذ', render: (row) => row.actor ?? 'النظام' },
              {
                key: 'reason',
                header: 'السبب',
                render: (row) =>
                  row.reason ? (
                    <span style={{ fontSize: 'var(--text-xs)' }}>{row.reason}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  ),
              },
              {
                key: 'when',
                header: 'الوقت',
                render: (row) => (
                  <span title={dateTimeAr(row.created_at)}>{relativeAr(row.created_at)}</span>
                ),
              },
              {
                key: 'request',
                header: 'معرّف الطلب',
                render: (row) =>
                  row.request_id ? (
                    // Ties this row to the HTTP request in the logs (plan §89).
                    <code
                      className="ltr-inline"
                      style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
                    >
                      {row.request_id.slice(0, 8)}
                    </code>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        )}

        <p
          style={{
            marginTop: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          لا يحتوي السجل على كلمات مرور أو رموز تحقق أو رموز تسليم — تُحذف هذه القيم قبل الكتابة.
        </p>
      </Card>
    </AdminShell>
  );
}
