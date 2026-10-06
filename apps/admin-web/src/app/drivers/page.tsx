'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { relativeAr } from '@jibli/ui-web';
import {
  DRIVER_ACCOUNT_STATUSES,
  VEHICLE_TYPES,
  type DriverAccountStatus,
  type VehicleType,
} from '@jibli/contracts';
import { tryToE164Iraq } from '@jibli/validation';
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
import { admin, type AdminDriver, type AdminDriverApplication } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';
import { useDebounced } from '@/hooks/use-debounced';

/**
 * Driver oversight (plan §45, §54, §87).
 *
 * Admin sees every courier, whoever recruited them — especially their cash
 * custody, because a driver holding a large uncleared balance is an operational
 * risk regardless of which restaurant employs them.
 *
 * It can also add one. That used to be false, and the gap showed at exactly the
 * wrong moment: the first couriers in a newly opened city are recruited by the
 * platform, because there is not yet a restaurant to hire them. A restaurant
 * could add a driver and a customer could apply to become one, and the operator
 * setting the city up could do neither.
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
  const [adding, setAdding] = useState(false);

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
    return <SessionGate session={session} />;
  }

  const rows = drivers.data ?? [];
  const totalCustody = rows.reduce((sum, row) => sum + row.cash_custody_iqd, 0);

  return (
    <AdminShell
      title="المندوبون"
      subtitle="مندوبو المنصة والمطاعم وعهدهم النقدية"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        session.can('driver.create') ? (
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            إضافة مندوب
          </button>
        ) : null
      }
    >
      <DriverApplications token={token} canReview={session.can('driver.create')} />

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
                render: (row) =>
                  // A pending driver is accepted in the queue above, not unsuspended here.
                  row.status === 'PENDING_ACTIVATION' ? null : (
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

      {adding ? (
        <AddDriverDialog
          token={token}
          onDone={() => {
            setAdding(false);
            void queryClient.invalidateQueries({ queryKey: ['admin-drivers'] });
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

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

/**
 * Add a courier to the platform's roster.
 *
 * Four fields, and the phone is the load-bearing one: it is the identity. If
 * the number already belongs to a Jibli customer, the server attaches a driver
 * profile to that same person rather than creating a second account — one
 * identity per phone, everywhere.
 *
 * The account is created PENDING_ACTIVATION and joins the applications queue at
 * the top of this page, where it is accepted like any other. The form used to
 * promise that the driver would activate it by signing in — nothing did, so
 * every courier added here waited forever. It says what actually happens now.
 */
