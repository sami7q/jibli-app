'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLATFORM_ROLE_LABELS, RESTAURANT_ROLE_LABELS } from '@jibli/ui-web';
import { PLATFORM_ROLES, type PlatformRole, type RestaurantRole } from '@jibli/contracts';
import { AdminShell, ForbiddenShell } from '@/components/shell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  MfaChallenge,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type StaffMember } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Roles and permissions (plan §85, §86, §87, §88).
 *
 * The matrix is read-only by design: roles are defined in source, reviewed and
 * deployed. A role whose permissions can be edited at runtime is a role whose
 * security properties nobody can reason about, and plan §85's "default is deny"
 * only holds if the matrix is reviewable in a diff.
 *
 * What *is* editable here is who holds which role.
 */
export default function RolesPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [changing, setChanging] = useState<{
    member: StaffMember;
    role: PlatformRole;
    granted: boolean;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const staff = useQuery({
    queryKey: ['admin-staff'],
    queryFn: () => admin.staff(token),
    enabled: session.status === 'authenticated',
  });

  const matrix = useQuery({
    queryKey: ['admin-role-matrix'],
    queryFn: () => admin.roleMatrix(token),
    enabled: session.status === 'authenticated',
  });

  const setRole = useMutation({
    mutationFn: (params: { user_id: string; role: string; granted: boolean; reason: string }) =>
      admin.setRole(token, params),
    onSuccess: () => {
      setChanging(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) setNeedsMfa(true);
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }
  if (!session.can('roles.read')) {
    return <ForbiddenShell session={session} requiredAr="قراءة الأدوار" />;
  }

  const canManage = session.can('roles.manage');
  const members = staff.data ?? [];
  const mfaGap = members.filter((member) => member.mfa_required && !member.mfa_enabled);

  return (
    <AdminShell
      title="الأدوار والصلاحيات"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        canManage ? (
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            إضافة موظف
          </button>
        ) : null
      }
    >
      {/*
        Plan §88 makes MFA mandatory for these roles before production launch.
        Listing the gap here turns an abstract requirement into a task list.
      */}
      {mfaGap.length > 0 ? (
        <div className="alert-bar alert-bar--danger" role="alert">
          <Icon name="alert" className="nav__icon" aria-hidden />
          <span>
            {mfaGap.length} من الموظفين يحملون أدواراً تتطلب التحقق بخطوتين ولم يفعّلوه بعد:{' '}
            {mfaGap.map((member) => member.full_name ?? member.user_id).join('، ')}. هذا يمنع
            الإطلاق للإنتاج.
          </span>
          <Link className="btn btn--danger btn--sm" href="/settings/mfa">
            تفعيل الآن
          </Link>
        </div>
      ) : null}

      <Card title="فريق المنصة" icon="users">
        {staff.isError ? (
          <ErrorState
            message={staff.error instanceof ApiError ? staff.error.messageAr : 'تعذّر تحميل الفريق'}
            onRetry={() => void staff.refetch()}
          />
        ) : staff.isLoading ? (
          <Skeleton height={240} />
        ) : (
          <DataTable<StaffMember>
            caption="موظفو المنصة وأدوارهم"
            rows={members}
            keyOf={(row) => row.user_id}
            emptyMessage="لا يوجد موظفون"
            columns={[
              { key: 'name', header: 'الاسم', render: (row) => row.full_name ?? '—' },
              {
                key: 'phone',
                header: 'الهاتف',
                render: (row) => <span className="ltr-inline">{row.phone}</span>,
              },
              {
                key: 'roles',
                header: 'الأدوار',
                render: (row) => (
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {row.roles.map((role) => (
                      <Badge key={role} tone="neutral">
                        {PLATFORM_ROLE_LABELS[role as PlatformRole] ?? role}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              {
                key: 'mfa',
                header: 'التحقق بخطوتين',
                render: (row) =>
                  row.mfa_enabled ? (
                    <Badge tone="success">مفعّل</Badge>
                  ) : row.mfa_required ? (
                    <Badge tone="danger">مطلوب وغير مفعّل</Badge>
                  ) : (
                    <Badge tone="neutral">اختياري</Badge>
                  ),
              },
              {
                key: 'status',
                header: 'الحساب',
                render: (row) => (
                  <Badge tone={row.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {row.status === 'ACTIVE' ? 'نشط' : 'موقوف'}
                  </Badge>
                ),
              },
              // Grant / revoke, only for a role that may manage roles. The
              // dialog (below) was dead code — nothing ever opened it (ADMIN-7).
              ...(canManage
                ? [
                    {
                      key: 'actions',
                      header: 'إدارة الأدوار',
                      render: (row: StaffMember) => (
                        <StaffRoleControls
                          member={row}
                          onChange={(role, granted) => setChanging({ member: row, role, granted })}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Card>

      <Card title="مصفوفة صلاحيات المنصة" icon="roles" subtitle={matrix.data?.note_ar}>
        {matrix.isLoading ? (
          <Skeleton height={280} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {(matrix.data?.platform_roles ?? []).map((role) => (
              <details
                key={role.role}
                style={{
                  background: 'var(--surface-sunken)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3) var(--space-4)',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                  {PLATFORM_ROLE_LABELS[role.role as PlatformRole] ?? role.role}
                  <span
                    style={{
                      marginInlineStart: 8,
                      fontWeight: 400,
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {role.permission_count} صلاحية
                  </span>
                  {role.mfa_mandatory ? (
                    <span style={{ marginInlineStart: 8 }}>
                      <Badge tone="warning">يتطلب تحققاً بخطوتين</Badge>
                    </span>
                  ) : null}
                </summary>
                <ul
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 4,
                    marginTop: 'var(--space-3)',
                    paddingInlineStart: 'var(--space-5)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {role.permissions.map((permission) => (
                    <li key={permission} className="ltr-inline">
                      {permission}
                      {matrix.data?.reauthentication_required.includes(permission) ? (
                        <span style={{ color: 'var(--jibli-warning-700)' }}> 🔒</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </Card>

      <Card title="مصفوفة صلاحيات المطاعم" icon="restaurants">
        {matrix.isLoading ? (
          <Skeleton height={200} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {(matrix.data?.restaurant_roles ?? []).map((role) => (
              <details
                key={role.role}
                style={{
                  background: 'var(--surface-sunken)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3) var(--space-4)',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                  {RESTAURANT_ROLE_LABELS[role.role as RestaurantRole] ?? role.role}
                  <span
                    style={{
                      marginInlineStart: 8,
                      fontWeight: 400,
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {role.permission_count} صلاحية
                  </span>
                </summary>
                <ul
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 4,
                    marginTop: 'var(--space-3)',
                    paddingInlineStart: 'var(--space-5)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {role.permissions.map((permission) => (
                    <li key={permission} className="ltr-inline">
                      {permission}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </Card>

      {changing ? (
        <ConfirmDialog
          title={
            changing.granted
              ? `منح دور ${PLATFORM_ROLE_LABELS[changing.role]}`
              : `سحب دور ${PLATFORM_ROLE_LABELS[changing.role]}`
          }
          confirmLabel={changing.granted ? 'منح الدور' : 'سحب الدور'}
          tone={changing.granted ? 'primary' : 'danger'}
          requireReason
          isSubmitting={setRole.isPending}
          error={setRole.error instanceof ApiError ? setRole.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              تُنهى جلسات المستخدم فوراً بعد التغيير، فتسري الصلاحيات الجديدة عند تسجيل الدخول
              التالي مباشرة.
            </p>
          }
          onConfirm={(reason) =>
            setRole.mutate({
              user_id: changing.member.user_id,
              role: changing.role,
              granted: changing.granted,
              reason,
            })
          }
          onCancel={() => setChanging(null)}
        />
      ) : null}

      {adding ? (
        <AddStaffDialog
          token={token}
          onNeedsMfa={() => setNeedsMfa(true)}
          onDone={() => {
            setAdding(false);
            void queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}

/**
 * Grant or revoke each platform role for one staff row (ADMIN-7).
 *
 * A chip per held role carries «سحب»; a picker of the roles not yet held feeds
 * «منح». Both only set the parent's `changing`, so the reason + step-up still
 * run through the shared ConfirmDialog.
 */
function StaffRoleControls({
  member,
  onChange,
}: {
  member: StaffMember;
  onChange: (role: PlatformRole, granted: boolean) => void;
}) {
  const held = new Set(member.roles);
  const grantable = PLATFORM_ROLES.filter((role) => !held.has(role));
  const [toGrant, setToGrant] = useState<PlatformRole | ''>('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {member.roles.map((role) => (
          <button
            key={role}
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => onChange(role as PlatformRole, false)}
          >
            سحب {PLATFORM_ROLE_LABELS[role as PlatformRole] ?? role}
          </button>
        ))}
      </div>
      {grantable.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            aria-label="اختر دوراً للمنح"
            value={toGrant}
            onChange={(event) => setToGrant(event.target.value as PlatformRole | '')}
          >
            <option value="">— اختر دوراً —</option>
            {grantable.map((role) => (
              <option key={role} value={role}>
                {PLATFORM_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={toGrant === ''}
            onClick={() => {
              if (toGrant !== '') onChange(toGrant, true);
            }}
          >
            منح
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Create a platform staff login (ADMIN-7).
 *
 * There was no way to make one — staff had to be bootstrapped by a CLI. The
 * server returns a one-time password; it is shown once here, with an explicit
 * acknowledge, and never again. Requires step-up: a 401 opens the MFA dialog
 * and the operator submits again.
 */
function AddStaffDialog({
  token,
  onNeedsMfa,
  onDone,
  onCancel,
}: {
  token: string;
  onNeedsMfa: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<PlatformRole>('SUPPORT_AGENT');
  const [issued, setIssued] = useState<{ username: string; password: string; note: string } | null>(
    null,
  );

  const create = useMutation({
    mutationFn: () =>
      admin.createStaff(token, { username: username.trim(), full_name: fullName.trim(), role }),
    onSuccess: (result) => {
      setIssued({ username: result.username, password: result.password, note: result.note_ar });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) onNeedsMfa();
    },
  });

  const canSave = username.trim().length >= 3 && fullName.trim().length >= 3 && !create.isPending;

  // Once the password has been shown, the dialog becomes a one-time reveal the
  // operator must copy before dismissing — it is never retrievable again.
  if (issued) {
    return (
      <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="staff-done">
        <div className="dialog">
          <h2 id="staff-done">تم إنشاء الحساب</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{issued.note}</p>
          <div className="field">
            <label htmlFor="staff-username-out">اسم المستخدم</label>
            <input id="staff-username-out" readOnly dir="ltr" value={issued.username} />
          </div>
          <div className="field">
            <label htmlFor="staff-password-out">كلمة المرور لمرة واحدة</label>
            <input
              id="staff-password-out"
              readOnly
              dir="ltr"
              value={issued.password}
              style={{ fontFamily: 'monospace', letterSpacing: 1 }}
            />
            <span className="field__hint">
              انسخها الآن وسلّمها للموظف بأمان — لن تظهر مرة أخرى، وسيغيّرها عند أول دخول.
            </span>
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={onDone}>
              تم، أغلق
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="staff-title">
      <div className="dialog">
        <h2 id="staff-title">إضافة موظف منصة</h2>

        <div className="field">
          <label htmlFor="staff-username">اسم المستخدم</label>
          <input
            id="staff-username"
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase().trim())}
            placeholder="a.kadhim"
            maxLength={40}
          />
          <span className="field__hint">يسجّل الموظف الدخول بهذا الاسم، لا برقم هاتف.</span>
        </div>

        <div className="field">
          <label htmlFor="staff-name">الاسم الكامل</label>
          <input
            id="staff-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="أحمد كاظم"
            maxLength={80}
          />
        </div>

        <div className="field">
          <label htmlFor="staff-role">الدور</label>
          <select
            id="staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value as PlatformRole)}
          >
            {PLATFORM_ROLES.map((value) => (
              <option key={value} value={value}>
                {PLATFORM_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        {create.error && !(create.error instanceof ApiError && create.error.needsReauth) ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر إنشاء الحساب'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSave}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الإنشاء…' : 'إنشاء الحساب'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
