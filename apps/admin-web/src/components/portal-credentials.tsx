'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESTAURANT_ROLE_LABELS } from '@jibli/ui-web';
import type { RestaurantRole } from '@jibli/contracts';
import { Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type PortalUser } from '@/lib/admin-endpoints';

/**
 * Portal credentials for one restaurant (plan §69, §1854).
 *
 * A restaurant does not sign itself up. Staff create the account here after
 * approving the restaurant, and hand the password over out of band.
 *
 * The generated password appears **once**. It is stored only as an Argon2id
 * hash, so there is no screen anywhere that can show it again — which is why
 * the dialog below makes copying it deliberately hard to skip.
 */
/**
 * Issue a portal account, start to finish.
 *
 * Two dialogs in sequence — the form, then the one and only sighting of the
 * password — kept together because they are one act: an operator who closes
 * the second without copying has to reset, so nothing may come between them.
 *
 * Exported because the restaurants list issues credentials too. A restaurant
 * with no account is the most common reason a newly created one does nothing,
 * and making the operator find the detail screen first is how it gets
 * forgotten.
 */
export function IssuePortalAccess({
  token,
  restaurantId,
  restaurantName,
  onIssued,
  onClose,
}: {
  token: string;
  restaurantId: string;
  restaurantName: string;
  /** Fired when the account exists, so the caller can refresh its own list. */
  onIssued?: () => void;
  onClose: () => void;
}) {
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  if (issued) {
    return <IssuedDialog issued={issued} onClose={onClose} />;
  }

  return (
    <CreateDialog
      token={token}
      restaurantId={restaurantId}
      restaurantName={restaurantName}
      onIssued={(result) => {
        setIssued(result);
        onIssued?.();
      }}
      onCancel={onClose}
    />
  );
}

