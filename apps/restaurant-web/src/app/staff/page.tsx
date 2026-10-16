'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESTAURANT_ROLES, type RestaurantRole } from '@jibli/contracts';
import { iraqiPhoneSchema } from '@jibli/validation';
import { RESTAURANT_ROLE_LABELS } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type StaffMember } from '@/lib/portal-endpoints';
import { useSession } from '@/hooks/use-session';

/**
 * Staff and roles (plan §61, §86, §98).
 *
 * Two rules the server enforces and this screen makes visible rather than
 * letting people discover through an error:
 *
 *   - Only an OWNER may create another OWNER. A Manager who could do it would
 *     be one click from full financial access.
 *   - A restaurant can never be left without an active owner, or nobody could
 *     manage staff or finance again.
 */

/** What each role can actually do, in the words a restaurant owner uses. */
const ROLE_SUMMARIES: Record<RestaurantRole, string> = {
  OWNER: 'كل الصلاحيات، بما فيها المالية وإدارة الموظفين وإضافة مالك آخر.',
  MANAGER: 'إدارة الطلبات والمنيو والمخزون والمندوبين والأرباح — بدون إضافة مالك.',
  CASHIER: 'قبول الطلبات وتغيير حالتها وتعيين المندوبين. لا يرى التكاليف ولا الأرباح.',
  KITCHEN: 'متابعة الطلبات وتحضيرها فقط. لا يرى أي بيانات مالية.',
  INVENTORY_MANAGER: 'إدارة المخزون والتوريد والإتلاف، وقراءة تكاليف المواد.',
  ACCOUNTANT: 'قراءة الأرباح والمصاريف وكشوف العمولة. لا يغيّر حالة الطلبات.',
};

export default function StaffPage() {
  return (
    <PortalPage permission="staff.read" permissionLabelAr="قراءة بيانات الموظفين">
      {({ auth, can }) => <StaffScreen auth={auth} canManage={can('staff.manage')} />}
    </PortalPage>
  );
}

