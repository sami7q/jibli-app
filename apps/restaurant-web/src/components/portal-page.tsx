'use client';

import type { ReactNode } from 'react';
import type { RestaurantPermission } from '@jibli/contracts';
import { Shell } from './shell';
import { ForbiddenState, Skeleton } from './ui';
import { SignedOut } from './signed-out';
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
    return <SignedOut reason={session.reason} account={session.account} />;
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
