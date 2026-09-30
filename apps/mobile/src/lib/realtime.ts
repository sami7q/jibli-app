import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { accessTokenForSocket, realtimeUrl } from './api';

/**
 * The realtime socket, for the two screens that are waited on: a shop's order
 * board and a courier's task.
 *
 * `GET /api/v1/realtime?token=` subscribes the socket to every channel the
 * token's claims allow — the shop's order channel for an owner, the courier's
 * task channel for a driver — so there is nothing to ask for once connected.
 * The worker publishes each outbox event there as it commits.
 *
 * It is a *nudge*, not a data source. An event says «something about order X
 * changed»; the screen refetches the one endpoint it already trusts. That keeps
 * one shape of truth per screen, and means a missed frame costs a few seconds
 * of latency (the polling fallback catches it) rather than a wrong screen.
 *
 * Closed while the app is in the background — iOS suspends it anyway, and a
 * socket held open by a phone in a pocket is battery for nothing; push covers
 * the background. Reopened, with a `realtime.sync` nudge, when the app returns.
 */

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'retrying';

export interface RealtimeEvent {
  readonly id: string;
  /** An outbox event type (`order.placed`), or `realtime.sync` after a (re)connect. */
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

interface Frame {
  readonly type?: string;
  readonly data?: {
    readonly id?: string;
    readonly type?: string;
    readonly aggregateId?: string;
    readonly payload?: Record<string, unknown>;
  };
}

/** Keep-alive, inside the gateway's 70-second pong timeout. */
const PING_MS = 25_000;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** Emitted on every successful (re)connect: whatever was missed, look again. */
const SYNC: RealtimeEvent = { id: 'sync', type: 'realtime.sync', aggregateId: '', payload: {} };

/**
 * Hold a socket open while `enabled`, calling `onEvent` for each new event.
 *
 * `identity` is the signed-in user: a different account on the same phone is
 * a different set of channels, so it reconnects rather than keep listening on
 * the previous owner's shop.
 */
export function useRealtime(
  enabled: boolean,
  identity: string | null,
  onEvent: (event: RealtimeEvent) => void,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('off');
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled || !identity) {
      setStatus('off');
      return;
    }

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;
    let stopped = false;
    let foreground = AppState.currentState === 'active';
    /** Event ids already handled: a retried publish must not ring twice. */
    const seen = new Set<string>();

    const clearTimers = () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      retryTimer = null;
      pingTimer = null;
    };

    const scheduleRetry = () => {
      if (stopped || !foreground) return;
      attempt += 1;
      const ceiling = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(attempt, 5));
      // Jittered, so a whole city's phones do not reconnect in the same second
      // after the API restarts.
      const delay = ceiling * (0.7 + Math.random() * 0.6);
      setStatus('retrying');
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async (): Promise<void> => {
      if (stopped || !foreground) return;
      setStatus(attempt === 0 ? 'connecting' : 'retrying');

      const token = await accessTokenForSocket().catch(() => null);
      if (stopped || !foreground) return;
      if (!token) {
        scheduleRetry();
        return;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(`${realtimeUrl()}?token=${encodeURIComponent(token)}`);
      } catch {
        scheduleRetry();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus('live');
        handler.current(SYNC);
        pingTimer = setInterval(() => {
          if (ws.readyState === 1) ws.send('{"type":"ping"}');
        }, PING_MS);
      };

      ws.onmessage = (message) => {
        let frame: Frame;
        try {
          frame = JSON.parse(String(message.data)) as Frame;
        } catch {
          return;
        }
        const data = frame.data;
        if (frame.type !== 'event' || !data?.id || !data.type) return;
        if (seen.has(data.id)) return;
        seen.add(data.id);
        if (seen.size > 300) {
          const oldest = seen.values().next().value;
          if (oldest) seen.delete(oldest);
        }
        handler.current({
          id: data.id,
          type: data.type,
          aggregateId: data.aggregateId ?? '',
          payload: data.payload ?? {},
        });
      };

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        if (socket === ws) socket = null;
        scheduleRetry();
      };

      // `onclose` follows every error; retrying from both would double up.
      ws.onerror = () => undefined;
    };

    const subscription = AppState.addEventListener('change', (next) => {
      const nowForeground = next === 'active';
      if (nowForeground === foreground) return;
      foreground = nowForeground;

      if (foreground) {
        attempt = 0;
        void connect();
      } else {
        clearTimers();
        const open = socket;
        socket = null;
        open?.close();
        setStatus('off');
      }
    });

    void connect();

    return () => {
      stopped = true;
      subscription.remove();
      clearTimers();
      socket?.close();
      socket = null;
    };
  }, [enabled, identity]);

  return status;
}