export function PortalCredentials({
  token,
  restaurantId,
  restaurantName,
  recoveryPhone = null,
  isShop = false,
}: {
  token: string;
  restaurantId: string;
  restaurantName: string;
  /** Where the app sends the code when the owner changes the password; null when nobody has a number. */
  recoveryPhone?: string | null;
  /** A market or a cosmetics shop, whose owner can change the password from the app. */
  isShop?: boolean;
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<PortalUser | null>(null);
  const [toggling, setToggling] = useState<PortalUser | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['portal-users', restaurantId] });

  const portalUsers = useQuery({
    queryKey: ['portal-users', restaurantId],
    queryFn: () => admin.portalUsers(token, restaurantId),
  });

  const resetPassword = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      admin.resetPortalPassword(token, userId, reason),
    onSuccess: (result, variables) => {
      const user = portalUsers.data?.find((entry) => entry.user_id === variables.userId);
      setIssued({ username: user?.username ?? '', password: result.password });
      setResetting(null);
      invalidate();
    },
  });

  const setActive = useMutation({
    mutationFn: ({
      userId,
      isActive,
      reason,
    }: {
      userId: string;
      isActive: boolean;
      reason: string;
    }) => admin.setPortalUserActive(token, userId, isActive, reason),
    onSuccess: () => {
      setToggling(null);
      invalidate();
    },
  });

  return (
    <Card
      title="بيانات دخول بوابة المطاعم"
      icon="roles"
      subtitle="اسم المستخدم وكلمة المرور التي يدخل بها المطعم"
      actions={
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => setCreating(true)}
        >
          إنشاء حساب دخول
        </button>
      }
    >
      {portalUsers.isError ? (
        <ErrorState
          message={
            portalUsers.error instanceof ApiError
              ? portalUsers.error.messageAr
              : 'تعذّر تحميل حسابات الدخول'
          }
          onRetry={() => void portalUsers.refetch()}
        />
      ) : null}

      {portalUsers.isLoading ? <Skeleton height={160} /> : null}

      {/*
        The owner can replace a password from the app after a code reaches
        the number on file. Showing the number here is what lets support
        answer "the code never came" — and the warning is what stops a shop
        being issued an account nobody can ever recover.
      */}
      {isShop && (portalUsers.data?.length ?? 0) > 0 ? (
        recoveryPhone ? (
          <p className="alert-bar alert-bar--info" style={{ marginBlockEnd: 'var(--space-3)' }}>
            <Icon name="roles" className="nav__icon" aria-hidden />
            <span style={{ flex: 1 }}>
              يستطيع صاحب المتجر تغيير كلمة المرور من التطبيق بعد رمز تحقق يصل إلى{' '}
              <strong className="ltr-inline">{recoveryPhone}</strong> (رقم المالك المسجّل).
            </span>
          </p>
        ) : (
          <p className="alert-bar alert-bar--warning" style={{ marginBlockEnd: 'var(--space-3)' }}>
            <Icon name="alert" className="nav__icon" aria-hidden />
            <span style={{ flex: 1 }}>
              لا رقم هاتف للمالك ولا للمتجر، فلن يستطيع صاحب المتجر تغيير كلمة المرور من التطبيق.
              أضف هاتف المتجر من إعداداته في التطبيق، أو أعد تعيين كلمة المرور من هنا عند الحاجة.
            </span>
          </p>
        )
      ) : null}

      {portalUsers.data ? (
        portalUsers.data.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لا يوجد حساب دخول لهذا المطعم</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              أنشئ حساباً ليتمكن المطعم من استقبال الطلبات وإدارة المنيو.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">اسم المستخدم</th>
                  <th scope="col">الاسم</th>
                  <th scope="col">الصلاحية</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">آخر دخول</th>
                  <th scope="col">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {portalUsers.data.map((user) => (
                  <tr key={user.user_id} style={{ opacity: user.is_active ? 1 : 0.55 }}>
                    <td>
                      <strong className="ltr-inline">{user.username}</strong>
                    </td>
                    <td>{user.full_name ?? '—'}</td>
                    <td>{RESTAURANT_ROLE_LABELS[user.role as RestaurantRole] ?? user.role}</td>
                    <td>
                      <StatusBadges user={user} />
                    </td>
                    <td>
                      {user.last_login_at ? (
                        <span className="ltr-inline">
                          {new Date(user.last_login_at).toLocaleDateString('ar-IQ', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>لم يدخل بعد</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setResetting(user)}
                        >
                          إعادة تعيين كلمة المرور
                        </button>
                        <button
                          type="button"
                          className={`btn btn--${user.is_active ? 'danger' : 'ghost'} btn--sm`}
                          onClick={() => setToggling(user)}
                        >
                          {user.is_active ? 'إيقاف الدخول' : 'إعادة التفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {creating ? (
        <CreateDialog
          token={token}
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          onIssued={(result) => {
            setIssued(result);
            setCreating(false);
            invalidate();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {resetting ? (
        <ConfirmDialog
          title={`إعادة تعيين كلمة مرور ${resetting.username}`}
          confirmLabel="إنشاء كلمة مرور جديدة"
          requireReason
          isSubmitting={resetPassword.isPending}
          error={resetPassword.error instanceof ApiError ? resetPassword.error.messageAr : null}
          body={
            <div style={{ color: 'var(--text-secondary)' }}>
              <p style={{ marginBlockStart: 0 }}>
                تُلغى كلمة المرور الحالية فوراً وتُنهى كل الجلسات المفتوحة، وسيُطلب من المطعم تغيير
                الكلمة الجديدة عند أول دخول.
              </p>
              <p style={{ marginBlockEnd: 0 }}>ستظهر كلمة المرور الجديدة مرة واحدة فقط.</p>
            </div>
          }
          onConfirm={(reason) => resetPassword.mutate({ userId: resetting.user_id, reason })}
          onCancel={() => setResetting(null)}
        />
      ) : null}

      {toggling ? (
        <ConfirmDialog
          title={`${toggling.is_active ? 'إيقاف' : 'إعادة تفعيل'} دخول ${toggling.username}`}
          confirmLabel={toggling.is_active ? 'إيقاف الدخول' : 'إعادة التفعيل'}
          requireReason
          isSubmitting={setActive.isPending}
          error={setActive.error instanceof ApiError ? setActive.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {toggling.is_active
                ? 'تُنهى الجلسات المفتوحة فوراً ولن يتمكن المطعم من الدخول. الطلبات الجارية لا تتأثر.'
                : 'يعود الحساب للعمل بكلمة المرور نفسها.'}
            </p>
          }
          onConfirm={(reason) =>
            setActive.mutate({
              userId: toggling.user_id,
              isActive: !toggling.is_active,
              reason,
            })
          }
          onCancel={() => setToggling(null)}
        />
      ) : null}

      {issued ? <IssuedDialog issued={issued} onClose={() => setIssued(null)} /> : null}
    </Card>
  );
}

function StatusBadges({ user }: { user: PortalUser }) {
  const locked = user.locked_until !== null && new Date(user.locked_until) > new Date();

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      <span className={`badge badge--${user.is_active ? 'success' : 'neutral'}`}>
        {user.is_active ? 'فعّال' : 'موقوف'}
      </span>
      {/* Surfaced so support sees why a sign-in fails without guessing. */}
      {locked ? <span className="badge badge--danger">مقفل مؤقتاً</span> : null}
      {user.must_change_password ? (
        <span className="badge badge--warning">لم يغيّر كلمة المرور</span>
      ) : null}
      {user.mfa_enabled ? <span className="badge badge--success">تحقق ثنائي</span> : null}
    </div>
  );
}

function CreateDialog({
  token,
  restaurantId,
  restaurantName,
  onIssued,
  onCancel,
}: {
  token: string;
  restaurantId: string;
  restaurantName: string;
  onIssued: (result: { username: string; password: string }) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'OWNER' | 'MANAGER'>('OWNER');

  // A suggestion, so the operator is not inventing a naming scheme per
  // restaurant. Already checked for collisions server-side.
  useQuery({
    queryKey: ['suggest-username', restaurantId],
    queryFn: async () => {
      const result = await admin.suggestUsername(token, restaurantId);
      setUsername((current) => current || result.username);
      return result;
    },
  });

  const create = useMutation({
    mutationFn: () =>
      admin.createPortalUser(token, restaurantId, {
        username,
        full_name: fullName.trim(),
        role,
      }),
    onSuccess: (result) => onIssued({ username: result.username, password: result.password }),
  });

  const usernameValid = /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username);

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="pu-title">
      <div className="dialog">
        <h2 id="pu-title">إنشاء حساب دخول — {restaurantName}</h2>

        <div className="field">
          <label htmlFor="pu-username">اسم المستخدم</label>
          <input
            id="pu-username"
            dir="ltr"
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase().trim())}
            aria-invalid={username !== '' && !usernameValid}
          />
          <span className="field__hint">
            أحرف إنجليزية صغيرة وأرقام و . _ - فقط. هذا ما سيكتبه المطعم عند الدخول.
          </span>
          {username !== '' && !usernameValid ? (
            <span className="field__error">
              صيغة غير صالحة — من ٣ إلى ٣٢ حرفاً، تبدأ بحرف أو رقم
            </span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="pu-name">اسم المسؤول</label>
          <input
            id="pu-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="اسم المالك أو المدير"
          />
        </div>

        <div className="field">
          <label htmlFor="pu-role">الصلاحية</label>
          <select
            id="pu-role"
            value={role}
            onChange={(event) => setRole(event.target.value as 'OWNER' | 'MANAGER')}
          >
            <option value="OWNER">مالك — كل الصلاحيات بما فيها المالية والموظفون</option>
            <option value="MANAGER">مدير — بدون إضافة مالك</option>
          </select>
        </div>

        <p className="alert-bar alert-bar--warning">
          <span style={{ flex: 1 }}>
            ستُولَّد كلمة مرور قوية تلقائياً وتظهر <strong>مرة واحدة فقط</strong>. لا تُحفظ في أي
            مكان بصيغة قابلة للقراءة، ولا يمكن استرجاعها لاحقاً — فقط إعادة تعيينها.
          </span>
        </p>

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر إنشاء الحساب'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!usernameValid || fullName.trim().length < 3 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الإنشاء…' : 'إنشاء'}
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
 * The one and only sighting of the password.
 *
 * Dismissing requires an explicit confirmation that it has been saved, because
 * closing this by accident means a reset — there is no second chance to read
 * it.
 */
function IssuedDialog({
  issued,
  onClose,
}: {
  issued: { username: string; password: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `اسم المستخدم: ${issued.username}\nكلمة المرور: ${issued.password}`,
      );
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the value is on screen to read.
      setCopied(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="issued-title">
      <div className="dialog">
        <h2 id="issued-title">بيانات الدخول — انسخها الآن</h2>

        <p className="alert-bar alert-bar--danger">
          <Icon name="alert" className="nav__icon" aria-hidden />
          <span style={{ flex: 1 }}>
            لن تظهر كلمة المرور مرة أخرى. إن أُغلقت هذه النافذة قبل نسخها فالحل الوحيد هو إعادة
            التعيين.
          </span>
        </p>

        <div className="figure">
          <span className="figure__label">اسم المستخدم</span>
          <span className="figure__value ltr-inline" style={{ userSelect: 'all' }}>
            {issued.username}
          </span>
        </div>

        <div className="figure">
          <span className="figure__label">كلمة المرور</span>
          <span
            className="figure__value ltr-inline"
            style={{
              userSelect: 'all',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-base)',
            }}
          >
            {issued.password}
          </span>
        </div>

        <button type="button" className="btn btn--ghost btn--block" onClick={() => void copy()}>
          {copied ? '✓ نُسخت' : 'نسخ اسم المستخدم وكلمة المرور'}
        </button>

        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          سلّمها للمطعم بقناة موثوقة. سيُطلب منه تغييرها فور أول دخول.
        </p>

        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          حفظت بيانات الدخول وسلّمتها للمطعم
        </label>

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!acknowledged}
            onClick={onClose}
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
