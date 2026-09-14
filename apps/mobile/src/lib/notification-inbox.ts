import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { OrderNotification } from './api';

/**
 * Which notifications this device has already shown the customer.
 *
 * One timestamp, not a set of ids. The feed is the order status history, which
 * only ever grows at the front, so "everything at or before this moment has
 * been seen" answers the same question as a list of read markers and cannot
 * drift out of sync with a server that does not know about it.
 *
 * Deliberately local. A read marker is not a fact about the account — it is a
 * fact about a screen somebody looked at — and syncing it would mean a schema,
 * a migration and an endpoint to record that a badge went grey.
 */

const SEEN_KEY = 'jibli.notifications.seenAt';

/**
 * `expo-secure-store` ships `export default {}` for web — calling it there
 * throws — so the browser preview falls back to `localStorage`, exactly as
 * `secure-session` does. Nothing here is secret; it is a timestamp.
 */
const isWeb = Platform.OS === 'web';

async function readSeenAt(): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(SEEN_KEY) ?? null;
    return await SecureStore.getItemAsync(SEEN_KEY);
  } catch {
    // Private mode, blocked storage, or a keystore that refused. Treating
    // everything as unseen is the safe direction: it over-marks rather than
    // hiding an update.
    return null;
  }
}

async function writeSeenAt(iso: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(SEEN_KEY, iso);
    else await SecureStore.setItemAsync(SEEN_KEY, iso);
  } catch {
    /* Losing the marker costs a badge, not data. */
  }
}

/**
 * Orders whose tracking screen this device has already opened by itself.
 *
 * Lives beside the notification marker because it is the same kind of fact: a
 * small, local record of what this screen has already shown somebody, worth
 * nothing to the server and not worth a migration to sync.
 *
 * A list rather than one id, capped, because a customer can have two orders
 * running and being taken to the older one twice is the bug this prevents.
 */
const JUMPED_KEY = 'jibli.orders.openedOnLaunch';
const JUMPED_LIMIT = 20;

async function readJumped(): Promise<string[]> {
  try {
    const raw = isWeb
      ? (globalThis.localStorage?.getItem(JUMPED_KEY) ?? null)
      : await SecureStore.getItemAsync(JUMPED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // Unreadable storage means "never shown", which errs towards showing it —
    // an extra jump is a smaller wrong than an order the customer never sees.
    return [];
  }
}

export async function hasSeenOrderScreen(orderId: string): Promise<boolean> {
  return (await readJumped()).includes(orderId);
}

export async function rememberOrderScreenSeen(orderId: string): Promise<void> {
  try {
    const next = [orderId, ...(await readJumped()).filter((id) => id !== orderId)].slice(
      0,
      JUMPED_LIMIT,
    );
    const raw = JSON.stringify(next);
    if (isWeb) globalThis.localStorage?.setItem(JUMPED_KEY, raw);
    else await SecureStore.setItemAsync(JUMPED_KEY, raw);
  } catch {
    /* Losing it costs one extra jump, not data. */
  }
}

/** Listeners so a badge elsewhere in the app updates the moment this changes. */
const listeners = new Set<(seenAt: string | null) => void>();
let cached: string | null = null;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  cached = await readSeenAt();
  loaded = true;
  for (const listener of listeners) listener(cached);
}

/** Everything at or before `iso` has now been seen. */
export async function markNotificationsSeen(iso: string): Promise<void> {
  await ensureLoaded();
  // Never move the marker backwards: an older row arriving late must not
  // un-see the newer ones above it.
  if (cached && cached >= iso) return;

  cached = iso;
  await writeSeenAt(iso);
  for (const listener of listeners) listener(cached);
}

function useSeenAt(): string | null {
  const [seenAt, setSeenAt] = useState<string | null>(cached);

  useEffect(() => {
    listeners.add(setSeenAt);
    void ensureLoaded();
    return () => {
      listeners.delete(setSeenAt);
    };
  }, []);

  return seenAt;
}

/** The ids of entries that arrived after this device last looked. */
export function useUnseenNotifications(
  feed: readonly OrderNotification[] | undefined,
): ReadonlySet<string> {
  const seenAt = useSeenAt();

  return useMemo(() => {
    if (!feed) return new Set<string>();
    /*
     * No marker means this device has never opened the screen. Marking the
     * whole history unread would put a badge of nine on a customer who has
     * simply never tapped the bell, so only the newest is offered — enough to
     * say "there is something here" without inventing a backlog.
     */
    if (!seenAt) {
      const newest = feed[0];
      return new Set(newest ? [newest.id] : []);
    }
    return new Set(feed.filter((entry) => entry.at > seenAt).map((entry) => entry.id));
  }, [feed, seenAt]);
}

/** How many to show on the bell. Capped, because "+9" is as useful as "37". */
export function useUnseenCount(feed: readonly OrderNotification[] | undefined): number {
  return useUnseenNotifications(feed).size;
}
