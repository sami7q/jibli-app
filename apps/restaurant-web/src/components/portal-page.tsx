'use client';

import type { ReactNode } from 'react';
import {
  type MERCHANT_TYPE_LABELS,
  type MerchantType,
  type RestaurantPermission,
} from '@jibli/contracts';
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
  /**
   * The words that change with the kind of shop: what its catalog is called,
   * and what one line in it is called.
   *
   * On the context so a page names things the way the sidebar beside it does,
   * rather than each screen deciding for itself.
   */
  readonly words: (typeof MERCHANT_TYPE_LABELS)[MerchantType];
  readonly merchantType: MerchantType;
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
      catalogLabel={session.words.catalogAr}
      itemLabel={session.words.itemAr}
    >
      {denied ? (
        <ForbiddenState requiredAr={permissionLabelAr ?? permission} />
      ) : (
        children({
          auth: { accessToken: session.accessToken, restaurantId: session.restaurantId },
          can: session.can,
          restaurantName: session.restaurantName,
          userName: session.userName,
          /*
           * What this merchant calls its catalog and one line in it.
           *
           * Passed with the rest rather than fetched per page, so every screen
           * that names a catalog names it the same way — a sidebar saying
           * «المنتجات» beside a heading saying «المنيو» is worse than either
           * one alone.
           */
          words: session.words,
          merchantType: session.merchantType,
        })
      )}
    </Shell>
  );
}
