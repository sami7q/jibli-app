'use client';

import type { AdminSessionState } from '@/hooks/use-session';
import { Skeleton } from '@/components/ui';
import { SignedOut } from '@/components/signed-out';

/**
 * What a page shows when it does not yet have a usable session.
 *
 * The session has three states and every page was treating it as two:
 *
 *     if (session.status !== 'authenticated') return <SignedOut … />;
 *
 * `loading` satisfies that condition, and `SignedOut` redirects to the sign-in
 * form the moment it mounts. So opening any of these pages directly — a
 * bookmark, a refresh, a pasted link — bounced the user to /login before the
 * session it was still fetching could arrive. Seventeen of nineteen pages had
 * it; the two that did not were the two that happened to check `loading`
 * separately first.
 *
 * One component, so the distinction is made once. Pages keep the early return,
 * because that is what narrows `session` to the authenticated shape for the
 * rest of the render.
 */
export function SessionGate({ session }: { session: AdminSessionState }) {
  if (session.status === 'loading') {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <Skeleton height={520} />
        <span className="sr-only">جاري التحقق من الجلسة…</span>
      </div>
    );
  }

  /*
   * An authenticated session never reaches here — pages call this only after
   * their own `status !== 'authenticated'` check — but the type does not know
   * that, and asserting it would be a lie the compiler cannot verify.
   */
  return (
    <SignedOut
      {...(session.status === 'unauthenticated' && session.reason
        ? { reason: session.reason }
        : {})}
    />
  );
}
