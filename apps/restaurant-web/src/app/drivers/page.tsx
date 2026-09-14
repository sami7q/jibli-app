'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VEHICLE_TYPES, type VehicleType } from '@jibli/contracts';
import { DRIVER_AVAILABILITY_LABELS, VEHICLE_TYPE_LABELS, money } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { ApiError, newIdempotencyKey } from '@/lib/api';
import { portal, type DriverCashRow, type PortalDriver } from '@/lib/portal-endpoints';

/**
 * Drivers and their cash custody (plan §45–§48, §54, §96).
 *
 * Drivers belong to the restaurant, not to the platform, so this is where they
 * are created and switched off. Two rules from the plan drive the design:
 *
 *   - A driver holding an active delivery cannot be deactivated. The server
 *     refuses it; this screen says so up front rather than letting someone
 *     discover it through an error.
 *   - Cash in a driver's hands is the *restaurant's* money in transit, never a
 *     balance held by Jibli. The wording here says that plainly, because the
 *     confusion is expensive when it happens.
 */

/*
 * Both maps moved to `@jibli/ui-web/labels`, typed on their enums.
 *
 * The copy that lived here was keyed on `string` and listed an `ONLINE` the
 * enum has never had, while `AVAILABLE`, `ON_DELIVERY` and `BREAK` fell
 * through to the raw English. The order board needed the same words, which is
 * the point at which a second copy stops being a shortcut.
 */
const VEHICLE_LABELS = VEHICLE_TYPE_LABELS;
const AVAILABILITY_LABELS: Record<string, string> = DRIVER_AVAILABILITY_LABELS;

export default function DriversPage() {
  return (
    <PortalPage permission="driver.read" permissionLabelAr="قراءة بيانات المندوبين">
      {({ auth, can }) => (
        <DriversScreen
          auth={auth}
          canManage={can('driver.manage')}
          canSeeCash={can('driver.cash.read')}
          canHandover={can('driver.cash.handover')}
        />
      )}
    </PortalPage>
  );
}

