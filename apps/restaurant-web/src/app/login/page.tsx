'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  JibliLogo,
  loginFailureKind,
  quickLoginSupported,
  recallCredentials,
  rememberCredentials,
  safeReturnPath,
  SLOW_REQUEST_HINT_AR,
  SLOW_REQUEST_HINT_MS,
  UNREACHABLE_MESSAGE_AR,
} from '@jibli/ui-web';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * Restaurant Portal sign-in (plan §77, §88).
 *
 * A username and a password, and nothing else. Partner accounts do not use a
 * second factor: nothing in this portal enrols one, and the code step it used
 * to carry could only ever be reached by a platform account that belongs in
 * the admin panel instead — which is what it is now told.
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
const NOTE_DISPLAY_NAME = 'بوابة شركاء جيبلي';

function LoginForm() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
  /**
   * Whether this attempt has been in flight long enough to need explaining.
   *
   * The API sleeps on a free instance. The first sign-in of the morning waits
   * about a minute for it to wake, during which a silent spinner is
   * indistinguishable from a form that has stopped working — and the thing
   * somebody does about a form that has stopped working is press the button
   * again, four times, into a rate limit.
   */
  const [slow, setSlow] = useState(false);

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

    void recallCredentials('silent').then((saved) => {
      if (!saved) return;
      setUsername(saved.username);
      setPassword(saved.password);
    });
  }, []);

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
   * Takes the credentials explicitly rather than reading them from state, so
   * a caller never posts a pair whose `setState` has not landed yet.
   */
  const attempt = async (credentials: { username: string; password: string }) => {
    if (submitting || lockedFor > 0) return;

    setSubmitting(true);
    setError(null);
    setSlow(false);
    const slowHint = setTimeout(() => setSlow(true), SLOW_REQUEST_HINT_MS);

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
        },
      });

      if (response.mfa_required) {
        setError('هذا الحساب محميّ بالتحقق بخطوتين وهو حساب فريق المنصة. استخدم لوحة الإدارة.');
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
      const destination = safeReturnPath(new URLSearchParams(window.location.search).get('next'));

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
      const code = caught instanceof ApiError ? caught.code : undefined;
      const status = caught instanceof ApiError ? caught.status : undefined;

      switch (loginFailureKind(code, status)) {
        case 'RATE_LIMITED':
          setFailures(failures + 1);
          setError('محاولات كثيرة. انتظر قليلاً قبل إعادة المحاولة.');
          setLockedFor(BACKOFF_SECONDS * 2);
          break;

        /*
         * Nothing read the password, so nothing about it was wrong — and the
         * backoff exists to slow down guessing, which this is not. Counting it
         * meant a sleeping API locked the operator out of the form for typing
         * their own password correctly three times.
         */
        case 'UNREACHABLE':
          setError(UNREACHABLE_MESSAGE_AR);
          break;

        default: {
          const next = failures + 1;
          setFailures(next);
          setError(caught instanceof ApiError ? caught.messageAr : 'تعذّر تسجيل الدخول');
          if (next >= BACKOFF_AFTER_ATTEMPTS) setLockedFor(BACKOFF_SECONDS);
        }
      }
    } finally {
      clearTimeout(slowHint);
      setSlow(false);
      setSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await attempt({ username, password });
  };

  const disabled = submitting || lockedFor > 0 || !username.trim() || !password;

  return (
    <LoginFrame>
      <form onSubmit={submit} noValidate>
        <h1>بوابة شركاء جيبلي</h1>
        <p className="auth__subtitle">سجّل الدخول بحساب الشريك</p>

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
            <span
              className="field__hint"
              role="status"
              style={{ color: 'var(--jibli-warning-700)' }}
            >
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
        {error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {error}
          </p>
        ) : null}

        {slow ? (
          <p className="auth__note" role="status">
            {SLOW_REQUEST_HINT_AR}
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
              : 'تسجيل الدخول'}
        </button>

        <p className="auth__note">
          إن لم يكن لديك حساب، اطلب من مالك الحساب إضافتك من صفحة الموظفين.
        </p>

        {/*
          Two different people reach this screen with no account: a member of
          staff, who needs their own owner to add them, and a restaurant that
          has never heard of us. The note above answers the first. Everything
          below answers the second, and it is separated by a rule because it is
          a different journey, not a second sentence about the same one.
        */}
        <div className="auth__apply">
          <span>مطعم أو ماركت جديد ولا تملك حساباً؟</span>
          <Link className="btn btn--outline" href="/apply">
            تقديم طلب انضمام
          </Link>
        </div>
      </form>
    </LoginFrame>
  );
}
