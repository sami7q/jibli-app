import { afterEach, describe, expect, it } from 'vitest';
import { loadApiEnv } from '@jibli/config';
import { createLogger } from '@jibli/logger';
import { getDatabase } from '@jibli/db';
import { ConsolePushProvider, ConsoleSmsProvider } from '@jibli/notifications';
import { createRedis, type AppContext } from './lib/context.js';
import { buildServer } from './server.js';
import { startRedisStub, type RedisStub } from './testing/redis-stub.js';

/**
 * The server has to be *assembled* by a test, not merely type-checked.
 *
 * The bug this file exists to prevent reached production. `buildServer` handed
 * our pino instance to Fastify's `logger` option; Fastify 5 accepts only
 * options there, an instance belongs in `loggerInstance`, and it threw
 * FST_ERR_LOG_INVALID_LOGGER_CONFIG on the first line of boot. The container
 * exited with status 1 having never listened.
 *
 * `tsc --noEmit` passed throughout, and was right to: pino's `Logger` is
 * structurally assignable to `PinoLoggerOptions`, whose every field is
 * optional. No type could have caught this. Only running it could — and until
 * now, nothing ran it: `buildServer` had no test at all.
 *
 * Nothing here reaches a real service. The pg pool never connects because no
 * route queries during assembly, and Redis is the stub next door.
 */

interface Harness {
  readonly ctx: AppContext;
  teardown(): Promise<void>;
}

async function buildHarness(options: { level?: string } = {}): Promise<Harness> {
  const redisStub: RedisStub = await startRedisStub();

  const env = loadApiEnv({
    NODE_ENV: 'test',
    APP_ENV: 'staging',
    DATABASE_URL: 'postgresql://jibli:jibli@127.0.0.1:5432/jibli_test',
    REDIS_URL: redisStub.url,
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    OTP_HASH_PEPPER: 'c'.repeat(44),
    TRUST_PROXY: 'true',
  });

  const logger = createLogger({
    serviceName: env.SERVICE_NAME,
    environment: env.APP_ENV,
    level: options.level ?? 'silent',
  });

  const ctx: AppContext = {
    env,
    db: getDatabase({
      connectionString: env.DATABASE_URL,
      maxConnections: 1,
      ssl: false,
      applicationName: 'jibli-api-test',
    }),
    redis: createRedis(env, logger),
    logger,
    sms: new ConsoleSmsProvider(logger, false),
    push: new ConsolePushProvider(logger),
    // The harness builds the server directly rather than booting it, so it
    // states the schema verdict the boot sequence would have reached.
    schema: { ok: true, checked: true, pending: [], changed: [] },
  };

  return {
    ctx,
    teardown: async () => {
      ctx.redis.disconnect();
      await redisStub.close();
    },
  };
}

let active: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const dispose of active.reverse()) await dispose();
  active = [];
});

async function assemble(options: { level?: string } = {}): Promise<{
  ctx: AppContext;
  app: Awaited<ReturnType<typeof buildServer>>['app'];
}> {
  const harness = await buildHarness(options);
  active.push(harness.teardown);

  const { app, realtime } = await buildServer(harness.ctx);
  active.push(async () => {
    await realtime.close();
    await app.close();
  });

  return { ctx: harness.ctx, app };
}

describe('buildServer()', () => {
  it('assembles and reaches ready without throwing', async () => {
    const { app } = await assemble();
    await app.ready();
    expect(app.hasDecorator('ctx')).toBe(true);
  });

  it('serves liveness without touching a dependency', async () => {
    /*
     * Liveness must answer while the database is unreachable — as it is here,
     * pointed at a port with nothing behind it. A probe that queried the
     * database would restart a healthy API during a brief database blip.
     */
    const { app } = await assemble();

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('registers the routes the portals sign in through', async () => {
    /*
     * A plugin that throws during registration takes its routes with it and
     * the server still boots. Asserting the sign-in route exists is what turns
     * that silent outcome into a failing test.
     */
    const { app } = await assemble();
    await app.ready();

    expect(app.hasRoute({ method: 'POST', url: '/api/v1/auth/login' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/api/v1/auth/session/refresh' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/health/ready' })).toBe(true);

    /*
     * Push registration is not under /driver. The customer app needs it for
     * "your order was accepted" exactly as the driver app needs it for a new
     * assignment, and the table is keyed on the user either way.
     */
    expect(app.hasRoute({ method: 'POST', url: '/api/v1/devices' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/api/v1/driver/devices' })).toBe(false);
  });

  it('keeps redacting through the logger Fastify derives from ours', async () => {
    /*
     * Why `loggerInstance` is not interchangeable with `logger` options: the
     * redaction paths live on our pino instance, and Fastify logs through a
     * *child* of it (`prevLogger.child({}, opts)` in lib/logger-pino.js).
     * Children inherit redaction — but a logger Fastify built for itself would
     * have none, and every request line would carry tokens and phone numbers
     * in full.
     *
     * So this asserts on output, not on object identity: identity would pass
     * for a child that had quietly lost its redaction.
     */
    const { ctx, app } = await assemble({ level: 'info' });
    await app.ready();

    /*
     * Redirect the destination rather than spying on process.stdout: pino
     * writes to file descriptor 1 through sonic-boom, so nothing passes
     * through process.stdout.write. The child Fastify derives does not own a
     * stream of its own — it inherits this one down the prototype chain, which
     * is itself the thing being asserted.
     */
    const written: string[] = [];
    const capture = { write: (line: string) => void written.push(line) };

    /*
     * The symbol is read off the instance rather than imported: pino is a
     * dependency of @jibli/logger, not of the API, and adding one so a test
     * can name a symbol is the wrong trade. `find` returning nothing is
     * asserted, so a pino rename fails here loudly instead of silently
     * capturing no output and passing.
     */
    const streamSymbol = Object.getOwnPropertySymbols(ctx.logger).find(
      (symbol) => symbol.description === 'pino.stream',
    );
    expect(streamSymbol).toBeDefined();
    (ctx.logger as unknown as Record<symbol, unknown>)[streamSymbol!] = capture;

    app.log.info({ password: 'hunter2', otp: '4821', phoneE164: '+9647701234567' }, 'probe');

    const output = written.join('');
    expect(output).toContain('probe');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('4821');
    expect(output).not.toContain('+9647701234567');
    expect(output).toContain('[REDACTED]');
  });
});
