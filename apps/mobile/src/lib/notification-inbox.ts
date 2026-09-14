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
