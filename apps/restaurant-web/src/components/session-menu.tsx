'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { forgetQuickLogin } from '@jibli/ui-web';
import { apiRequest } from '@/lib/api';
import { Icon } from './icon';

/**
 * The signed-in user chip, and the way out.
 *
 * Two things live here that a portal handling money should not be missing:
 *
 *   - **Sign out.** Without it the only way to end a session is to wait for the
 *     refresh token to expire, which on a shared restaurant tablet means the
 *     next person inherits it.
 *   - **Idle sign-out.** An admin session left open on an unattended screen is
 *     the realistic threat here, not a stolen password (plan §80).
 */

/** Inactivity before the session is ended, and how long the warning shows. */
// Longer than Admin's: a restaurant tablet sits idle between orders during a
// quiet hour, and signing the kitchen out mid-service would be worse than the
// risk it avoids.
const IDLE_LIMIT_MS = 45 * 60 * 1000;
const WARNING_MS = 60 * 1000;

export function SessionMenu({ userName, userRoleAr }: { userName: string; userRoleAr: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/api/v1/auth/session/logout', { method: 'POST' });
    } catch {
      // The cookie is cleared server-side on a best-effort basis. Even if that
      // call fails the user must still land on the sign-in page rather than be
      // left looking signed in.
    }

    /*
     * Signing out says "I am done here". A saved password that fills itself in
     * silently on the next load quietly undoes that, which matters most on the
     * shared tablet this sign-out button exists for. The password stays in the
     * browser; it just stops being offered without asking.
     */
    await forgetQuickLogin();

    router.replace('/login');
  }, [router]);

  /*
   * Idle timer.
   *
   * Reset by real interaction only. A `setInterval` somewhere on the page must
   * not count as activity, or the timer never fires on exactly the dashboard
   * that polls itself.
   */
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>;
    let warningTimer: ReturnType<typeof setTimeout>;
    let countdown: ReturnType<typeof setInterval> | null = null;

    const clearAll = () => {
      clearTimeout(idleTimer);
      clearTimeout(warningTimer);
      if (countdown) clearInterval(countdown);
      countdown = null;
    };

    const arm = () => {
      clearAll();
      setSecondsLeft(null);

      warningTimer = setTimeout(() => {
        let remaining = Math.floor(WARNING_MS / 1000);
        setSecondsLeft(remaining);
        countdown = setInterval(() => {
          remaining -= 1;
          setSecondsLeft(remaining > 0 ? remaining : 0);
        }, 1000);
      }, IDLE_LIMIT_MS - WARNING_MS);

      idleTimer = setTimeout(() => void signOut(), IDLE_LIMIT_MS);
    };

    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const event of events) window.addEventListener(event, arm, { passive: true });
    arm();

    return () => {
      clearAll();
      for (const event of events) window.removeEventListener(event, arm);
    };
  }, [signOut]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      {secondsLeft !== null ? (
        <div className="idle-warning" role="alertdialog" aria-labelledby="idle-title">
          <div className="dialog" style={{ maxWidth: 420 }}>
            <h2 id="idle-title">سيتم تسجيل خروجك تلقائياً</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              لم يُسجَّل أي نشاط منذ فترة. لحماية الحساب سيُغلق خلال {secondsLeft} ثانية.
            </p>
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  // Any click already resets the timer via the listener; this
                  // just dismisses the dialog immediately.
                  setSecondsLeft(null);
                }}
              >
                متابعة العمل
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
                تسجيل الخروج الآن
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="topbar__control" ref={container} style={{ position: 'relative' }}>
        <button
          type="button"
          className="session-trigger"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="session-avatar" aria-hidden>
            {userName.slice(0, 1)}
          </span>
          <span className="session-identity">
            <strong>{userName}</strong>
            <span>{userRoleAr}</span>
          </span>
          <Icon name="chevron" className="nav__icon" aria-hidden />
        </button>

        {open ? (
          <div className="menu" role="menu" aria-label="حساب المستخدم">
            <a className="menu__item" role="menuitem" href="/settings">
              <Icon name="settings" className="nav__icon" aria-hidden />
              <span style={{ flex: 1 }}>الإعدادات</span>
            </a>
            <button
              type="button"
              role="menuitem"
              className="menu__item menu__item--danger"
              onClick={() => void signOut()}
            >
              <Icon name="close" className="nav__icon" aria-hidden />
              <span style={{ flex: 1 }}>تسجيل الخروج</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
