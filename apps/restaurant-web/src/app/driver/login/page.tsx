'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { JibliLogo } from '@jibli/ui-web';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * The courier's sign-in.
 *
 * A username and a password the restaurant issued, not an OTP. The phone a
 * delivery runs on is often a shared handset — the code goes to whoever is
 * holding it — and a restaurant that has just hired somebody should be able to
 * hand over a login in person rather than wait on an SMS gateway.
 *
 * Deliberately its own page rather than a mode on the staff form. A courier
 * standing in a kitchen doorway needs the fewest possible decisions on screen,
 * and «هل أنت مطعم أم مندوب؟» is a decision.
 */
export default function DriverLoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const usernameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameInput.current?.focus();
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await apiRequest<{ portal?: 'ADMIN' | 'RESTAURANT' | 'DRIVER' }>(
        '/api/v1/auth/login',
        {
          method: 'POST',
          body: {
            username: username.trim(),
            password,
            // A delivery phone is the driver's own and stays signed in: being
            // asked to type a password at the door of every customer is how a
            // password ends up on a sticker on the back of the handset.
            remember_me: true,
          },
        },
      );

      /*
       * A restaurant account that wandered in here is sent where it belongs
       * rather than shown an empty deliveries list — the session is valid, the
       * door is just the wrong one.
       */
      if (response.portal && response.portal !== 'DRIVER') {
        router.replace('/');
        return;
      }

      router.replace('/driver');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : 'تعذّر تسجيل الدخول، حاول مرة أخرى');
      setSubmitting(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <JibliLogo size={40} tone="onLight" />
        </div>

        <h1 style={{ fontSize: 'var(--text-xl)' }}>دخول المندوبين</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          اسم المستخدم وكلمة المرور من المطعم الذي تعمل معه.
        </p>

        <form
          onSubmit={(event) => void submit(event)}
          style={{ display: 'grid', gap: 'var(--space-4)' }}
        >
          <div className="field">
            <label htmlFor="driver-username">اسم المستخدم</label>
            <input
              id="driver-username"
              ref={usernameInput}
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="driver-password">كلمة المرور</label>
            <div className="field__with-action">
              <input
                id="driver-password"
                type={reveal ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              {/*
                A reveal, because this password was read off somebody else's
                screen and typed on a phone keyboard in the sun.
              */}
              <button
                type="button"
                className="btn btn--ghost"
                aria-pressed={reveal}
                aria-label={reveal ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                onClick={() => setReveal((value) => !value)}
              >
                {reveal ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          </div>

          {error ? (
            <p className="alert-bar alert-bar--danger" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
            {submitting ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </form>

        <p className="auth__note">
          نسيت بياناتك؟ اطلب من المطعم إصدارها من جديد — تُنشأ من صفحة «السائقون» عنده.
        </p>
      </div>
    </main>
  );
}
