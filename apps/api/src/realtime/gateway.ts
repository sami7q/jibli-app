import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { verifyAccessToken } from '@jibli/auth';
import { channels } from '@jibli/contracts';
import type { AppContext } from '../lib/context.js';

/**
 * The subscriber's own connection.
 *
 * Built through the same branch the application client uses, so a development
 * run on `memory://` gets the in-process substitute here too — otherwise this
 * tries to dial a host called "local" and floods the log with ENOENT while the
 * rest of the API works fine.
 */
function createRealtimeSubscriber(ctx: AppContext): Redis {
  if (ctx.env.REDIS_URL.startsWith('memory:')) {
    // A publish and its subscriber must share one store, and `duplicate()` on
    // the substitute returns a client backed by the same data.
    return ctx.redis.duplicate();
  }

  return new Redis(ctx.env.REDIS_URL, {
    keyPrefix: `${ctx.env.REDIS_NAMESPACE}:`,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

/**
 * Realtime gateway (plan §31, §63, §110).
 *
 * The outbox worker publishes to Redis pub/sub; this relays to browsers and
 * mobile clients over WebSocket.
 *
 * Two rules govern the design:
 *
 *  1. **A channel name is not a capability.** Plan §63: "Exports and realtime
 *     channels use the same authorization model." A socket is only subscribed
 *     to channels its authenticated principal actually has membership for —
 *     asking for `restaurant:<someone-else>:orders` is refused.
 *
 *  2. **Realtime is an accelerator, never the source of truth.** Clients still
 *     poll and still re-fetch on reconnect. This gateway going down makes
 *     alerts slower, not wrong (plan §110).
 */

/** Heartbeat cadence. A dead socket is detected within two intervals. */
const PING_INTERVAL_MS = 30_000;

/** A client that has not answered a ping in this long is assumed gone. */
const PONG_TIMEOUT_MS = 70_000;

/** Refuse absurd subscription sets rather than fanning out unboundedly. */
const MAX_CHANNELS_PER_SOCKET = 25;

interface Connection {
  readonly socket: WebSocket;
  readonly userId: string;
  readonly sessionId: string;
  readonly channels: Set<string>;
  lastSeenAt: number;
}

export interface RealtimeGateway {
  /** Number of live sockets — surfaced on the readiness probe. */
  connectionCount(): number;
  close(): Promise<void>;
}

export async function registerRealtimeGateway(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<RealtimeGateway> {
  const connections = new Set<Connection>();
  /** channel → connections subscribed to it. */
  const byChannel = new Map<string, Set<Connection>>();

  /*
   * A dedicated Redis connection.
   *
   * ioredis puts a client into subscriber mode once it subscribes, after which
   * it can issue no other commands. Sharing the application's client would
   * break every cache read and rate-limit check in the process.
   */
  const subscriber = createRealtimeSubscriber(ctx);

  subscriber.on('error', (error: Error) => {
    ctx.logger.error({ event: 'realtime.redis_error', err: error.message }, 'Realtime Redis error');
  });

  // The in-process substitute is connected on construction and answers a
  // second request by throwing; that is the state we wanted, not a failure.
  await subscriber.connect().catch((error: Error) => {
    if (!/already connect/i.test(error.message)) throw error;
  });

  /** Relay a published message to every socket subscribed to that channel. */
  subscriber.on('message', (channel: string, payload: string) => {
    // ioredis strips the keyPrefix from published channel names on delivery in
    // some versions and not others; normalise so lookups always match.
    const normalized = channel.startsWith(`${ctx.env.REDIS_NAMESPACE}:`)
      ? channel.slice(ctx.env.REDIS_NAMESPACE.length + 1)
      : channel;

    const targets = byChannel.get(normalized);
    if (!targets || targets.size === 0) return;

    const frame = JSON.stringify({ type: 'event', channel: normalized, data: JSON.parse(payload) });

    for (const connection of targets) {
      // readyState 1 === OPEN. Writing to a closing socket throws.
      if (connection.socket.readyState === 1) {
        try {
          connection.socket.send(frame);
        } catch (error) {
          ctx.logger.warn(
            { event: 'realtime.send_failed', userId: connection.userId, err: String(error) },
            'Failed to deliver realtime frame',
          );
        }
      }
    }
  });

  /**
   * Which channels a principal may join.
   *
   * Derived from the session's memberships, never from what the client asked
   * for. A cashier removed from a restaurant mid-shift loses the channel on
   * their next connection, and the periodic re-auth below closes the socket.
   */
  const authorizedChannels = (claims: {
    sub: string;
    restaurantRoles: Record<string, string[]>;
    driverId: string | null;
  }): Set<string> => {
    const allowed = new Set<string>();

    // Every authenticated user may watch their own orders.
    allowed.add(channels.customerOrders(claims.sub));

    for (const restaurantId of Object.keys(claims.restaurantRoles)) {
      allowed.add(channels.restaurantOrders(restaurantId));
    }

    if (claims.driverId) {
      allowed.add(channels.driverTasks(claims.driverId));
    }

    return allowed;
  };

  const subscribeConnection = async (
    connection: Connection,
    requested: string[],
  ): Promise<string[]> => {
    const granted: string[] = [];

    for (const channel of requested.slice(0, MAX_CHANNELS_PER_SOCKET)) {
      connection.channels.add(channel);

      let targets = byChannel.get(channel);
      if (!targets) {
        targets = new Set();
        byChannel.set(channel, targets);
        // First subscriber for this channel: start listening on Redis.
        await subscriber.subscribe(channel);
      }
      targets.add(connection);
      granted.push(channel);
    }

    return granted;
  };

  const teardown = async (connection: Connection): Promise<void> => {
    connections.delete(connection);

    for (const channel of connection.channels) {
      const targets = byChannel.get(channel);
      if (!targets) continue;
      targets.delete(connection);

      // Last subscriber left: stop paying for the Redis subscription.
      if (targets.size === 0) {
        byChannel.delete(channel);
        try {
          await subscriber.unsubscribe(channel);
        } catch {
          /* unsubscribe during shutdown is best effort */
        }
      }
    }
  };

  app.get('/api/v1/realtime', { websocket: true }, (socket, request) => {
    /*
     * Authenticate from a query parameter rather than a header.
     *
     * The browser WebSocket API cannot set an Authorization header. The token
     * is short-lived, the connection is TLS in production, and the alternative
     * — a cookie — would expose the socket to CSWSH from any origin.
     */
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(4401, 'UNAUTHENTICATED');
      return;
    }

    void (async () => {
      let claims;
      try {
        claims = await verifyAccessToken(token, {
          accessSecret: ctx.env.JWT_ACCESS_SECRET,
          refreshSecret: ctx.env.JWT_REFRESH_SECRET,
          accessTtlSeconds: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
          refreshTtlSeconds: ctx.env.REFRESH_TOKEN_TTL_SECONDS,
        });
      } catch {
        socket.close(4401, 'UNAUTHENTICATED');
        return;
      }

      const connection: Connection = {
        socket,
        userId: claims.sub,
        sessionId: claims.sid,
        channels: new Set(),
        lastSeenAt: Date.now(),
      };
      connections.add(connection);

      const allowed = authorizedChannels({
        sub: claims.sub,
        restaurantRoles: claims.restaurantRoles ?? {},
        driverId: claims.driverId ?? null,
      });

      // Subscribe to everything the principal is entitled to, immediately.
      // The client does not have to ask, so it cannot ask for the wrong thing.
      const granted = await subscribeConnection(connection, [...allowed]);

      socket.send(
        JSON.stringify({
          type: 'ready',
          channels: granted,
          // The client uses this to decide whether it missed anything while
          // disconnected and must delta-sync (plan §31).
          serverTime: new Date().toISOString(),
        }),
      );

      ctx.logger.info(
        { event: 'realtime.connected', userId: claims.sub, channels: granted.length },
        'Realtime client connected',
      );

      socket.on('message', (raw: Buffer) => {
        connection.lastSeenAt = Date.now();

        let message: { type?: string };
        try {
          message = JSON.parse(raw.toString()) as { type?: string };
        } catch {
          return; // Malformed frames are ignored, not fatal.
        }

        // The only client-initiated message is a keepalive. Subscription is
        // server-decided, so there is no "subscribe" verb to abuse.
        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', serverTime: new Date().toISOString() }));
        }
      });

      socket.on('pong', () => {
        connection.lastSeenAt = Date.now();
      });

      socket.on('close', () => {
        void teardown(connection);
        ctx.logger.info(
          { event: 'realtime.disconnected', userId: connection.userId },
          'Realtime client disconnected',
        );
      });

      socket.on('error', (error: Error) => {
        ctx.logger.warn(
          { event: 'realtime.socket_error', userId: connection.userId, err: error.message },
          'Realtime socket error',
        );
        void teardown(connection);
      });
    })();
  });

  /*
   * Liveness sweep.
   *
   * A client that loses connectivity without a clean close leaves a socket that
   * looks open. Without this, a restaurant tablet that dropped off Wi-Fi would
   * hold a channel subscription forever and the operator would believe alerts
   * were being delivered.
   */
  const heartbeat = setInterval(() => {
    const cutoff = Date.now() - PONG_TIMEOUT_MS;

    for (const connection of connections) {
      if (connection.lastSeenAt < cutoff) {
        try {
          connection.socket.terminate();
        } catch {
          /* already gone */
        }
        void teardown(connection);
        continue;
      }

      if (connection.socket.readyState === 1) {
        try {
          connection.socket.ping();
        } catch {
          void teardown(connection);
        }
      }
    }
  }, PING_INTERVAL_MS);

  return {
    connectionCount: () => connections.size,
    close: async () => {
      clearInterval(heartbeat);
      for (const connection of connections) {
        try {
          connection.socket.close(1001, 'SERVER_SHUTDOWN');
        } catch {
          /* best effort */
        }
      }
      connections.clear();
      byChannel.clear();
      await subscriber.quit();
    },
  };
}
