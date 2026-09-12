'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { JibliLogo, safeReturnPath } from '@jibli/ui-web';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * Change your own password.
 *
 * Reached two ways: voluntarily from the account menu, and compulsorily after
 * signing in with a password that staff issued. The second case is the reason
 * this screen exists — a credential someone else chose is a credential someone
 * else knows, and it stays that way until it is replaced.
 *
 * The server enforces the policy; this page mirrors it live so the requirements
 * are visible while typing rather than delivered as a rejection afterwards.
 */

// Platform staff are held to 14 (plan §1853); a restaurant owner to the
// standard minimum. The server is the authority either way.
const MIN_LENGTH = 12;

interface Requirement {
  readonly label: string;
  readonly met: (value: string, username: string) => boolean;
}

/*
 * Shown as a checklist, not as a strength bar. A bar reports a score nobody can
 * act on; a checklist says exactly what is missing.
 */
const REQUIREMENTS: readonly Requirement[] = [
  { label: `${MIN_LENGTH} حرفاً على الأقل`, met: (v) => v.length >= MIN_LENGTH },
  {
    label: 'تحتوي على أحرف',
    met: (v) => /[a-z]/i.test(v) || /[؀-ۿ]/.test(v),
  },
  { label: 'تحتوي على رقم', met: (v) => /\d/.test(v) },
  { label: 'ليست متكررة أو متسلسلة', met: (v) => new Set(v).size >= 5 },
  {
    label: 'لا تحتوي على اسم المستخدم',
    met: (v, username) =>
      username.length < 3 || !v.toLowerCase().includes(username.toLowerCase()),
  },
];

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [username, setUsername] = useState('');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const currentInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    currentInput.current?.focus();
  }, []);

  /*
   * Both calls on this page need a bearer token, and this page is reached by a
   * redirect that carries none: the access token lives in memory in the portal
   * shell, and a full navigation throws that away. The HttpOnly refresh cookie
   * is what survives, so it is exchanged for a token here.
   *
   * Without this the page was unusable in a way nothing surfaced: the username
   * lookup 401'd and was swallowed, silently disabling the "password must not
   * contain your username" rule, and the submit 401'd with "please sign in" on
   * the one screen a new account cannot get past. Every portal account, admin
   * and restaurant alike, is forced here on first sign-in.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const refreshed = await apiRequest<{ access_token: string }>(
          '/api/v1/auth/session/refresh',
          { method: 'POST' },
        );
        if (cancelled) return;
        setAccessToken(refreshed.access_token);

        // Only used to check the new password does not contain it.
        const me = await apiRequest<{ username: string | null }>('/api/v1/auth/portal/me', {
          accessToken: refreshed.access_token,
        });
        if (!cancelled) setUsername(me.username ?? '');
      } catch {
        if (!cancelled) setAccessToken(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const trackCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.('CapsLock') ?? false);
  };

  const unmet = REQUIREMENTS.filter((requirement) => !requirement.met(next, username));
  const mismatch = confirm.length > 0 && next !== confirm;
  const disabled =
    submitting || !accessToken || !current || unmet.length > 0 || mismatch || !confirm;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;

    setSubmitting(true);
    setError(null);
    setProblems([]);

    try {
      await apiRequest('/api/v1/auth/password', {
        method: 'POST',
        body: { current_password: current, new_password: next },
        ...(accessToken ? { accessToken } : {}),
      });

      /*
       * The server rotated the session, so the cookie this browser holds is
       * the new one. A full navigation re-runs the session hook against it
       * rather than reusing the access token from before the change.
       */
      const target = safeReturnPath(new URLSearchParams(window.location.search).get('next'));
      router.replace(target);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.messageAr);
        const detail = caught.details as { messages_ar?: string[] } | undefined;
        if (Array.isArray(detail?.messages_ar)) setProblems(detail.messages_ar);
      } else {
        setError('تعذّر تغيير كلمة المرور');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <JibliLogo size={40} tone="onLight" />
        </div>

        <form onSubmit={submit} noValidate>
          <h1>تغيير كلمة المرور</h1>
          <p className="auth__subtitle">
            اختر كلمة مرور جديدة يعرفها أنت وحدك. ستُنهى كل الجلسات الأخرى المفتوحة.
          </p>

          <div className="field">
            <label htmlFor="cp-current">كلمة المرور الحالية</label>
            <input
              id="cp-current"
              ref={currentInput}
              type={reveal ? 'text' : 'password'}
              dir="ltr"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              onKeyUp={trackCapsLock}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="cp-new">كلمة المرور الجديدة</label>
            <div className="field__with-action">
              <input
                id="cp-new"
                type={reveal ? 'text' : 'password'}
                dir="ltr"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                onKeyUp={trackCapsLock}
                required
              />
              <button
                type="button"
                className="field__action"
                onClick={() => setReveal((value) => !value)}
                aria-pressed={reveal}
                aria-label={reveal ? 'إخفاء كلمات المرور' : 'إظهار كلمات المرور'}
              >
                {reveal ? 'إخفاء' : 'إظهار'}
              </button>
            </div>

            {capsLock ? (
              <span className="field__hint" role="status" style={{ color: 'var(--jibli-warning-700)' }}>
                تنبيه: مفتاح Caps Lock مُفعّل
              </span>
            ) : null}
          </div>

          {/*
            A checklist, not a strength meter. "Weak" tells someone nothing they
            can act on; a missing line tells them exactly what to add.
          */}
          <ul className="requirements" aria-live="polite">
            {REQUIREMENTS.map((requirement) => {
              const met = requirement.met(next, username);
              return (
                <li key={requirement.label} className={met ? 'is-met' : undefined}>
                  <span aria-hidden>{met ? '✓' : '○'}</span>
                  <span>{requirement.label}</span>
                  <span className="sr-only">{met ? ' — مستوفى' : ' — غير مستوفى'}</span>
                </li>
              );
            })}
          </ul>

          <div className="field">
            <label htmlFor="cp-confirm">تأكيد كلمة المرور الجديدة</label>
            <input
              id="cp-confirm"
              type={reveal ? 'text' : 'password'}
              dir="ltr"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={mismatch}
              required
            />
            {mismatch ? (
              <span className="field__error">كلمتا المرور غير متطابقتين</span>
            ) : null}
          </div>

          {error ? (
            <p className="alert-bar alert-bar--danger" role="alert">
              {error}
              {problems.length > 0 ? (
                <span style={{ display: 'block', marginBlockStart: 4 }}>
                  {problems.join(' · ')}
                </span>
              ) : null}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary btn--block" disabled={disabled}>
            {submitting ? 'جاري الحفظ…' : 'حفظ كلمة المرور'}
          </button>
        </form>
      </div>
    </main>
  );
}
