import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, ApiError, NetworkError } from './api';
import {
  clearSession,
  forgetGuestChoice,
  loadGuestChoice,
  loadSession,
  rememberGuestChoice,
  saveSession,
  type StoredSession,
} from './secure-session';

/**
 * Who is signed in, resolved once.
 *
 * This used to live in `useState` inside the root layout, which meant the boot
 * check ran there and every screen that needed the user's city read the
 * keystore again for itself. A keystore read is not free, and worse, two
 * screens could disagree about whether the session was still valid.
 *
 * One provider, one read, one answer.
 */

export interface Me {
  readonly user_id: string;
  readonly full_name: string | null;
  readonly profile_completed: boolean;
  /**
   * False for a Google account that has not added a number yet. Browsing works;
   * checkout does not, and the server refuses it rather than trusting this.
   */
  readonly phone_verified: boolean;
  readonly governorate_id: string | null;
  readonly governorate_name_ar: string | null;
  readonly city_id: string | null;
  readonly city_name_ar: string | null;
  readonly modes: ('CUSTOMER' | 'DRIVER')[];
  readonly driver_id: string | null;
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /**
   * Browsing without an account.
   *
   * App Store guideline 5.1.1(ii): an app may not demand registration for
   * content that does not require it. Restaurants and menus do not — only
   * placing an order does, because an order needs somewhere to be delivered
   * and someone to call about it. So this is a real state the app runs in,
   * not a screen it passes through.
   */
  | { status: 'guest' }
  /** Signed in, but the mandatory profile is not filled in yet (plan §11). */
  | { status: 'needs-profile'; me: Me }
  | { status: 'ready'; me: Me }
  /**
   * A stored session the server could not be asked about. The user gets in and
   * works from cache; anything that spends money revalidates server-side
   * anyway (plan §109).
   */
  | { status: 'offline-ready'; me: Me | null };

interface SessionApi {
  readonly state: SessionState;
  /** Store tokens after a successful OTP verification and resolve the user. */
  readonly signIn: (session: StoredSession) => Promise<void>;
  readonly signOut: () => Promise<void>;
  /** Re-ask the server — after completing the profile, or changing city. */
  readonly refresh: () => Promise<void>;
  /** Take «تصفح كضيف» and remember it, so the welcome screen asks once. */
  readonly continueAsGuest: () => Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  // Guards against a resolve that finishes after the component unmounts, and
  // against two overlapping resolves racing to set the state.
  const generation = useRef(0);

  const resolve = useCallback(async (): Promise<void> => {
    const mine = ++generation.current;
    const commit = (next: SessionState) => {
      if (generation.current === mine) setState(next);
    };

    const stored = await loadSession();
    if (!stored) {
      // A returning guest goes straight back to browsing; only a first launch
      // (or someone who has signed out) sees the welcome screen.
      commit((await loadGuestChoice()) ? { status: 'guest' } : { status: 'signed-out' });
      return;
    }

    try {
      const me = await apiRequest<Me>('/api/v1/auth/me');

      /*
       * A driver is not held by the customer profile flow.
       *
       * The mandatory profile exists so that an order has a name, a
       * governorate and a city behind it (plan §11) — and a courier signing in
       * to deliver is not placing one. Without this exemption a driver whose
       * account the restaurant created lands on «أكمل ملفك» and cannot leave,
       * because the screen they want is behind the gate.
       *
       * Nothing is loosened by it: the server refuses to quote or place an
       * order without a complete profile regardless, and `ApiError.needsProfile`
       * routes them here the moment they try to order.
       */
      const heldByProfile = !me.profile_completed && !me.modes.includes('DRIVER');
      commit(heldByProfile ? { status: 'needs-profile', me } : { status: 'ready', me });
    } catch (error) {
      if (error instanceof NetworkError) {
        commit({ status: 'offline-ready', me: null });
        return;
      }

      /*
       * Any answer the server actually gave means the session is finished —
       * expired, revoked, or the account is gone. Clearing is right; retrying
       * would loop.
       */
      if (error instanceof ApiError) {
        await clearSession();
        commit({ status: 'signed-out' });
        return;
      }

      commit({ status: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      signIn: async (session) => {
        await saveSession(session);
        // They have an account now; the guest flag would otherwise send them
        // back to browsing anonymously the next time a session expires.
        await forgetGuestChoice();
        await resolve();
      },
      signOut: async () => {
        await Promise.all([clearSession(), forgetGuestChoice()]);
        generation.current += 1;
        setState({ status: 'signed-out' });
      },
      refresh: resolve,
      continueAsGuest: async () => {
        await rememberGuestChoice();
        generation.current += 1;
        setState({ status: 'guest' });
      },
    }),
    [state, resolve],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return context;
}

/**
 * The signed-in user, or null.
 *
 * A convenience for the common case — a screen that wants the city id and does
 * not care which of the four signed-in states produced it.
 */
export function useMe(): Me | null {
  const { state } = useSession();
  if (state.status === 'ready' || state.status === 'needs-profile') return state.me;
  if (state.status === 'offline-ready') return state.me;
  return null;
}

/**
 * Browsing without an account.
 *
 * What a screen asks before doing anything that needs one — placing an order,
 * favouriting, opening the order history. The answer is not "show an error":
 * it is "send them to sign in, and bring them back here".
 */
export function useIsGuest(): boolean {
  return useSession().state.status === 'guest';
}
