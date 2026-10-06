'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Realtime subscription for the Restaurant Portal (plan §31, §110).
 *
 * Realtime is an accelerator, not the source of truth. The board still polls,
 * and every event here triggers a refetch rather than mutating local state
 * directly — so a duplicated or out-of-order frame cannot corrupt what the
 * operator sees (plan §31: "duplicated events cannot duplicate alerts or state
 * transitions").
 *
 * On reconnect the client refetches unconditionally, which is the delta sync
 * the plan requires: anything that happened while the socket was down is picked
 * up from the authoritative API.
 */

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

interface RealtimeEvent {
  readonly type: 'event' | 'ready' | 'pong';
  readonly channel?: string;
  readonly data?: {
    readonly id: string;
    readonly type: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
  };
}

export interface UseRealtimeOptions {
  readonly accessToken: string | null;
  /** Called whenever an event arrives that should invalidate cached data. */
  readonly onEvent: (eventType: string, aggregateId: string) => void;
  readonly enabled?: boolean;
}

/** Reconnect backoff, capped so a long outage does not leave the board dead. */
const BASE_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

/** Client keepalive; the server also pings, this covers proxies that strip it. */
const PING_INTERVAL_MS = 25_000;

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

export function useRealtime(options: UseRealtimeOptions): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUsRef = useRef(false);
  /**
   * Event IDs already handled. A reconnect can replay a frame the client
   * already processed; without this the alert would fire twice (plan §30).
   */
  const seenEventsRef = useRef<Set<string>>(new Set());

  // Keep the latest callback without making it a reconnect trigger.
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  const { accessToken, enabled = true } = options;

  useEffect(() => {
    if (!enabled || !accessToken) {
      setStatus('offline');
      return;
    }

    closedByUsRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const connect = (): void => {
      const base = apiBase().replace(/^http/, 'ws');
      // The browser WebSocket API cannot set an Authorization header, so the
      // short-lived access token travels as a query parameter over TLS.
      const socket = new WebSocket(
        `${base}/api/v1/realtime?token=${encodeURIComponent(accessToken)}`,
      );
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        setStatus('connected');

        // Delta sync: refetch everything now that we are live again, because
        // anything that happened during the gap was never delivered.
        onEventRef.current('reconnect.sync', '');

        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (message) => {
        let parsed: RealtimeEvent;
        try {
          parsed = JSON.parse(String(message.data)) as RealtimeEvent;
        } catch {
          return;
        }

        if (parsed.type !== 'event' || !parsed.data) return;

        // Deduplicate by stable event ID (plan §31).
        if (seenEventsRef.current.has(parsed.data.id)) return;
        seenEventsRef.current.add(parsed.data.id);

        // Bound the set so a long-lived tab does not grow unboundedly.
        if (seenEventsRef.current.size > 500) {
          const oldest = seenEventsRef.current.values().next().value;
          if (oldest) seenEventsRef.current.delete(oldest);
        }

        onEventRef.current(parsed.data.type, parsed.data.aggregateId);
      };

      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;

        if (closedByUsRef.current) return;

        setStatus('reconnecting');

        // Exponential backoff with jitter — without jitter every portal in the
        // country would reconnect in lockstep after an outage.
        const attempt = (attemptRef.current += 1);
        const base = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** Math.min(attempt, 6));
        const delay = base * (0.7 + Math.random() * 0.6);

        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        // onclose always follows; the reconnect is scheduled there.
        setStatus('reconnecting');
      };
    };

    connect();

    return () => {
      closedByUsRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      socketRef.current?.close(1000, 'COMPONENT_UNMOUNTED');
      socketRef.current = null;
    };
  }, [accessToken, enabled]);

  return status;
}
