'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateTimeAr } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * MFA enrolment (plan §88).
 *
 * "MFA is mandatory for Super Admin and Finance Admin before production
 * launch." This screen is what makes that requirement satisfiable — the
 * step-up check has existed since the auth package, but without enrolment no
 * admin could ever pass it.
 *
 * Enrolment is two-phase on purpose: the secret stays pending until a code
 * proves the authenticator holds it. A one-phase flow lets someone scan a QR
 * that silently failed and lock themselves out.
 */
export default function MfaPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [enrolment, setEnrolment] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const status = useQuery({
    queryKey: ['mfa-status'],
    queryFn: () => admin.mfaStatus(token),
    enabled: session.status === 'authenticated',
  });

  const enroll = useMutation({
    mutationFn: () => admin.mfaEnroll(token),
    onSuccess: (result) => setEnrolment({ secret: result.secret, uri: result.otpauth_uri }),
  });

  const confirm = useMutation({
    mutationFn: () => admin.mfaConfirm(token, code),
    onSuccess: (result) => {
      setRecoveryCodes(result.recovery_codes);
      setEnrolment(null);
      setCode('');
      void queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const mfa = status.data;

  return (
    <AdminShell
      title="التحقق بخطوتين"
      subtitle="حماية إضافية للعمليات الحساسة على المنصة"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      {status.isLoading ? (
        <Skeleton height={200} />
      ) : status.isError ? (
        <ErrorState
          message={status.error instanceof ApiError ? status.error.messageAr : 'تعذّر تحميل الحالة'}
          onRetry={() => void status.refetch()}
        />
      ) : (
        <>
          {/*
            The launch blocker, made visible to the person who can clear it.
          */}
          {mfa?.required && !mfa.enabled ? (
            <div className="alert-bar alert-bar--danger" role="alert">
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span>
                دورك يتطلب التحقق بخطوتين. لن تتمكن من تنفيذ العمليات المالية الحساسة أو تعديل
                الأدوار قبل التفعيل.
              </span>
            </div>
          ) : null}

          <Card title="الحالة" icon="roles">
            <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>الحالة</div>
                <Badge tone={mfa?.enabled ? 'success' : 'danger'}>
                  {mfa?.enabled ? 'مفعّل' : 'غير مفعّل'}
                </Badge>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                  مطلوب لدورك
                </div>
                <Badge tone={mfa?.required ? 'warning' : 'neutral'}>
                  {mfa?.required ? 'نعم' : 'اختياري'}
                </Badge>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                  رموز الاسترداد المتبقية
                </div>
                <strong className="numeric">{mfa?.recovery_codes_remaining ?? 0}</strong>
              </div>
              {mfa?.enabled_at ? (
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                    تاريخ التفعيل
                  </div>
                  <strong>{dateTimeAr(mfa.enabled_at)}</strong>
                </div>
              ) : null}
            </div>
          </Card>
        </>
      )}

      {/* ── Recovery codes, shown exactly once ──────────────────────────── */}
      {recoveryCodes ? (
        <Card title="رموز الاسترداد" icon="roles">
          <div className="alert-bar alert-bar--warning">
            <Icon name="alert" className="nav__icon" aria-hidden />
            <span>
              احفظ هذه الرموز في مكان آمن الآن. <strong>لن تظهر مرة أخرى</strong>، وهي وسيلتك
              الوحيدة للدخول إذا فقدت هاتفك.
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 'var(--space-2)',
              margin: 'var(--space-4) 0',
            }}
          >
            {recoveryCodes.map((recoveryCode) => (
              <code
                key={recoveryCode}
                className="ltr-inline"
                style={{
                  padding: 'var(--space-3)',
                  background: 'var(--surface-sunken)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                {recoveryCode}
              </code>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => void navigator.clipboard.writeText(recoveryCodes.join('\n'))}
            >
              نسخ الرموز
            </button>
            <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              حفظتُ الرموز في مكان آمن
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!acknowledged}
              onClick={() => setRecoveryCodes(null)}
            >
              تم
            </button>
          </div>
        </Card>
      ) : null}

      {/* ── Enrolment ──────────────────────────────────────────────────── */}
      {!mfa?.enabled && !recoveryCodes ? (
        <Card title="تفعيل التحقق بخطوتين" icon="roles">
          {!enrolment ? (
            <>
              <ol style={{ lineHeight: 2, paddingInlineStart: 'var(--space-5)' }}>
                <li>ثبّت تطبيق مصادقة مثل Google Authenticator أو Microsoft Authenticator.</li>
                <li>اضغط «بدء التفعيل» للحصول على المفتاح.</li>
                <li>أدخل المفتاح في التطبيق، ثم أدخل الرمز المكوّن من 6 أرقام للتأكيد.</li>
              </ol>
              <button
                type="button"
                className="btn btn--primary"
                disabled={enroll.isPending}
                onClick={() => enroll.mutate()}
              >
                {enroll.isPending ? 'جاري التحضير…' : 'بدء التفعيل'}
              </button>
              {enroll.error ? (
                <p className="alert-bar alert-bar--danger" role="alert">
                  {enroll.error instanceof ApiError ? enroll.error.messageAr : 'تعذّر بدء التفعيل'}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="mfa-secret">المفتاح السري</label>
                <input
                  id="mfa-secret"
                  readOnly
                  value={enrolment.secret}
                  className="ltr-inline"
                  style={{ fontFamily: 'var(--font-mono)', letterSpacing: 2 }}
                />
                <span className="field__hint">
                  أدخل هذا المفتاح يدوياً في تطبيق المصادقة، أو امسح رمز QR إن كان متاحاً.
                </span>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => void navigator.clipboard.writeText(enrolment.secret)}
                >
                  نسخ المفتاح
                </button>
              </div>

              <div className="field">
                <label htmlFor="mfa-confirm-code">رمز التأكيد (6 أرقام)</label>
                <input
                  id="mfa-confirm-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  style={{ textAlign: 'center', letterSpacing: 8, fontSize: 'var(--text-xl)' }}
                />
                <span className="field__hint">
                  لا يُفعَّل التحقق بخطوتين حتى يُقبل هذا الرمز — هذا يضمن أن التطبيق يعمل فعلاً.
                </span>
              </div>

              {confirm.error ? (
                <p className="alert-bar alert-bar--danger" role="alert">
                  {confirm.error instanceof ApiError ? confirm.error.messageAr : 'رمز غير صحيح'}
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={code.length !== 6 || confirm.isPending}
                  onClick={() => confirm.mutate()}
                >
                  {confirm.isPending ? 'جاري التأكيد…' : 'تأكيد وتفعيل'}
                </button>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => {
                    setEnrolment(null);
                    setCode('');
                  }}
                >
                  إلغاء
                </button>
              </div>
            </>
          )}
        </Card>
      ) : null}
    </AdminShell>
  );
}
