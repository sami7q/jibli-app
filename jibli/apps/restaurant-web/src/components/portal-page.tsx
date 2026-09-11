'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { RestaurantPermission } from '@jibli/contracts';
import { ERROR_MESSAGES_AR } from '@jibli/contracts';
import { Shell } from './shell';
import { ForbiddenState, Skeleton } from './ui';
import { useSession } from '@/hooks/use-session';

/**
 * The states every portal page shares (plan §112, §131).
 *
 * Loading, signed-out, and role-denied are handled once here so no page invents
 * its own version. The permission gate only decides what to *render* — every
 * endpoint behind it checks the same permission server-side, so hiding a screen
 * is a courtesy, not the security boundary (plan §86).
 */

export interface PortalAuth {
  readonly accessToken: string;
  readonly restaurantId: string;
}

export interface PortalContext {
  readonly auth: PortalAuth;
  readonly can: (permission: RestaurantPermission) => boolean;
  readonly restaurantName: string;
  readonly userName: string;
}

export function PortalPage({
  permission,
  permissionLabelAr,
  children,
}: {
  /** Render the page only when the session holds this permission. */
  permission?: RestaurantPermission;
  permissionLabelAr?: string;
  children: (context: PortalContext) => ReactNode;
}) {
  const session = useSession();

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <Skeleton height={520} />
      </div>
    );
  }

  if (session.status === 'unauthenticated') {
    return <SignedOut reason={session.reason} />;
  }

  const denied = permission !== undefined && !session.can(permission);

  return (
    <Shell
      restaurantName={session.restaurantName}
      partnerCode={session.partnerCode}
      userName={session.userName}
    >
      {denied ? (
        <ForbiddenState requiredAr={permissionLabelAr ?? permission} />
      ) : (
        children({
          auth: { accessToken: session.accessToken, restaurantId: session.restaurantId },
          can: session.can,
          restaurantName: session.restaurantName,
          userName: session.userName,
        })
      )}
    </Shell>
  );
}

function SignedOut({ reason }: { reason?: string }) {
  const router = useRouter();

  // A user with no membership is signed in correctly but has nowhere to land;
  // telling them that beats showing an empty dashboard or a login loop.
  const noMembership = reason === 'NO_RESTAURANT_MEMBERSHIP';

  /*
   * Anything else means there is no usable session, so send them to sign in.
   * Redirecting a no-membership user would loop: they would log in
   * successfully and arrive back here with the same reason.
   */
  useEffect(() => {
    if (!noMembership) router.replace('/login');
  }, [noMembership, router]);

  return (
    <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>
        {noMembership ? 'حسابك غير مرتبط بأي مطعم' : 'الرجاء تسجيل الدخول'}
      </h1>
      <p>
        {noMembership
          ? 'تواصل مع مالك المطعم ليضيفك إلى فريق العمل، ثم أعد تحميل الصفحة.'
          : 'انتهت الجلسة أو لم تسجّل الدخول بعد.'}
      </p>
      {reason && !noMembership ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {ERROR_MESSAGES_AR[reason as keyof typeof ERROR_MESSAGES_AR] ?? reason}
        </p>
      ) : null}
    </div>
  );
}