function AddDriverDialog({
  token,
  onDone,
  onCancel,
}: {
  token: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [plate, setPlate] = useState('');

  /*
   * Accepts what an Iraqi operator actually types — 07xx, +9647xx, Arabic-Indic
   * digits — and normalises to E.164 for the API. Returns null when it is not a
   * valid Iraqi mobile, which is what gates the button.
   */
  const parsed = tryToE164Iraq(phone);
  const normalized = parsed.ok ? parsed.value : null;

  const create = useMutation({
    mutationFn: () =>
      admin.createDriver(token, {
        full_name: fullName.trim(),
        // Non-null: the button is disabled until the number parses.
        phone: normalized ?? '',
        vehicle_type: vehicleType,
        ...(plate.trim() ? { plate_number: plate.trim() } : {}),
      }),
    onSuccess: onDone,
  });

  const canSave = fullName.trim().length >= 3 && normalized !== null && !create.isPending;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="driver-title">
      <div className="dialog">
        <h2 id="driver-title">إضافة مندوب</h2>

        <div className="field">
          <label htmlFor="driver-name">اسم المندوب</label>
          <input
            id="driver-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="أحمد كاظم"
            maxLength={80}
          />
          <span className="field__hint">كما يظهر للعميل عند وصول الطلب.</span>
        </div>

        <div className="field">
          <label htmlFor="driver-phone">رقم الهاتف</label>
          <input
            id="driver-phone"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="07XX XXX XXXX"
            aria-invalid={phone !== '' && normalized === null}
          />
          <span className="field__hint">
            هذا الرقم هو هويّته في جيبلي — يسجّل الدخول به في التطبيق ويستلم رمز التحقق عليه.
          </span>
          {phone !== '' && normalized === null ? (
            <span className="field__error">رقم عراقي غير صالح</span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="driver-vehicle">وسيلة التوصيل</label>
          <select
            id="driver-vehicle"
            value={vehicleType}
            onChange={(event) => setVehicleType(event.target.value as VehicleType)}
          >
            {VEHICLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {VEHICLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="driver-plate">رقم المركبة (اختياري)</label>
          <input
            id="driver-plate"
            dir="ltr"
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            placeholder="12345 بغداد"
            maxLength={20}
          />
        </div>

        <p className="auth__note" style={{ margin: 0 }}>
          يُنشأ الحساب بحالة «بانتظار التفعيل» ويظهر في «طلبات الانضمام كمندوب» أعلى هذه الصفحة.
          اقبله من هناك، ثم يسجّل المندوب الدخول في تطبيق جيبلي برقمه ويبدأ الاستلام.
        </p>

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر إنشاء المندوب'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSave}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الإنشاء…' : 'إنشاء المندوب'}
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
 * People waiting to become couriers, at the top of the page they belong to.
 *
 * An application from the app («الانضمام كمندوب») used to be saved and then
 * seen by nobody: it sat in the list below as one «بانتظار التفعيل» row among
 * the whole roster, with a masked number and no way to say yes except
 * «unsuspend», which asked for a reason. This is the queue, oldest first, with
 * the number to call and one button each way.
 */
function DriverApplications({ token, canReview }: { token: string; canReview: boolean }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<AdminDriverApplication | null>(null);

  const applications = useQuery({
    queryKey: ['admin-driver-applications'],
    queryFn: () => admin.driverApplications(token),
    enabled: token !== '',
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-driver-applications'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-drivers'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => admin.approveDriverApplication(token, id),
    onSuccess: refresh,
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      admin.rejectDriverApplication(token, id, reason),
    onSuccess: () => {
      setRejecting(null);
      refresh();
    },
  });

  const rows = applications.data ?? [];
  // Nothing waiting: say nothing. The roster below is the page.
  if (applications.isSuccess && rows.length === 0) return null;

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>طلبات الانضمام كمندوب</h2>
        {rows.length > 0 ? <Badge tone="warning">{rows.length}</Badge> : null}
      </div>

      {applications.isError ? (
        <ErrorState
          message={
            applications.error instanceof ApiError
              ? applications.error.messageAr
              : 'تعذّر تحميل طلبات المندوبين'
          }
          onRetry={() => void applications.refetch()}
        />
      ) : applications.isLoading ? (
        <Skeleton height={120} />
      ) : (
        <>
          {approve.error ? (
            <p className="alert-bar alert-bar--danger" role="alert">
              {approve.error instanceof ApiError ? approve.error.messageAr : 'تعذّر قبول الطلب'}
            </p>
          ) : null}
          <DataTable<AdminDriverApplication>
            caption="طلبات الانضمام كمندوب بانتظار المراجعة"
            rows={rows}
            keyOf={(row) => row.id}
            emptyMessage="لا توجد طلبات"
            columns={[
              {
                key: 'name',
                header: 'الاسم',
                render: (row) => <strong>{row.full_name ?? '—'}</strong>,
              },
              {
                key: 'phone',
                header: 'الهاتف',
                render: (row) =>
                  row.phone && !row.phone_masked ? (
                    <a className="ltr-inline" href={`tel:${row.phone}`}>
                      {row.phone}
                    </a>
                  ) : (
                    <span className="ltr-inline">{row.phone ?? '—'}</span>
                  ),
              },
              { key: 'city', header: 'المدينة', render: (row) => row.city_name_ar ?? '—' },
              {
                key: 'vehicle',
                header: 'المركبة',
                render: (row) =>
                  `${VEHICLE_LABELS[row.vehicle_type] ?? row.vehicle_type}${row.plate_number ? ` · ${row.plate_number}` : ''}`,
              },
              {
                key: 'source',
                header: 'المصدر',
                render: (row) => row.restaurant_name ?? 'تقديم من التطبيق',
              },
              { key: 'age', header: 'منذ', render: (row) => relativeAr(row.applied_at) },
              {
                key: 'actions',
                header: '',
                render: (row) =>
                  canReview ? (
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={approve.isPending}
                        onClick={() => approve.mutate(row.id)}
                      >
                        {approve.isPending && approve.variables === row.id
                          ? 'جاري القبول…'
                          : 'قبول'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => setRejecting(row)}
                      >
                        رفض
                      </button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </>
      )}

      {rejecting ? (
        <ConfirmDialog
          title={`رفض طلب ${rejecting.full_name ?? 'المتقدّم'}`}
          confirmLabel="رفض الطلب"
          requireReason
          isSubmitting={reject.isPending}
          error={reject.error instanceof ApiError ? reject.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              يرى المتقدّم «لم يُقبل طلبك» مع هذا السبب في التطبيق.
            </p>
          }
          onConfirm={(reason) => reject.mutate({ id: rejecting.id, reason })}
          onCancel={() => setRejecting(null)}
        />
      ) : null}
    </Card>
  );
}
