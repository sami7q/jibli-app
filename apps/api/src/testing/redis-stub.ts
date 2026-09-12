import { createServer, type Socket } from 'node:net';

/**
 * A Redis server that speaks just enough RESP to let the API boot.
 *
 * `buildServer` cannot be assembled without a live Redis: the realtime gateway
 * opens a dedicated subscriber connection and awaits it (realtime/gateway.ts).
 * That is correct in production — ioredis locks a client into subscriber mode,
 * so the application client cannot be reused — but it meant no test could ever
 * assemble the server, and a boot-time crash reached production because of it.
 *
 * Docker in CI would solve this too, and more completely. This exists because a
 * test that needs a container is a test that does not run, and the whole point
 * is that it runs on every commit.
 *
 * It is deliberately not a Redis implementation. Assembly needs exactly one
 * exchange — the INFO ready check — so that is what is answered faithfully;
 * pub/sub is answered well enough to keep a subscriber happy, and anything else
 * gets +OK. Any test that needs real Redis semantics wants a real Redis.
 */

const CRLF = '\r\n';
const ASTERISK = 0x2a;
const DOLLAR = 0x24;

/**
 * Only `loading` is read (Redis.js `_readyCheck`): anything other than absent
 * or "0" makes ioredis wait for the server to finish loading and retry.
 */
const INFO_PAYLOAD = [
  '# Server',
  'redis_version:7.4.0',
  'redis_mode:standalone',
  '# Persistence',
  'loading:0',
  '',
].join(CRLF);

function bulk(value: string): string {
  return `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
}

interface ParsedCommand {
  readonly args: readonly string[];
  readonly rest: Buffer;
}

/**
 * Read one complete command, or nothing if the buffer holds only part of one.
 * TCP splits wherever it likes, so a partial frame is normal and must be left
 * in the buffer rather than treated as malformed.
 */
function readCommand(buffer: Buffer): ParsedCommand | undefined {
  if (buffer.length === 0 || buffer[0] !== ASTERISK) return undefined;

  let cursor = buffer.indexOf(CRLF);
  if (cursor < 0) return undefined;

  const count = Number.parseInt(buffer.subarray(1, cursor).toString(), 10);
  if (!Number.isFinite(count)) return undefined;
  cursor += CRLF.length;

  const args: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer[cursor] !== DOLLAR) return undefined;

    const headerEnd = buffer.indexOf(CRLF, cursor);
    if (headerEnd < 0) return undefined;

    const length = Number.parseInt(buffer.subarray(cursor + 1, headerEnd).toString(), 10);
    if (!Number.isFinite(length)) return undefined;

    const start = headerEnd + CRLF.length;
    const end = start + length;
    if (buffer.length < end + CRLF.length) return undefined;

    args.push(buffer.subarray(start, end).toString());
    cursor = end + CRLF.length;
  }

  return { args, rest: buffer.subarray(cursor) };
}

function respond(args: readonly string[]): string {
  const name = (args[0] ?? '').toLowerCase();

  switch (name) {
    case 'info':
      return bulk(INFO_PAYLOAD);
    case 'ping':
      return `+PONG${CRLF}`;
    case 'subscribe':
    case 'unsubscribe': {
      // One confirmation frame per channel, each carrying the running count of
      // subscriptions — which is what ioredis uses to resolve its promise.
      const channels = args.slice(1);
      return channels
        .map((channel, index) => {
          const active = name === 'subscribe' ? index + 1 : channels.length - index - 1;
          return `*3${CRLF}${bulk(name)}${bulk(channel)}:${active}${CRLF}`;
        })
        .join('');
    }
    default:
      return `+OK${CRLF}`;
  }
}

export interface RedisStub {
  /** Pass this as REDIS_URL. The port is assigned by the OS, so tests can run in parallel. */
  readonly url: string;
  close(): Promise<void>;
}

export async function startRedisStub(): Promise<RedisStub> {
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // A client destroyed during teardown surfaces as ECONNRESET here, which is
    // the expected end of a connection rather than a failure.
    socket.on('error', () => undefined);

    // Annotated: `Buffer.alloc` narrows to Buffer<ArrayBuffer> while
    // `Buffer.concat` widens to Buffer<ArrayBufferLike>, and the two do not
    // reassign to each other under @types/node 22.
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const parsed = readCommand(buffer);
        if (!parsed) break;
        buffer = parsed.rest;
        socket.write(respond(parsed.args));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('redis stub: expected a TCP address');
  }

  return {
    url: `redis://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
