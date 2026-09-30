/**
 * A push for a shop or a courier that arrived while the app was open.
 *
 * The notification handler lives at module scope in `push.ts`, outside React,
 * and cannot reach the query cache. So it hands the push here and the live
 * engines (`owner-live.tsx`, `driver-live.tsx`) — which can — refetch at once
 * and ring from the app, instead of the system drawing a second banner over
 * the one the app is about to draw.
 */

export interface WorkSignal {
  readonly audience: 'restaurant' | 'driver';
  readonly eventType: string;
  readonly orderId: string;
}

type Listener = (signal: WorkSignal) => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe. */
export function onWorkSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWorkSignal(signal: WorkSignal): void {
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch {
      /* One broken listener must not silence the others. */
    }
  }
}

/** Whether anything is listening — i.e. the app can ring for this itself. */
export function hasWorkListeners(): boolean {
  return listeners.size > 0;
}