function StaffScreen({ auth, canManage }: { auth: PortalAuth; canManage: boolean }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<{ member: StaffMember; activate: boolean } | null>(null);

  // Only an OWNER may mint another OWNER; hiding the option keeps the person
  // from composing a request the server will refuse.
  const isOwner = session.status === 'authenticated' && session.roles.includes('OWNER');
  const currentUserId = session.status === 'authenticated' ? session.userId : null;

  const staff = useQuery({
    queryKey: ['staff', auth.restaurantId],
    queryFn: () => portal.staff(auth),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive, reason }: { id: string; isActive: boolean; reason?: string }) =>
      portal.updateStaff(auth, id, { is_active: isActive, reason }),
    onSuccess: () => {
      setChanging(null);
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });

  if (staff.isError) {
    return (
      <ErrorState
        message={staff.error instanceof ApiError ? staff.error.messageAr : 'تعذّر تحميل الموظفين'}
        code={staff.error instanceof ApiError ? staff.error.code : undefined}
        onRetry={() => void staff.refetch()}
      />
    );
  }

  if (staff.isLoading) return <Skeleton height={400} />;

  const members = staff.data ?? [];
  const activeOwners = members.filter(
    (member) => member.role === 'OWNER' && member.is_active,
  ).length;

  return (
    <>
      <Card
        title="الموظفون"
        icon="staff"
        subtitle="من يستطيع الدخول إلى لوحة المطعم وما يملكه من صلاحيات"
        actions={
          canManage ? (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              إضافة موظف
            </button>
          ) : null
        }
      >
        <div className="split">
          <div className="figure">
            <span className="figure__label">موظفون فعّالون</span>
            <span className="figure__value">
              {members.filter((member) => member.is_active).length}
            </span>
          </div>
          <div className="figure">
            <span className="figure__label">مالكون فعّالون</span>
            <span className="figure__value">{activeOwners}</span>
          </div>
        </div>

        {activeOwners === 1 ? (
          <p
            className="alert-bar alert-bar--warning"
            style={{ marginBlockStart: 'var(--space-4)' }}
          >
            <span style={{ flex: 1 }}>
              يوجد مالك واحد فعّال فقط. لا يمكن إيقافه — إضافة مالك ثانٍ تحمي الحساب إذا تعذّر
              الوصول إلى الأول.
            </span>
          </p>
        ) : null}
      </Card>

      <Card title="قائمة الموظفين">
        {members.length === 0 ? (
          <p className="empty">لا يوجد موظفون مسجّلون</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">الموظف</th>
                  <th scope="col">الصلاحية</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">تاريخ الإضافة</th>
                  {canManage ? <th scope="col">إجراءات</th> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.user_id === currentUserId;
                  const isLastOwner =
                    member.role === 'OWNER' && member.is_active && activeOwners === 1;

                  return (
                    <tr key={member.id} style={{ opacity: member.is_active ? 1 : 0.55 }}>
                      <td>
                        <strong>{member.full_name ?? 'بانتظار أول تسجيل دخول'}</strong>
                        {isSelf ? (
                          <span className="badge badge--neutral" style={{ marginInlineStart: 6 }}>
                            أنت
                          </span>
                        ) : null}
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          <span className="ltr-inline">{member.phone}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge--neutral">
                          {RESTAURANT_ROLE_LABELS[member.role as RestaurantRole] ?? member.role}
                        </span>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          {ROLE_SUMMARIES[member.role as RestaurantRole] ?? ''}
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge--${member.is_active ? 'ready' : 'neutral'}`}>
                          {member.is_active ? 'فعّال' : 'موقوف'}
                        </span>
                      </td>
                      <td>
                        <span className="ltr-inline">
                          {new Date(member.created_at).toLocaleDateString('ar-IQ', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </td>
                      {canManage ? (
                        <td>
                          {member.is_active ? (
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              disabled={isLastOwner || isSelf}
                              title={
                                isLastOwner
                                  ? 'لا يمكن إيقاف المالك الوحيد الفعّال'
                                  : isSelf
                                    ? 'لا يمكنك إيقاف حسابك بنفسك'
                                    : undefined
                              }
                              onClick={() => setChanging({ member, activate: false })}
                            >
                              إيقاف
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={setActive.isPending}
                              onClick={() => setActive.mutate({ id: member.id, isActive: true })}
                            >
                              إعادة تفعيل
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {setActive.error ? (
          <ErrorState
            message={
              setActive.error instanceof ApiError
                ? setActive.error.messageAr
                : 'تعذّر تغيير حالة الموظف'
            }
          />
        ) : null}
      </Card>

      <Card title="ما تعنيه كل صلاحية" subtitle="اختر الأقل صلاحية التي تكفي عمل الموظف">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">الصلاحية</th>
                <th scope="col">ما تشمله</th>
              </tr>
            </thead>
            <tbody>
              {RESTAURANT_ROLES.map((role) => (
                <tr key={role}>
                  <td>
                    <strong>{RESTAURANT_ROLE_LABELS[role]}</strong>
                  </td>
                  <td>{ROLE_SUMMARIES[role]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {adding ? (
        <StaffDialog
          auth={auth}
          canCreateOwner={isOwner}
          onDone={() => {
            setAdding(false);
            void queryClient.invalidateQueries({ queryKey: ['staff'] });
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {changing && !changing.activate ? (
        <ConfirmDialog
          title={`إيقاف ${changing.member.full_name ?? 'الموظف'}`}
          confirmLabel="إيقاف الموظف"
          requireReason
          isSubmitting={setActive.isPending}
          error={setActive.error instanceof ApiError ? setActive.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              تنتهي جلساته فوراً ولن يتمكّن من الدخول إلى اللوحة. يبقى سجل ما قام به كما هو.
            </p>
          }
          onConfirm={(reason) =>
            setActive.mutate({ id: changing.member.id, isActive: false, reason })
          }
          onCancel={() => setChanging(null)}
        />
      ) : null}
    </>
  );
}

function StaffDialog({
  auth,
  canCreateOwner,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  canCreateOwner: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<RestaurantRole>('CASHIER');
  /**
   * How the new staffer signs in, shown after they are added (MERCH-16).
   *
   * The dialog used to close silently, leaving the owner with no idea how the
   * person they just added gets in — and the portal has no phone/OTP sign-in,
   * so the server's «يسجّل الموظف الدخول برقم هاتفه» note was both unshown and
   * untrue for a restaurant. We show an explicit instruction instead.
   */
  const [added, setAdded] = useState<{ phone: string; note: string } | null>(null);
  const guard = useRef(false);

  const create = useMutation({
    mutationFn: () =>
      portal.createStaff(auth, {
        full_name: fullName.trim(),
        phone: phoneParsed.success ? phoneParsed.data : phone.trim(),
        role,
      }),
    onSuccess: (result) => {
      guard.current = false;
      setAdded({
        phone: phoneParsed.success ? phoneParsed.data : phone.trim(),
        note: result.note_ar,
      });
    },
    onError: () => {
      guard.current = false;
    },
  });

  const assignableRoles = canCreateOwner
    ? RESTAURANT_ROLES
    : RESTAURANT_ROLES.filter((value) => value !== 'OWNER');

  // Normalise Arabic-Indic digits and validate the Iraqi rule client-side
  // (MERCH-12): «٠٧٧...» is accepted, «abc» is told why.
  const phoneParsed = iraqiPhoneSchema.safeParse(phone.trim());
  const phoneLooksValid = phoneParsed.success;

  const submit = (): void => {
    if (guard.current) return;
    guard.current = true;
    create.mutate();
  };

  // After adding: the owner needs to know exactly how this person gets in.
  if (added) {
    return (
      <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="stf-title">
        <div className="dialog">
          <h2 id="stf-title">أُضيف {fullName.trim()}</h2>

          <p className="alert-bar alert-bar--success" role="status">
            <span style={{ flex: 1 }}>
              تمت إضافة الموظف بصلاحية {RESTAURANT_ROLE_LABELS[role]}.
            </span>
          </p>

          <div className="field">
            <label>كيف يسجّل الموظف الدخول؟</label>
            <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              بوابة الشركاء تحتاج اسم مستخدم وكلمة مرور لكل موظف. تُصدِرها إدارة جيبلي لرقم الموظف{' '}
              <span className="ltr-inline">{added.phone}</span> وتُسلَّم له؛ تواصل مع الدعم لإصدارها
              إن لم تصل. بعدها يدخل من صفحة تسجيل الدخول نفسها التي تستخدمها.
            </p>
          </div>

          <p className="field__hint">ملاحظة النظام: {added.note}</p>

          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={onDone}>
              تم
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="stf-title">
      <div className="dialog">
        <h2 id="stf-title">إضافة موظف</h2>

        <div className="field">
          <label htmlFor="stf-name">الاسم الكامل</label>
          <input
            id="stf-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="stf-phone">رقم الهاتف</label>
          <input
            id="stf-phone"
            type="tel"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="07701234567"
            aria-invalid={phone !== '' && !phoneLooksValid}
          />
          {phone !== '' && !phoneLooksValid ? (
            <span className="field__error">رقم هاتف عراقي غير صالح</span>
          ) : (
            <span className="field__hint">
              إن كان الرقم مسجّلاً في جيبلي سابقاً فسيُربط بالحساب نفسه، ولن يُنشأ حساب جديد.
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="stf-role">الصلاحية</label>
          <select
            id="stf-role"
            value={role}
            onChange={(event) => setRole(event.target.value as RestaurantRole)}
          >
            {assignableRoles.map((value) => (
              <option key={value} value={value}>
                {RESTAURANT_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="field__hint">{ROLE_SUMMARIES[role]}</span>
        </div>

        {!canCreateOwner ? (
          <p className="alert-bar alert-bar--warning">
            <span style={{ flex: 1 }}>
              إضافة مالك جديد متاحة للمالك فقط. اطلب من المالك القيام بذلك إن لزم.
            </span>
          </p>
        ) : null}

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّرت إضافة الموظف'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={fullName.trim().length < 3 || !phoneLooksValid || create.isPending}
            onClick={submit}
          >
            {create.isPending ? 'جاري الحفظ…' : 'إضافة'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
