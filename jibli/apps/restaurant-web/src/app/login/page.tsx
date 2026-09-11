'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { JibliLogo } from '@jibli/ui-web';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * Restaurant Portal sign-in (plan §77, §88).
 *
 * Password first, then a TOTP code when the account has MFA enrolled — the
 * server decides whether to ask, and this page never assumes.
 *
 * No token is written to storage here. The refresh token arrives as an HttpOnly
 * cookie the page cannot read, and the access token lives in memory inside
 * `useSession`, which re-derives it on load.
 */

interface LoginResponse {
  mfa_required: boolean;
  access_token?: string;
  portal?: 'ADMIN' | 'RESTAURANT';
}

export default function RestaurantLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [stage, setStage] = useState<'CREDENTIALS' | 'MFA'>('CREDENTIALS');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mfaInput = useRef<HTMLInputElement>(null);

  // Move focus to the code field the moment the second stage appears, so a
  // keyboard user is not left hunting for it.
  useEffect(() => {
    if (stage === 'MFA') mfaInput.current?.focus();
  }, [stage]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await apiRequest<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          phone: phone.trim(),
          password,
          ...(stage === 'MFA' ? { mfa_code: mfaCode.trim() } : {}),
        },
      });

      if (response.mfa_required) {
        setStage('MFA');
        return;
      }

      // A platform account signing in here would land on a portal it has no
      // restaurant membership for, so say that rather than show an empty shell.
      if (response.portal === 'ADMIN') {
        setError('هذا الحساب تابع لفريق المنصة. استخدم لوحة الإدارة.');
        return;
      }

      // Replace, not push: the login page must not sit in the back stack of an
      // authenticated session.
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : 'تعذّر تسجيل الدخول');
      // A rejected code returns to the code field rather than the password,
      // which the user has already entered correctly.
      if (stage === 'MFA') setMfaCode('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth">
      <form className="auth__card" onSubmit={submit}>
        <div className="auth__brand">
          <JibliLogo size={40} tone="onLight" />
        </div>

        <h1>بوابة مطاعم جيبلي</h1>
        <p className="auth__subtitle">
          {stage === 'CREDENTIALS'
            ? 'سجّل الدخول بحساب المطعم'
            : 'أدخل رمز التحقق من تطبيق المصادقة'}
        </p>

        {stage === 'CREDENTIALS' ? (
          <>
            <div className="field">
              <label htmlFor="login-phone">رقم الهاتف</label>
              <input
                id="login-phone"
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="username"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="07701234567"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="login-password">كلمة المرور</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="login-mfa">رمز التحقق</label>
            <input
              id="login-mfa"
              ref={mfaInput}
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="123456"
              required
            />
            <span className="field__hint">
              ستة أرقام من تطبيق المصادقة، أو أحد رموز الاسترداد إن فقدت الجهاز.
            </span>
          </div>
        )}

        {error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={submitting || (stage === 'CREDENTIALS' ? !phone || !password : !mfaCode)}
        >
          {submitting ? 'جاري التحقق…' : stage === 'CREDENTIALS' ? 'تسجيل الدخول' : 'تأكيد'}
        </button>

        {stage === 'MFA' ? (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => {
              setStage('CREDENTIALS');
              setMfaCode('');
              setError(null);
            }}
          >
            رجوع
          </button>
        ) : null}

        <p className="auth__note">
          إن لم يكن لديك حساب، اطلب من مالك المطعم إضافتك من صفحة الموظفين.
        </p>
      </form>
    </main>
  );
}
