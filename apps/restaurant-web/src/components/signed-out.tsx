'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ERROR_MESSAGES_AR } from '@jibli/contracts';

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
export function SignedOut({ reason }: { reason?: string }) {
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

  return (
    <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>
        {noMembership ? 'حسابك غير مرتبط بأي مطعم' : 'جاري تحويلك إلى تسجيل الدخول…'}
      </h1>
      <p>
        {noMembership
          ? 'تواصل مع مالك المطعم ليضيفك إلى فريق العمل، ثم أعد تحميل الصفحة.'
          : 'انتهت الجلسة. أعد تسجيل الدخول للمتابعة.'}
      </p>
      {reason && !noMembership ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {ERROR_MESSAGES_AR[reason as keyof typeof ERROR_MESSAGES_AR] ?? reason}
        </p>
      ) : null}
      {noMembership ? (
        <a className="btn btn--ghost" href="/login">
          تسجيل الدخول بحساب آخر
        </a>
      ) : null}
    </div>
  );
}
