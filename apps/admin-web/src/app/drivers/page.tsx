'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { relativeAr } from '@jibli/ui-web';
import { DRIVER_ACCOUNT_STATUSES, type DriverAccountStatus } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  FilterBar,
  Money,
  SearchInput,
  Select,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type AdminDriver } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';
import { useDebounced } from '@/hooks/use-debounced';
import { SignedOut } from '@/components/signed-out';

/**
 * Driver oversight (plan §45, §54, §87).
 *
 * Drivers belong to restaurants; Admin does not create them. What Admin does
 * need is visibility across every restaurant — especially cash custody, because
 * a driver holding a large uncleared balance is an operational risk regardless
 * of which restaurant employs them.
 */

const STATUS_LABELS: Record<DriverAccountStatus, string> = {
  PENDING_ACTIVATION: 'بانتظار التفعيل',
  ACTIVE: 'نشط',
  SUSPENDED: 'موقوف',
  DEACTIVATED: 'معطّل',
};

const AVAILABILITY_LABELS: Record<string, string> = {
  OFFLINE: 'غير متصل',
  AVAILABLE: 'متاح',
  BUSY: 'مشغول',
  ON_DELIVERY: 'في التوصيل',
  BREAK: 'استراحة',
};

const VEHICLE_LABELS: Record<string, string> = {
  MOTORCYCLE: 'دراجة نارية',
  CAR: 'سيارة',
  BICYCLE: 'دراجة هوائية',
  ON_FOOT: 'سيراً',
};

