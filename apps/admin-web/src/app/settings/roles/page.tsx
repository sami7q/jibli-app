'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLATFORM_ROLE_LABELS, RESTAURANT_ROLE_LABELS } from '@jibli/ui-web';
import type { PlatformRole, RestaurantRole } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
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

  const members = staff.data ?? [];
  const mfaGap = members.filter((member) => member.mfa_required && !member.mfa_enabled);

  return (
    <AdminShell
      title="الأدوار والصلاحيات"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
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

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}
