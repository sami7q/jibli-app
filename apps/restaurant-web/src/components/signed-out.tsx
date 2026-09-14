'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ERROR_MESSAGES_AR } from '@jibli/contracts';
import { apiRequest } from '@/lib/api';

/**
 * What a page shows when the session turns out to be unusable.
 *
 * The edge middleware already sends a visitor with no cookie to the sign-in
 * form, so this covers the case it structurally cannot: a cookie that is
 * present but rejected — expired, rotated, revoked, or belonging to an account
 * whose platform roles were removed. That is only discoverable by calling the
 * API, which happens here on the client.
 *
 * It redirects rather than explains. A page that can only tell someone they are
 * signed out, with no way forward, is the dead end this replaces.
 */
export function SignedOut({ reason, account }: { reason?: string; account?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  // No membership is a different situation: signing in again changes nothing,
  // because the account belongs to no restaurant. Redirecting would loop.
  const noMembership = reason === 'NO_RESTAURANT_MEMBERSHIP';

  useEffect(() => {
    if (noMembership) return;
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [noMembership, pathname, router]);

  if (noMembership) return <NoMembership account={account} />;

  return (
    <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>جاري تحويلك إلى تسجيل الدخول…</h1>
      <p>انتهت الجلسة. أعد تسجيل الدخول للمتابعة.</p>
      {reason ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {ERROR_MESSAGES_AR[reason as keyof typeof ERROR_MESSAGES_AR] ?? reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Signed in, and a member of nothing.
 *
 * The screen this replaces said «تواصل مع مالك المطعم» and offered one link,
 * to sign in as somebody else — which is advice, not a way out, and it did not
 * even say whose account the reader was looking at. Somebody with two logins
 * could not tell from this page which one had failed.
 *
 * Three things now, in the order they are useful: whose session this is, the
 * two ways an account gains a restaurant, and a sign-out that actually ends
 * the session rather than a link that leaves the cookie in place.
 */
function NoMembership({ account }: { account?: string }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await apiRequest('/api/v1/auth/session/logout', { method: 'POST' });
    } catch {
      // The cookie may already be spent. Either way the destination is the
      // same, and refusing to move would strand the person here.
    }
    router.replace('/login');
  };

  return (
    <div
      className="empty"
      style={{ minHeight: '100vh', justifyContent: 'center', gap: 'var(--space-4)' }}
    >
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>حسابك غير مرتبط بأي مطعم</h1>

      {account ? (
        <p>
          أنت مسجّل الدخول باسم <strong>{account}</strong>، وهذا الحساب ليس عضواً في أي مطعم
          حتى الآن — لذلك لا توجد لوحة يعرضها هذا الحساب.
        </p>
      ) : (
        <p>هذا الحساب ليس عضواً في أي مطعم حتى الآن، لذلك لا توجد لوحة يعرضها.</p>
      )}

      <div
        style={{
          textAlign: 'start',
          maxWidth: 460,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        <p style={{ fontWeight: 700 }}>هناك طريقان للوصول:</p>
        <p>
          <strong>لديك مطعم مسجّل؟</strong> اطلب من المالك إضافتك من «الموظفون» في لوحته. تُضاف
          برقم هاتفك، ويحدّد لك دوراً — كاشير أو مدير أو غيره — وتظهر اللوحة فور إضافتك.
        </p>
        <p>
          <strong>مطعمك غير مسجّل بعد؟</strong> قدّم طلب انضمام، وبعد الموافقة تُنشأ لك بيانات
          دخول المالك.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <a className="btn btn--primary" href="/apply">
          تقديم طلب انضمام مطعم
        </a>
        <button type="button" className="btn btn--ghost" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'جارٍ الخروج…' : 'تسجيل الخروج والدخول بحساب آخر'}
        </button>
      </div>
    </div>
  );
}
