'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { relativeAr } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { adminApi, ApiError, type RestaurantApplication } from '@/lib/api';
import { admin } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Restaurant onboarding review (plan §15.2, §69).
 *
 * Approval is a command, not a status flip: it creates the restaurant, branch,
 * owner membership and commission config. The commission itself is not asked
 * for here — it is one platform-wide amount, set in Settings, and the approved
 * restaurant starts on it.
 */
export default function ApplicationsPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<RestaurantApplication | null>(null);
  const [rejecting, setRejecting] = useState<RestaurantApplication | null>(null);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const applications = useQuery({
    queryKey: ['admin-applications', 'UNDER_REVIEW'],
    queryFn: () => adminApi.applications(token, 'UNDER_REVIEW'),
    enabled: session.status === 'authenticated',
  });

  /*
   * Courier applications live on the drivers page, next to the roster they
   * join. This page is where an operator looks for «طلبات الانضمام», so it
   * points there rather than leaving them to guess.
   */
  const driverApplications = useQuery({
    queryKey: ['admin-driver-applications'],
    queryFn: () => admin.driverApplications(token),
    enabled: session.status === 'authenticated',
  });
  const pendingDrivers = driverApplications.data?.length ?? 0;

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi.rejectApplication(token, id, reason),
    onSuccess: () => {
      setRejecting(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-applications'] });
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  return (
    <AdminShell
      title="طلبات الانضمام"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      pendingApplications={applications.data?.length ?? 0}
    >
      {pendingDrivers > 0 ? (
        <div className="alert-bar alert-bar--warning">
          <Icon name="drivers" className="nav__icon" aria-hidden />
          <span>
            {pendingDrivers === 1 ? 'طلب انضمام كمندوب' : `${pendingDrivers} طلبات انضمام كمندوبين`}{' '}
            بانتظار المراجعة — <Link href="/drivers">راجِعها في صفحة المندوبين</Link>
          </span>
        </div>
      ) : null}

      <Card>
        {applications.isError ? (
          <ErrorState
            message={
              applications.error instanceof ApiError
                ? applications.error.messageAr
                : 'تعذّر تحميل طلبات الانضمام'
            }
            onRetry={() => void applications.refetch()}
          />
        ) : applications.isLoading ? (
          <Skeleton height={280} />
        ) : (
          <DataTable<RestaurantApplication>
            caption="طلبات الانضمام قيد المراجعة"
            rows={applications.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage="لا توجد طلبات انضمام بانتظار المراجعة"
            columns={[
              {
                key: 'name',
                header: 'المطعم',
                render: (row) => <strong>{row.display_name}</strong>,
              },
              {
                key: 'location',
                header: 'الموقع',
                render: (row) => `${row.governorate_name_ar} - ${row.city_name_ar}`,
              },
              {
                key: 'phone',
                header: 'الهاتف',
                render: (row) => <span className="ltr-inline">{row.contact_phone}</span>,
              },
              { key: 'address', header: 'العنوان', render: (row) => row.address_text },
              {
                key: 'coverage',
                header: 'التغطية',
                render: (row) =>
                  row.coverage_warning ? (
                    // Approval is blocked by default when the city closed after
                    // submission (plan §15.2) — flagged before the click.
                    <Badge tone="warning">
                      <Icon name="alert" className="nav__icon" aria-hidden />
                      المدينة غير مفعّلة
                    </Badge>
                  ) : (
                    <Badge tone="success">جاهزة</Badge>
                  ),
              },
              { key: 'age', header: 'منذ', render: (row) => relativeAr(row.created_at) },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => setReviewing(row)}
                    >
                      مراجعة
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => setRejecting(row)}
                    >
                      رفض
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      {reviewing ? (
        <ApproveDialog
          token={token}
          application={reviewing}
          onDone={() => {
            setReviewing(null);
            void queryClient.invalidateQueries({ queryKey: ['admin-applications'] });
          }}
          onCancel={() => setReviewing(null)}
        />
      ) : null}

      {rejecting ? (
        <ConfirmDialog
          title={`رفض طلب ${rejecting.display_name}`}
          confirmLabel="رفض الطلب"
          requireReason
          isSubmitting={reject.isPending}
          error={reject.error instanceof ApiError ? reject.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              يُشعَر مقدّم الطلب بالرفض مع السبب. يمكنه التقديم مرة أخرى لاحقاً.
            </p>
          }
          onConfirm={(reason) => reject.mutate({ id: rejecting.id, reason })}
          onCancel={() => setRejecting(null)}
        />
      ) : null}
    </AdminShell>
  );
}

/**
 * Approval dialog.
 *
 * Collects the commercial terms that approval creates, and forces an explicit
 * override decision when the city has closed since the application arrived.
 */
function ApproveDialog({
  token,
  application,
  onDone,
  onCancel,
}: {
  token: string;
  application: RestaurantApplication;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [policy, setPolicy] = useState<'HALF_MONTH' | 'MONTHLY'>('HALF_MONTH');
  const [overrideCoverage, setOverrideCoverage] = useState(false);
  const [reason, setReason] = useState('');

  const approve = useMutation({
    mutationFn: () =>
      adminApi.approveApplication(token, application.id, {
        /*
         * No commission on the wire: it is one platform-wide amount, and the
         * API falls back to it. Typing a number here per application is how
         * two restaurants end up on terms nobody chose.
         */
        settlement_policy: policy,
        override_coverage: overrideCoverage,
        reason: reason || undefined,
      }),
    onSuccess: onDone,
  });

  const needsOverride = application.coverage_warning;
  const canSubmit = !needsOverride || (overrideCoverage && reason.trim().length >= 5);

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="approve-title">
      <div className="dialog">
        <h2 id="approve-title">اعتماد {application.display_name}</h2>

        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          {application.governorate_name_ar} - {application.city_name_ar} ·{' '}
          <span className="ltr-inline">{application.contact_phone}</span>
        </p>

        {needsOverride ? (
          <div className="dialog__impact">
            <strong>
              <Icon name="alert" className="nav__icon" aria-hidden /> المدينة غير مفعّلة للانضمام
            </strong>
            <p style={{ margin: 0 }}>
              أُغلقت المدينة بعد تقديم الطلب. يمكنك الاعتماد رغم ذلك، لكن المطعم لن يستقبل طلبات
              حتى تُفعَّل الطلبات في المدينة — الاعتماد والتفعيل طبقتان مستقلتان.
            </p>
            <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={overrideCoverage}
                onChange={(event) => setOverrideCoverage(event.target.checked)}
              />
              أؤكد الاعتماد رغم إغلاق المدينة
            </label>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="policy">دورة التسوية</label>
          <select
            id="policy"
            value={policy}
            onChange={(event) => setPolicy(event.target.value as 'HALF_MONTH' | 'MONTHLY')}
          >
            <option value="HALF_MONTH">نصف شهرية (1–15، 16–نهاية الشهر)</option>
            <option value="MONTHLY">شهرية</option>
          </select>
        </div>

        {needsOverride ? (
          <div className="field">
            <label htmlFor="approve-reason">سبب تجاوز إغلاق المدينة (مطلوب)</label>
            <textarea
              id="approve-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        ) : null}

        {approve.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {approve.error instanceof ApiError ? approve.error.messageAr : 'تعذّر الاعتماد'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSubmit || approve.isPending}
            onClick={() => approve.mutate()}
          >
            {approve.isPending ? 'جاري الاعتماد…' : 'اعتماد المطعم'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          بعد الاعتماد يبقى المطعم بحالة «قيد الإعداد» حتى تجتاز قائمة الجاهزية ويُفعَّل يدوياً.
        </p>
      </div>
    </div>
  );
}
