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
import { AppState } from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { apiRequest, ApiError, NetworkError } from './api';
import {
  clearParkedSession,
  clearSession,
  forgetGuestChoice,
  loadGuestChoice,
  loadParkedSession,
  loadSession,
  parkSession,
  rememberGuestChoice,
  saveSession,
  type ParkedKind,
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
  /**
   * The shops this account holds a role in, keyed by shop id.
   *
   * `/api/v1/auth/me` has always returned this; the app simply never read it.
   * It is what tells Owner Mode that there is anything to offer, without a
   * second request before the account screen can draw a row.
   *
   * Optional because an older server — or a cached `me` from before this
   * shipped — has no such field, and an owner with no shops is a real state.
   */
  readonly restaurant_roles?: Record<string, string[]>;
  /** The portal sign-in name of a shop's issued account; absent for a phone account. */
  readonly username?: string | null;
  /** The password Jibli issued has not been replaced yet. */
  readonly must_change_password?: boolean;
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
  /**
   * Store tokens after a successful sign-in and resolve the user.
   *
   * `park` keeps the account that was signed in, as that kind, so the
   * person gets it back with one tap: a customer signing into their shop
   * does not lose their own account to do it.
   */
  readonly signIn: (session: StoredSession, options?: { park?: ParkedKind }) => Promise<void>;
  /** Both accounts: the active one and any parked one. */
  readonly signOut: () => Promise<void>;
  /** The account waiting to be switched back to, if any. */
  readonly parkedAccount: ParkedKind | null;
  /** Swap the active and the parked account. False when nothing is parked. */
  readonly switchToParked: () => Promise<boolean>;
  /** Re-ask the server — after completing the profile, or changing city. */
  readonly refresh: () => Promise<void>;
  /** Take «تصفح كضيف» and remember it, so the welcome screen asks once. */
  readonly continueAsGuest: () => Promise<void>;
}

/** How long an unconfirmed session waits before asking the server again. */
const OFFLINE_RECHECK_MS = 20_000;

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [parkedAccount, setParkedAccount] = useState<ParkedKind | null>(null);

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
      /*
       * A driver is not held by the customer profile flow. Nor is a shop owner,
       * and for exactly the same reason.
       *
       * The mandatory profile exists so that an order has a name, a governorate
       * and a city behind it (plan §11) — and neither a courier signing in to
       * deliver nor a grocer signing in to price a shelf is placing one. A
       * portal account is created by staff with a username and no address, so
       * without this exemption every owner lands on «أكمل ملفك» and cannot
       * leave: the screen they came for is behind the gate.
       *
       * Nothing is loosened. The server refuses to quote or place an order
       * without a complete profile regardless, and `ApiError.needsProfile`
       * routes them here the moment they try to order something.
       */
      const ownsShop = Object.keys(me.restaurant_roles ?? {}).length > 0;
      const heldByProfile = !me.profile_completed && !me.modes.includes('DRIVER') && !ownsShop;
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
    void loadParkedSession().then((parked) => setParkedAccount(parked?.kind ?? null));
  }, [resolve]);

  /*
   * «Offline» is a guess about the network, so it is re-tested.
   *
   * A launch whose `/auth/me` timed out — no signal in a lift, or an API still
   * waking from idle — committed `offline-ready` with no user and nothing ever
   * asked again: the account tab said «أنت غير متصل» on a working connection,
   * and a shop's or courier's live order alerts never started, because they
   * wait for a `me`. Ask again when the app comes back to the foreground, when
   * the network returns, and on a timer while it lasts; each failed attempt
   * commits a fresh state, which re-arms the timer.
   */
  useEffect(() => {
    if (state.status !== 'offline-ready' || state.me) return;
    const retry = () => void resolve();
    const timer = setTimeout(retry, OFFLINE_RECHECK_MS);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') retry();
    });
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) retry();
    });
    return () => {
      clearTimeout(timer);
      appState.remove();
      unsubscribeOnline();
    };
  }, [state, resolve]);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      parkedAccount,
      signIn: async (session, options) => {
        if (options?.park) {
          const current = await loadSession();
          if (current && current.userId !== session.userId) {
            await parkSession({ ...current, kind: options.park });
            setParkedAccount(options.park);
          }
        }
        await saveSession(session);
        // They have an account now; the guest flag would otherwise send them
        // back to browsing anonymously the next time a session expires.
        await forgetGuestChoice();
        await resolve();
      },
      signOut: async () => {
        await Promise.all([clearSession(), clearParkedSession(), forgetGuestChoice()]);
        generation.current += 1;
        setParkedAccount(null);
        setState({ status: 'signed-out' });
      },
      /*
       * The swap. The parked account becomes the session and the session is
       * parked in its place, as the other kind — so the way back is always
       * there. The resolve that follows asks the server about the account
       * that just came out, and its access token may have expired while it
       * waited; the request layer refreshes it with the refresh token it
       * carried, exactly as it would after a night's sleep.
       */
      switchToParked: async () => {
        const parked = await loadParkedSession();
        if (!parked) return false;
        const current = await loadSession();
        await saveSession({
          accessToken: parked.accessToken,
          refreshToken: parked.refreshToken,
          userId: parked.userId,
        });
        if (current && current.userId !== parked.userId) {
          const kind: ParkedKind = parked.kind === 'shop' ? 'customer' : 'shop';
          await parkSession({ ...current, kind });
          setParkedAccount(kind);
        } else {
          await clearParkedSession();
          setParkedAccount(null);
        }
        await resolve();
        return true;
      },
      refresh: resolve,
      continueAsGuest: async () => {
        await rememberGuestChoice();
        generation.current += 1;
        setState({ status: 'guest' });
      },
    }),
    [state, parkedAccount, resolve],
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