function DriversScreen({
  auth,
  canManage,
  canSeeCash,
  canHandover,
}: {
  auth: PortalAuth;
  canManage: boolean;
  canSeeCash: boolean;
  canHandover: boolean;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PortalDriver | null>(null);
  const [deactivating, setDeactivating] = useState<PortalDriver | null>(null);
  const [handover, setHandover] = useState<DriverCashRow | null>(null);
  const [issuing, setIssuing] = useState<PortalDriver | null>(null);

  const drivers = useQuery({
    queryKey: ['drivers', auth.restaurantId],
    queryFn: () => portal.drivers(auth),
  });

  const cash = useQuery({
    queryKey: ['driver-cash', auth.restaurantId],
    queryFn: () => portal.driverCash(auth),
    enabled: canSeeCash,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['drivers'] });
    void queryClient.invalidateQueries({ queryKey: ['driver-cash'] });
  };

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      portal.updateDriver(auth, id, { is_active: isActive }),
    onSuccess: () => {
      setDeactivating(null);
      invalidate();
    },
  });

  const activate = useMutation({
    mutationFn: (id: string) => portal.activateDriver(auth, id),
    onSuccess: invalidate,
  });

  const setAvailability = useMutation({
    mutationFn: ({ id, availability }: { id: string; availability: 'AVAILABLE' | 'OFFLINE' }) =>
      portal.updateDriver(auth, id, { availability }),
    onSuccess: invalidate,
  });

  const activationError =
    activate.error instanceof ApiError
      ? ((activate.error.details as { messageHint?: string } | undefined)?.messageHint ??
        activate.error.messageAr)
      : activate.error
        ? 'تعذّر تفعيل المندوب'
        : null;

  if (drivers.isError) {
    return (
      <ErrorState
        message={drivers.error instanceof ApiError ? drivers.error.messageAr : 'تعذّر تحميل المندوبين'}
        code={drivers.error instanceof ApiError ? drivers.error.code : undefined}
        onRetry={() => void drivers.refetch()}
      />
    );
  }

  if (drivers.isLoading) return <Skeleton height={420} />;

  const rows = drivers.data ?? [];
  const active = rows.filter((driver) => driver.is_active);
  const onDuty = active.filter((driver) => driver.availability !== 'OFFLINE');
  const totalCustody = (cash.data ?? []).reduce(
    (sum, row) => sum + row.current_custody_iqd,
    0,
  );

  return (
    <>
      <Card
        title="المندوبون"
        icon="drivers"
        subtitle="مندوبو المطعم — التعيين والتوفر وعهدة النقد"
        actions={
          canManage ? (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              إضافة مندوب
            </button>
          ) : null
        }
      >
        <div className="split">
          <div className="figure">
            <span className="figure__label">مندوبون فعّالون</span>
            <span className="figure__value">{active.length}</span>
          </div>
          <div className="figure">
            <span className="figure__label">متصلون الآن</span>
            <span className="figure__value">{onDuty.length}</span>
          </div>
          {canSeeCash ? (
            <div className="figure">
              <span className="figure__label">نقد في عهدة المندوبين</span>
              <span className="figure__value">{money(totalCustody)}</span>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="قائمة المندوبين">
        {activationError ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {activationError}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لم تُضف مندوبين بعد</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              أضف مندوباً برقم هاتفه، ثم يفعّل حسابه بنفسه عبر التطبيق برمز التحقق.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المندوب</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">المركبة</th>
                  <th scope="col" className="numeric">
                    طلبات جارية
                  </th>
                  {canSeeCash ? (
                    <th scope="col" className="numeric">
                      عهدة النقد
                    </th>
                  ) : null}
                  <th scope="col">تحصيل النقد</th>
                  {canManage ? <th scope="col">إجراءات</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((driver) => (
                  <tr key={driver.id} style={{ opacity: driver.is_active ? 1 : 0.55 }}>
                    <td>
                      <strong>{driver.full_name ?? 'بانتظار التفعيل'}</strong>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        <span className="ltr-inline">{driver.phone}</span>
                        {driver.internal_note ? ` · ${driver.internal_note}` : ''}
                      </div>
                    </td>
                    <td>
                      {!driver.is_active ? (
                        <span className="badge badge--neutral">موقوف</span>
                      ) : !driver.activated ? (
                        /*
                         * A button, not a badge.
                         *
                         * It used to say «بانتظار التفعيل» and wait for
                         * something that never came: nothing in the system set
                         * `activated_at`, so a driver added here could never be
                         * assigned an order and the screen gave no hint why.
                         * The restaurant knows this person; it activates them.
                         */
                        canManage ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={activate.isPending}
                            onClick={() => activate.mutate(driver.id)}
                          >
                            {activate.isPending && activate.variables === driver.id
                              ? 'جارٍ التفعيل…'
                              : 'تفعيل المندوب'}
                          </button>
                        ) : (
                          <span className="badge badge--warning">بانتظار التفعيل</span>
                        )
                      ) : driver.availability === 'AVAILABLE' ||
                        driver.availability === 'OFFLINE' ? (
                        /*
                         * On shift or not, as a switch.
                         *
                         * Activating a driver was not enough on its own:
                         * `assignable` also requires availability, which only
                         * the driver could set from Driver Mode — so a driver
                         * standing in the kitchen without the app was activated
                         * and still could not be given an order. The manager
                         * can see who is there.
                         *
                         * BUSY and ON_DELIVERY stay read-only badges below:
                         * they are derived from live assignments, and letting
                         * them be typed over would make the board lie about why
                         * somebody cannot take an order.
                         */
                        canManage ? (
                          <button
                            type="button"
                            className={`badge badge--${
                              driver.availability === 'AVAILABLE' ? 'ready' : 'done'
                            }`}
                            style={{ border: 'none', cursor: 'pointer' }}
                            disabled={setAvailability.isPending}
                            aria-label={`${driver.full_name ?? 'المندوب'}: ${
                              AVAILABILITY_LABELS[driver.availability]
                            }. اضغط للتغيير`}
                            onClick={() =>
                              setAvailability.mutate({
                                id: driver.id,
                                availability:
                                  driver.availability === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE',
                              })
                            }
                          >
                            {AVAILABILITY_LABELS[driver.availability]}
                          </button>
                        ) : (
                          <span
                            className={`badge badge--${
                              driver.availability === 'AVAILABLE' ? 'ready' : 'done'
                            }`}
                          >
                            {AVAILABILITY_LABELS[driver.availability]}
                          </span>
                        )
                      ) : (
                        <span className="badge badge--progress">
                          {AVAILABILITY_LABELS[driver.availability] ?? driver.availability}
                        </span>
                      )}
                    </td>
                    <td>
                      {VEHICLE_LABELS[driver.vehicle_type as VehicleType] ?? driver.vehicle_type}
                      {driver.plate_number ? (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          <span className="ltr-inline">{driver.plate_number}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="numeric">{driver.active_assignments}</td>
                    {canSeeCash ? (
                      <td className="numeric">
                        {driver.cash_custody_iqd > 0 ? (
                          <strong>{money(driver.cash_custody_iqd)}</strong>
                        ) : (
                          money(0)
                        )}
                      </td>
                    ) : null}
                    <td>
                      <span
                        className={`badge badge--${driver.can_collect_cash ? 'ready' : 'neutral'}`}
                      >
                        {driver.can_collect_cash ? 'مسموح' : 'غير مسموح'}
                      </span>
                    </td>
                    {canManage ? (
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setEditing(driver)}
                          >
                            تعديل
                          </button>
                          {/*
                            * The login, issued here because this is where the
                            * restaurant hires. A driver added by phone had no
                            * way into anything but an OTP to that number, and
                            * a delivery handset is usually shared.
                            */}
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setIssuing(driver)}
                          >
                            بيانات الدخول
                          </button>
                          {driver.is_active ? (
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              disabled={driver.active_assignments > 0}
                              title={
                                driver.active_assignments > 0
                                  ? 'أعد تعيين طلبات التوصيل النشطة قبل إيقاف المندوب'
                                  : undefined
                              }
                              onClick={() => setDeactivating(driver)}
                            >
                              إيقاف
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={setActive.isPending}
                              onClick={() =>
                                setActive.mutate({ id: driver.id, isActive: true })
                              }
                            >
                              إعادة تفعيل
                            </button>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {setActive.error ? (
          <ErrorState
            message={
              setActive.error instanceof ApiError
                ? setActive.error.messageAr
                : 'تعذّر تغيير حالة المندوب'
            }
          />
        ) : null}
      </Card>

      {canSeeCash ? (
        <CashCard
          cash={cash.data ?? []}
          isLoading={cash.isLoading}
          error={cash.error}
          canHandover={canHandover}
          onHandover={setHandover}
          onRetry={() => void cash.refetch()}
        />
      ) : null}

      {adding ? (
        <DriverDialog
          auth={auth}
          onDone={() => {
            setAdding(false);
            invalidate();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {issuing ? (
        <CredentialsDialog
          auth={auth}
          driver={issuing}
          onClose={() => setIssuing(null)}
        />
      ) : null}

      {editing ? (
        <EditDriverDialog
          auth={auth}
          driver={editing}
          onDone={() => {
            setEditing(null);
            invalidate();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {deactivating ? (
        <ConfirmDialog
          title={`إيقاف ${deactivating.full_name ?? 'المندوب'}`}
          confirmLabel="إيقاف المندوب"
          isSubmitting={setActive.isPending}
          error={setActive.error instanceof ApiError ? setActive.error.messageAr : null}
          body={
            <div style={{ color: 'var(--text-secondary)' }}>
              <p style={{ marginBlockStart: 0 }}>
                لن يتمكّن من استلام طلبات جديدة. يمكنك إعادة تفعيله في أي وقت.
              </p>
              {deactivating.cash_custody_iqd > 0 ? (
                <p className="alert-bar alert-bar--warning" style={{ marginBlockEnd: 0 }}>
                  <span style={{ flex: 1 }}>
                    لديه عهدة نقدية بقيمة {money(deactivating.cash_custody_iqd)} — سجّل التسليم قبل
                    الإيقاف حتى لا يبقى النقد معلّقاً باسمه.
                  </span>
                </p>
              ) : null}
            </div>
          }
          onConfirm={() => setActive.mutate({ id: deactivating.id, isActive: false })}
          onCancel={() => setDeactivating(null)}
        />
      ) : null}

      {handover ? (
        <HandoverDialog
          auth={auth}
          row={handover}
          onDone={() => {
            setHandover(null);
            invalidate();
          }}
          onCancel={() => setHandover(null)}
        />
      ) : null}
    </>
  );
}

function CashCard({
  cash,
  isLoading,
  error,
  canHandover,
  onHandover,
  onRetry,
}: {
  cash: DriverCashRow[];
  isLoading: boolean;
  error: unknown;
  canHandover: boolean;
  onHandover: (row: DriverCashRow) => void;
  onRetry: () => void;
}) {
  const holding = cash.filter((row) => row.current_custody_iqd !== 0);

  return (
    <Card
      title="عهدة النقد"
      subtitle="ما حصّله المندوبون من العملاء ولم يسلّموه بعد"
    >
      {/*
        Stated once, prominently: this money belongs to the restaurant and is
        simply in transit. It is not a balance Jibli holds or owes (plan §54).
      */}
      <p className="alert-bar alert-bar--warning" role="note">
        <span style={{ flex: 1 }}>
          هذه أموال المطعم لدى المندوبين، وليست رصيداً لدى جيبلي. عمولة جيبلي تُحصَّل عبر كشوف
          التسوية، لا من هذه المبالغ.
        </span>
      </p>

      {isLoading ? <Skeleton height={180} /> : null}

      {error ? (
        <ErrorState
          message={error instanceof ApiError ? error.messageAr : 'تعذّر تحميل عهدة النقد'}
          onRetry={onRetry}
        />
      ) : null}

      {!isLoading && !error ? (
        holding.length === 0 ? (
          <p className="empty">لا توجد عهدة نقدية معلّقة</p>
        ) : (
          <div className="table-wrap" style={{ marginBlockStart: 'var(--space-4)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المندوب</th>
                  <th scope="col" className="numeric">
                    حصّله
                  </th>
                  <th scope="col" className="numeric">
                    سلّمه
                  </th>
                  <th scope="col" className="numeric">
                    تسويات
                  </th>
                  <th scope="col" className="numeric">
                    العهدة الحالية
                  </th>
                  {canHandover ? <th scope="col" /> : null}
                </tr>
              </thead>
              <tbody>
                {holding.map((row) => (
                  <tr key={row.driver_id}>
                    <td>{row.driver_name ?? '—'}</td>
                    <td className="numeric">{money(row.collected_iqd)}</td>
                    <td className="numeric">{money(row.handed_over_iqd)}</td>
                    <td className="numeric">{money(row.adjustments_iqd)}</td>
                    <td className="numeric">
                      <strong
                        style={{
                          color:
                            row.current_custody_iqd > 0
                              ? 'var(--jibli-warning-700)'
                              : 'var(--jibli-danger-700)',
                        }}
                      >
                        {money(row.current_custody_iqd)}
                      </strong>
                    </td>
                    {canHandover ? (
                      <td>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => onHandover(row)}
                        >
                          تسجيل تسليم
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </Card>
  );
}

function HandoverDialog({
  auth,
  row,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  row: DriverCashRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(row.current_custody_iqd);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  // Generated once per dialog: retrying a timed-out submit must not record the
  // handover twice (plan §28).
  const [idempotencyKey] = useState(() => newIdempotencyKey('handover'));

  const submit = useMutation({
    mutationFn: () =>
      portal.recordHandover(
        auth,
        {
          driver_id: row.driver_id,
          amount_iqd: amount,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        },
        idempotencyKey,
      ),
    onSuccess: onDone,
  });

  const invalid =
    !Number.isInteger(amount) || amount <= 0 || amount > row.current_custody_iqd;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="ho-title">
      <div className="dialog">
        <h2 id="ho-title">تسجيل تسليم نقد — {row.driver_name ?? 'مندوب'}</h2>

        <div className="split">
          <div className="figure">
            <span className="figure__label">العهدة الحالية</span>
            <span className="figure__value">{money(row.current_custody_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">المتبقي بعد التسليم</span>
            <span className="figure__value">
              {money(Math.max(row.current_custody_iqd - (Number.isFinite(amount) ? amount : 0), 0))}
            </span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ho-amount">المبلغ المستلم (دينار)</label>
          <input
            id="ho-amount"
            type="number"
            min={0}
            max={row.current_custody_iqd}
            step={250}
            value={amount}
            onChange={(event) => setAmount(Math.trunc(Number(event.target.value)))}
            aria-invalid={invalid}
          />
          {invalid ? (
            <span className="field__error">
              أدخل مبلغاً صحيحاً أكبر من صفر ولا يتجاوز العهدة الحالية
            </span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="ho-ref">رقم الإيصال (اختياري)</label>
          <input
            id="ho-ref"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="ho-note">ملاحظة (اختياري)</label>
          <input id="ho-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        <p className="alert-bar alert-bar--warning">
          <span style={{ flex: 1 }}>
            التسليم يُسجَّل نهائياً ولا يُعدَّل. أي تصحيح يكون بقيد تسوية منفصل حتى يبقى السجل
            كاملاً.
          </span>
        </p>

        {submit.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {submit.error instanceof ApiError ? submit.error.messageAr : 'تعذّر تسجيل التسليم'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={invalid || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? 'جاري التسجيل…' : 'تأكيد الاستلام'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

function DriverDialog({
  auth,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [plate, setPlate] = useState('');
  const [canCollectCash, setCanCollectCash] = useState(true);
  const [note, setNote] = useState('');

  const create = useMutation({
    mutationFn: () =>
      portal.createDriver(auth, {
        full_name: fullName.trim(),
        phone: phone.trim(),
        vehicle_type: vehicleType,
        plate_number: plate.trim() || undefined,
        can_collect_cash: canCollectCash,
        internal_note: note.trim() || undefined,
      }),
    onSuccess: onDone,
  });

  // Loose check only: the server normalises to E.164 and owns the real rule.
  const phoneLooksValid = /^[\d\s+\-()]{10,}$/.test(phone.trim());

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="drv-title">
      <div className="dialog">
        <h2 id="drv-title">إضافة مندوب</h2>

        <div className="field">
          <label htmlFor="drv-name">الاسم الكامل</label>
          <input
            id="drv-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="drv-phone">رقم الهاتف</label>
          <input
            id="drv-phone"
            type="tel"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="07701234567"
            aria-invalid={phone !== '' && !phoneLooksValid}
          />
          <span className="field__hint">
            رقم عراقي للهاتف المحمول. يستخدمه المندوب لتسجيل الدخول إلى التطبيق برمز تحقّق.
          </span>
        </div>

        <div className="field">
          <label htmlFor="drv-vehicle">نوع المركبة</label>
          <select
            id="drv-vehicle"
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
          <label htmlFor="drv-plate">رقم اللوحة (اختياري)</label>
          <input
            id="drv-plate"
            dir="ltr"
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="drv-note">ملاحظة داخلية (اختياري)</label>
          <input id="drv-note" value={note} onChange={(event) => setNote(event.target.value)} />
          <span className="field__hint">لا تظهر للمندوب ولا للعميل.</span>
        </div>

        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={canCollectCash}
            onChange={(event) => setCanCollectCash(event.target.checked)}
          />
          مسموح له بتحصيل النقد من العملاء
        </label>

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّرت إضافة المندوب'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={fullName.trim().length < 3 || !phoneLooksValid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الحفظ…' : 'إضافة'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Issuing a courier their sign-in.
 *
 * Two states and no third: pick a username, then read the password out. It is
 * shown exactly once because that is the only way it is stored — a hash — and
 * a screen that pretends otherwise teaches people to close it and come back
 * later for a thing that no longer exists.
 *
 * Re-running this for a driver who already has one is a reset, deliberately.
 * A courier who has forgotten their password needs a way back in that does not
 * involve anybody reading a database.
 */
function CredentialsDialog({
  auth,
  driver,
  onClose,
}: {
  auth: PortalAuth;
  driver: PortalDriver;
  onClose: () => void;
}) {
  /*
   * Seeded from the phone number, which is the one identifier the restaurant
   * and the courier already share — and typing a username into a form is the
   * step at which somebody invents `driver1`.
   */
  const [username, setUsername] = useState(() => suggestUsername(driver.phone));
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = useMutation({
    mutationFn: () => portal.issueDriverCredentials(auth, driver.id, username.trim()),
    onSuccess: (result) => setIssued({ username: result.username, password: result.password }),
  });

  const copy = async (): Promise<void> => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(
        [
          'جيبلي — دخول المندوبين',
          `اسم المستخدم: ${issued.username}`,
          `كلمة المرور: ${issued.password}`,
        ].join('\n'),
      );
      setCopied(true);
    } catch {
      // No clipboard permission. The values are on screen either way.
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="cred-title">
      <div className="dialog">
        <h2 id="cred-title">بيانات دخول {driver.full_name ?? 'المندوب'}</h2>

        {issued ? (
          <>
            <p className="alert-bar alert-bar--warning" role="status">
              تظهر كلمة المرور مرة واحدة فقط. سلّمها للمندوب الآن — لا يمكن عرضها لاحقاً، لكن
              يمكنك إصدار غيرها في أي وقت.
            </p>

            <div className="field">
              <label htmlFor="cred-user">اسم المستخدم</label>
              <input id="cred-user" dir="ltr" readOnly value={issued.username} />
            </div>

            <div className="field">
              <label htmlFor="cred-pass">كلمة المرور</label>
              <input id="cred-pass" dir="ltr" readOnly value={issued.password} />
            </div>

            <p className="field__hint">
              يدخل المندوب من <span className="ltr-inline">/driver/login</span> على نفس الرابط.
            </p>

            <div className="dialog__actions">
              <button type="button" className="btn btn--primary" onClick={() => void copy()}>
                {copied ? 'تم النسخ' : 'نسخ البيانات'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                إغلاق
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
              اختر اسم مستخدم للمندوب. تُولَّد كلمة المرور تلقائياً وتُعرض مرة واحدة.
            </p>

            <div className="field">
              <label htmlFor="cred-username">اسم المستخدم</label>
              <input
                id="cred-username"
                dir="ltr"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <span className="field__hint">
                أحرف إنجليزية صغيرة وأرقام و . _ - فقط، ثلاثة أحرف فأكثر.
              </span>
            </div>

            {issue.isError ? (
              <p className="alert-bar alert-bar--danger" role="alert">
                {issue.error instanceof ApiError
                  ? ((issue.error.details as { messageHint?: string } | undefined)?.messageHint ??
                    issue.error.messageAr)
                  : 'تعذّر إصدار البيانات'}
              </p>
            ) : null}

            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={issue.isPending || username.trim().length < 3}
                onClick={() => issue.mutate()}
              >
                {issue.isPending ? 'جارٍ الإصدار…' : 'إصدار بيانات الدخول'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                إلغاء
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** `+9647701234567` becomes `d7701234567` — unique, typable, and not a name. */
function suggestUsername(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits ? `d${digits}` : '';
}

function EditDriverDialog({
  auth,
  driver,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  driver: PortalDriver;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [canCollectCash, setCanCollectCash] = useState(driver.can_collect_cash);
  const [note, setNote] = useState(driver.internal_note ?? '');

  const save = useMutation({
    mutationFn: () =>
      portal.updateDriver(auth, driver.id, {
        can_collect_cash: canCollectCash,
        internal_note: note.trim() || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="edt-title">
      <div className="dialog">
        <h2 id="edt-title">تعديل {driver.full_name ?? 'المندوب'}</h2>

        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={canCollectCash}
            onChange={(event) => setCanCollectCash(event.target.checked)}
          />
          <span>
            مسموح له بتحصيل النقد من العملاء
            {driver.cash_custody_iqd > 0 && !canCollectCash ? (
              <span className="field__hint" style={{ display: 'block' }}>
                لديه عهدة {money(driver.cash_custody_iqd)} — المنع يسري على الطلبات الجديدة ولا
                يلغي عهدته الحالية.
              </span>
            ) : null}
          </span>
        </label>

        <div className="field">
          <label htmlFor="edt-note">ملاحظة داخلية</label>
          <input id="edt-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        {save.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {save.error instanceof ApiError ? save.error.messageAr : 'تعذّر الحفظ'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'جاري الحفظ…' : 'حفظ'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
