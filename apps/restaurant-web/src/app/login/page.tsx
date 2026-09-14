'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  JibliLogo,
  quickLoginSupported,
  recallCredentials,
  rememberCredentials,
  safeReturnPath,
} from '@jibli/ui-web';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * Restaurant Portal sign-in (plan §77, §88).
 *
 * Password first, then a TOTP code when the account has MFA enrolled. The
 * server decides whether to ask for the second factor; this page never assumes,
 * because assuming would leak which accounts have MFA.
 *
 * No token is stored here. The refresh token arrives as an HttpOnly cookie the
 * page cannot read, and the access token lives in memory inside `useSession`,
 * which re-derives it on load.
 */
export default function RestaurantLoginPage() {
  return <LoginForm />;
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

/** What the browser shows beside the saved password in its own list. */
const NOTE_DISPLAY_NAME = 'بوابة مطاعم جيبلي';

function LoginForm() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [stage, setStage] = useState<'CREDENTIALS' | 'MFA'>('CREDENTIALS');
  const [revealPassword, setRevealPassword] = useState(false);
  /*
   * «تذكرني», on by default because that is what the portal did before the box
   * existed — ticking nothing must not silently shorten anybody's session.
   * Untick it and the refresh cookie loses its `maxAge`, so the browser drops
   * it on exit: the case this is for is the till in the kitchen that three
   * people use.
   */
  const [rememberMe, setRememberMe] = useState(true);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);

  const [quickLoginReady, setQuickLoginReady] = useState(false);

  const mfaInput = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameInput.current?.focus();
  }, []);

  /*
   * Offer the password the browser already holds for this origin.
   *
   * `silent` means "fill it only if you can do so without interrupting" — one
   * saved account, and silent access not withdrawn. It stops at filling the
   * fields: signing in on its own would spend one of ten rate-limited attempts
   * on a stale password every time this page loaded.
   */
  useEffect(() => {
    if (!quickLoginSupported()) return;
    setQuickLoginReady(true);

    void recallCredentials('silent').then((saved) => {
      if (!saved) return;
      setUsername(saved.username);
      setPassword(saved.password);
    });
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

  /**
   * One sign-in attempt against an explicit pair.
   *
   * Takes the credentials rather than reading them from state so the quick
   * sign-in can use what the browser just handed back: a `setState` in the same
   * tick has not landed yet, and submitting the old state would post an empty
   * password.
   */
  const attempt = async (credentials: { username: string; password: string }) => {
    if (submitting || lockedFor > 0) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await apiRequest<{
        mfa_required: boolean;
        must_change_password?: boolean;
        mfa_enrolment_required?: boolean;
        portal?: 'ADMIN' | 'RESTAURANT';
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          username: credentials.username.trim(),
          password: credentials.password,
          remember_me: rememberMe,
          ...(stage === 'MFA' ? { mfa_code: mfaCode.trim() } : {}),
        },
      });

      if (response.mfa_required) {
        setStage('MFA');
        setFailures(0);
        return;
      }

      // A platform account signing in here lands on a portal it has no
      // restaurant membership for, so say that rather than show an empty shell.
      if (response.portal === 'ADMIN') {
        setError('هذا الحساب تابع لفريق المنصة. استخدم لوحة الإدارة.');
        return;
      }

      /*
       * `next` is attacker-controllable, so it is reduced to a same-origin path
       * before use — an open redirect on a sign-in page is a phishing
       * primitive, because the link really does start on this domain.
       *
       * Read from the live URL rather than useSearchParams: that hook forces
       * the page into a Suspense boundary, so Next serves a loading
       * placeholder instead of the form on the one screen every session
       * starts at.
       */
      const destination = safeReturnPath(
        new URLSearchParams(window.location.search).get('next'),
      );

      /*
       * A password someone else issued is a password someone else knows, so
       * that has to be replaced before anything else — including before the
       * page they were originally heading for.
       */
      if (response.must_change_password) {
        // Deliberately not remembered: this password is about to be replaced,
        // and saving it now would leave the browser offering a dead one.
        router.replace(`/change-password?next=${encodeURIComponent(destination)}`);
        return;
      }

      /*
       * The sign-in worked, so this pair is worth keeping. Awaited before
       * navigating because the prompt belongs to this page — leaving first can
       * cancel it, which is exactly the bug this fixes: the form posts with
       * `fetch` and routes client-side, which Chrome does not read as a form
       * submission, so it never offered to save the password by itself.
       */
      await rememberCredentials({
        username: credentials.username.trim(),
        password: credentials.password,
        displayName: NOTE_DISPLAY_NAME,
      });


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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await attempt({ username, password });
  };

  /**
   * Sign in with the saved password, showing the account picker.
   *
   * `optional` rather than `silent`: this is a button someone pressed, so an
   * account chooser is an answer, not an interruption.
   */
  const signInWithSavedPassword = async () => {
    const saved = await recallCredentials('optional');

    if (!saved) {
      setError(
        'لا توجد كلمة مرور محفوظة لهذا الموقع في هذا المتصفح. سجّل الدخول مرة واحدة ووافق على حفظ كلمة المرور، ثم سيعمل هذا الزر.',
      );
      return;
    }

    setUsername(saved.username);
    setPassword(saved.password);
    await attempt(saved);
  };

  const disabled =
    submitting ||
    lockedFor > 0 ||
    (stage === 'CREDENTIALS' ? !username.trim() || !password : mfaCode.trim().length < 6);

  return (
    <LoginFrame>
      <form onSubmit={submit} noValidate>
        <h1>بوابة مطاعم جيبلي</h1>
        <p className="auth__subtitle">
          {stage === 'CREDENTIALS'
            ? 'سجّل الدخول بحساب المطعم'
            : 'أدخل رمز التحقق من تطبيق المصادقة'}
        </p>

        {stage === 'CREDENTIALS' ? (
          <>
            <div className="field">
              <label htmlFor="login-username">اسم المستخدم</label>
              <input
                id="login-username"
                ref={usernameInput}
                type="text"
                dir="ltr"
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                // Lowercased as typed: the server compares case-insensitively,
                // and showing the normalised form avoids "but I typed it right".
                onChange={(event) => setUsername(event.target.value.toLowerCase().trim())}
                placeholder="mataam-baghdad"
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

            <label
              htmlFor="login-remember"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
              }}
            >
              <input
                id="login-remember"
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--jibli-orange-500)' }}
              />
              <span>
                تذكّرني على هذا الجهاز
                <span className="field__hint" style={{ display: 'block' }}>
                  {rememberMe
                    ? 'تبقى الجلسة مفتوحة ولا تحتاج تسجيل الدخول في كل مرة.'
                    : 'ستُغلق الجلسة عند إغلاق المتصفح — الأنسب لجهاز مشترك.'}
                </span>
              </span>
            </label>
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

        {/*
          The shortcut. It carries no password of its own — it asks the browser
          for the one it saved for this origin, which is why it can exist on a
          deployed admin portal at all.
        */}
        {stage === 'CREDENTIALS' && quickLoginReady ? (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            disabled={submitting || lockedFor > 0}
            onClick={() => void signInWithSavedPassword()}
          >
            دخول سريع بكلمة المرور المحفوظة
          </button>
        ) : null}

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

        {/*
          Two different people reach this screen with no account: a member of
          staff, who needs their own owner to add them, and a restaurant that
          has never heard of us. The note above answers the first. Everything
          below answers the second, and it is separated by a rule because it is
          a different journey, not a second sentence about the same one.
        */}
        <div className="auth__apply">
          <span>مطعم جديد ولا تملك حساباً؟</span>
          <Link className="btn btn--outline" href="/apply">
            تقديم طلب انضمام
          </Link>
        </div>
      </form>
    </LoginFrame>
  );
}