export default function DriversPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DriverAccountStatus | ''>('');
  const [suspending, setSuspending] = useState<AdminDriver | null>(null);

  const debouncedSearch = useDebounced(search, 350);
  const token = session.status === 'authenticated' ? session.accessToken : '';

  const drivers = useQuery({
    queryKey: ['admin-drivers', debouncedSearch, status],
    queryFn: () =>
      admin.drivers(token, { q: debouncedSearch || undefined, status: status || undefined }),
    enabled: session.status === 'authenticated',
  });

  const suspend = useMutation({
    mutationFn: ({ id, suspended, reason }: { id: string; suspended: boolean; reason: string }) =>
      admin.suspendDriver(token, id, suspended, reason),
    onSuccess: () => {
      setSuspending(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-drivers'] });
    },
  });

  if (session.status !== 'authenticated') {
    return <SignedOut reason={session.status === 'unauthenticated' ? session.reason : undefined} />;
  }

  const rows = drivers.data ?? [];
  const totalCustody = rows.reduce((sum, row) => sum + row.cash_custody_iqd, 0);

  return (
    <AdminShell
      title="المندوبون"
      subtitle="سائقو التوصيل التابعون للمطاعم وعهدهم النقدية"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      {totalCustody > 0 ? (
        <div className="alert-bar alert-bar--warning">
          <Icon name="cash" className="nav__icon" aria-hidden />
          <span>
            إجمالي العهدة النقدية لدى المندوبين: <Money amount={totalCustody} />. هذه أموال تخص
            المطاعم وليست رصيداً لدى جيبلي.
          </span>
        </div>
      ) : null}

      <Card>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            label="البحث عن مندوب"
            placeholder="اسم المندوب…"
          />
          <Select
            value={status}
            onChange={setStatus}
            label="حالة الحساب"
            allLabel="كل الحالات"
            options={DRIVER_ACCOUNT_STATUSES.map((value) => ({
              value,
              label: STATUS_LABELS[value],
            }))}
          />
        </FilterBar>

        {drivers.isError ? (
          <ErrorState
            message={
              drivers.error instanceof ApiError ? drivers.error.messageAr : 'تعذّر تحميل المندوبين'
            }
            onRetry={() => void drivers.refetch()}
          />
        ) : drivers.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AdminDriver>
            caption="قائمة المندوبين"
            rows={rows}
            keyOf={(row) => row.id}
            emptyMessage="لا يوجد مندوبون مطابقون"
            columns={[
              { key: 'name', header: 'الاسم', render: (row) => row.full_name ?? '—' },
              {
                key: 'phone',
                header: 'الهاتف',
                render: (row) => <span className="ltr-inline">{row.phone}</span>,
              },
              {
                key: 'restaurant',
                header: 'المطعم',
                render: (row) => row.restaurant_name ?? '—',
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) => (
                  <Badge
                    tone={
                      row.status === 'ACTIVE'
                        ? 'success'
                        : row.status === 'SUSPENDED'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {STATUS_LABELS[row.status as DriverAccountStatus]}
                  </Badge>
                ),
              },
              {
                key: 'availability',
                header: 'التوفر',
                render: (row) => AVAILABILITY_LABELS[row.availability] ?? row.availability,
              },
              {
                key: 'vehicle',
                header: 'المركبة',
                render: (row) => VEHICLE_LABELS[row.vehicle_type] ?? row.vehicle_type,
              },
              {
                key: 'active',
                header: 'مهام نشطة',
                numeric: true,
                render: (row) =>
                  row.active_assignments > 0 ? (
                    <Badge tone="warning">{row.active_assignments}</Badge>
                  ) : (
                    '0'
                  ),
              },
              {
                key: 'completed',
                header: 'توصيلات مكتملة',
                numeric: true,
                render: (row) => row.completed_deliveries,
              },
              {
                key: 'custody',
                header: 'العهدة النقدية',
                numeric: true,
                render: (row) =>
                  row.cash_custody_iqd > 0 ? (
                    <strong style={{ color: 'var(--jibli-warning-700)' }}>
                      <Money amount={row.cash_custody_iqd} />
                    </strong>
                  ) : (
                    <Money amount={0} />
                  ),
              },
              {
                key: 'seen',
                header: 'آخر ظهور',
                render: (row) => (row.last_seen_at ? relativeAr(row.last_seen_at) : '—'),
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <button
                    type="button"
                    className={`btn btn--sm ${row.status === 'ACTIVE' ? 'btn--danger' : 'btn--outline'}`}
                    onClick={() => setSuspending(row)}
                  >
                    {row.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}
                  </button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {suspending ? (
        <ConfirmDialog
          title={
            suspending.status === 'ACTIVE'
              ? `إيقاف ${suspending.full_name ?? 'المندوب'}`
              : `تفعيل ${suspending.full_name ?? 'المندوب'}`
          }
          confirmLabel={suspending.status === 'ACTIVE' ? 'إيقاف المندوب' : 'تفعيل المندوب'}
          tone={suspending.status === 'ACTIVE' ? 'danger' : 'primary'}
          requireReason
          isSubmitting={suspend.isPending}
          error={suspend.error instanceof ApiError ? suspend.error.messageAr : null}
          body={
            <div className="dialog__impact">
              {suspending.active_assignments > 0 ? (
                <>
                  <strong>
                    <Icon name="alert" className="nav__icon" aria-hidden /> لدى المندوب{' '}
                    {suspending.active_assignments} مهمة توصيل نشطة
                  </strong>
                  <p style={{ margin: 0 }}>
                    لا يمكن الإيقاف والطعام في يده. أعد تعيين المهام النشطة إلى مندوب آخر أولاً.
                  </p>
                </>
              ) : (
                <p style={{ margin: 0 }}>
                  {suspending.status === 'ACTIVE'
                    ? 'تُنهى جلسات المندوب فوراً ويختفي وضع السائق من تطبيقه. لا تتأثر سجلات التوصيل السابقة.'
                    : 'يستعيد المندوب القدرة على استلام مهام التوصيل.'}
                </p>
              )}

              {suspending.cash_custody_iqd > 0 ? (
                <p style={{ margin: 0 }}>
                  لديه عهدة نقدية قدرها <Money amount={suspending.cash_custody_iqd} /> — تأكد من
                  تسليمها للمطعم.
                </p>
              ) : null}
            </div>
          }
          onConfirm={(reason) =>
            suspend.mutate({
              id: suspending.id,
              suspended: suspending.status === 'ACTIVE',
              reason,
            })
          }
          onCancel={() => setSuspending(null)}
        />
      ) : null}
    </AdminShell>
  );
}
