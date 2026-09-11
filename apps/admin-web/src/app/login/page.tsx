'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { JibliLogo, safeReturnPath } from '@jibli/ui-web';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * Admin sign-in (plan §77, §88, §1853).
 *
 * Password first, then a TOTP code when the account has MFA enrolled. The
 * server decides whether to ask for the second factor; this page never assumes,
 * because assuming would leak which accounts have MFA.
 *
 * No token is stored here. The refresh token arrives as an HttpOnly cookie the
 * page cannot read, and the access token lives in memory inside
 * `useAdminSession`, which re-derives it on load.
 */
export default function AdminLoginPage() {
  return (
    // useSearchParams needs a Suspense boundary to keep the route static.
    <Suspense fallback={<LoginFrame><p className="auth__subtitle">جاري التحميل…</p></LoginFrame>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <JibliLogo size={40} tone="onLight" />
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * How long to refuse submitting after repeated failures.
 *
 * The server rate-limits this endpoint to 10 attempts per 5 minutes, which is
 * the control that matters. This is the client half: it makes the delay
 * visible so a person who mistyped twice waits rather than hammering the form
 * into a server-side lockout they cannot see the end of.
 */
const BACKOFF_AFTER_ATTEMPTS = 3;
const BACKOFF_SECONDS = 15;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [stage, setStage] = useState<'CREDENTIALS' | 'MFA'>('CREDENTIALS');
  const [revealPassword, setRevealPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);

  const mfaInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    phoneInput.current?.focus();
  }, []);

  // Move focus to the code field the moment the second stage appears, so a
  // keyboard user is not left hunting for it.
  useEffect(() => {
    if (stage === 'MFA') mfaInput.current?.focus();
  }, [stage]);

  // Count the lockout down visibly rather than silently refusing.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setTimeout(() => setLockedFor((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockedFor]);

  /*
   * Caps Lock is the single most common cause of a "correct" password being
   * rejected, and the field is masked so the user cannot see why. The browser
   * reports the modifier state on any key event.
   */
  const trackCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.('CapsLock') ?? false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || lockedFor > 0) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await apiRequest<{
        mfa_required: boolean;
        portal?: 'ADMIN' | 'RESTAURANT';
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          phone: phone.trim(),
          password,
          ...(stage === 'MFA' ? { mfa_code: mfaCode.trim() } : {}),
        },
      });

      if (response.mfa_required) {
        setStage('MFA');
        setFailures(0);
        return;
      }

      if (response.portal === 'RESTAURANT') {
        setError('هذا الحساب تابع لمطعم وليس لفريق المنصة. استخدم بوابة المطاعم.');
        return;
      }

      /*
       * `next` comes from the URL, so it is attacker-controllable. It is
       * reduced to a same-origin path before use — an open redirect on a login
       * page is a phishing primitive, because the link really does start on
       * this domain.
       */
      const destination = safeReturnPath(searchParams.get('next'));

      // Replace, not push: the login page must not sit in the back stack of an
      // authenticated session.
      router.replace(destination);
    } catch (caught) {
      const next = failures + 1;
      setFailures(next);

      if (caught instanceof ApiError && caught.code === 'RATE_LIMITED') {
        setError('محاولات كثيرة. انتظر قليلاً قبل إعادة المحاولة.');
        setLockedFor(BACKOFF_SECONDS * 2);
      } else {
        setError(caught instanceof ApiError ? caught.messageAr : 'تعذّر تسجيل الدخول');
        if (next >= BACKOFF_AFTER_ATTEMPTS) setLockedFor(BACKOFF_SECONDS);
      }

      // A rejected code returns to the code field, not the password the user
      // has already entered correctly.
      if (stage === 'MFA') setMfaCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled =
    submitting ||
    lockedFor > 0 ||
    (stage === 'CREDENTIALS' ? !phone.trim() || !password : mfaCode.trim().length < 6);

  return (
    <LoginFrame>
      <form onSubmit={submit} noValidate>
        <h1>لوحة إدارة جيبلي</h1>
        <p className="auth__subtitle">
          {stage === 'CREDENTIALS'
            ? 'سجّل الدخول بحسابك في فريق المنصة'
            : 'أدخل رمز التحقق من تطبيق المصادقة'}
        </p>

        {stage === 'CREDENTIALS' ? (
          <>
            <div className="field">
              <label htmlFor="login-phone">رقم الهاتف</label>
              <input
                id="login-phone"
                ref={phoneInput}
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="07701234567"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="login-password">كلمة المرور</label>
              <div className="field__with-action">
                <input
                  id="login-password"
                  type={revealPassword ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyUp={trackCapsLock}
                  onKeyDown={trackCapsLock}
                  required
                />
                {/*
                  Revealing the password reduces lockouts from typos on a long
                  passphrase. It is off by default and never persisted.
                */}
                <button
                  type="button"
                  className="field__action"
                  onClick={() => setRevealPassword((value) => !value)}
                  aria-pressed={revealPassword}
                  aria-label={revealPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {revealPassword ? 'إخفاء' : 'إظهار'}
                </button>
              </div>

              {capsLock ? (
                <span className="field__hint" role="status" style={{ color: 'var(--jibli-warning-700)' }}>
                  تنبيه: مفتاح Caps Lock مُفعّل
                </span>
              ) : null}
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
              // Lets a phone offer the code from its authenticator app.
              autoComplete="one-time-code"
              maxLength={10}
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\s/g, ''))}
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

        {lockedFor > 0 ? (
          <p className="auth__note" role="status">
            يمكنك إعادة المحاولة بعد {lockedFor} ثانية
          </p>
        ) : null}

        <button type="submit" className="btn btn--primary btn--block" disabled={disabled}>
          {submitting
            ? 'جاري التحقق…'
            : lockedFor > 0
              ? `انتظر ${lockedFor} ثانية`
              : stage === 'CREDENTIALS'
                ? 'تسجيل الدخول'
                : 'تأكيد'}
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
          الدخول إلى هذه اللوحة مقصور على فريق جيبلي، وكل إجراء فيها مسجَّل باسمك.
        </p>
      </form>
    </LoginFrame>
  );
}
