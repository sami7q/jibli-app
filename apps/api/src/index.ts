import { loadApiEnv, EnvValidationError, type ApiEnv } from '@jibli/config';
import { createLogger, type Logger } from '@jibli/logger';
import { closeDatabase, getDatabase } from '@jibli/db';
import {
  AllowlistSmsProvider,
  ConsolePushProvider,
  ConsoleSmsProvider,
  HttpSmsGatewayProvider,
  type SmsProvider,
} from '@jibli/notifications';
import { createRedis, type AppContext } from './lib/context.js';
import { buildServer } from './server.js';

/**
 * API entrypoint.
 *
 * Startup order matters: environment validation runs before anything connects,
 * so a missing secret fails the deploy rather than the first request that needs
 * it (plan §7).
 */

/**
 * Which SMS provider this deployment uses.
 *
 * `console` logs that a code was issued and, in local development only, the
 * code itself — so a developer can sign in without a gateway. `sms_gateway` is
 * the real thing, and production refuses to boot on anything else.
 *
 * A non-production deployment with an allowlist configured is wrapped in one,
 * so staging can be pointed at a live gateway to prove the integration without
 * being able to text a real customer (plan §7).
 */
function buildSmsProvider(env: ApiEnv, logger: Logger): SmsProvider {
  const base: SmsProvider =
    env.OTP_PROVIDER === 'sms_gateway'
      ? new HttpSmsGatewayProvider(logger, {
          // The env schema refuses to validate `sms_gateway` without these two.
          url: env.SMS_GATEWAY_URL as string,
          apiKey: env.SMS_GATEWAY_API_KEY as string,
          senderId: env.SMS_GATEWAY_SENDER_ID,
          authScheme: env.SMS_GATEWAY_AUTH_SCHEME,
          apiKeyHeader: env.SMS_GATEWAY_API_KEY_HEADER,
          apiKeyField: env.SMS_GATEWAY_API_KEY_FIELD,
          toField: env.SMS_GATEWAY_TO_FIELD,
          bodyField: env.SMS_GATEWAY_BODY_FIELD,
          senderField: env.SMS_GATEWAY_SENDER_FIELD,
          timeoutMs: env.SMS_GATEWAY_TIMEOUT_MS,
        })
      : new ConsoleSmsProvider(logger, env.APP_ENV === 'local');

  const allowlist = (env.OTP_PHONE_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (env.APP_ENV !== 'production' && allowlist.length > 0) {
    logger.info(
      { event: 'sms.allowlist_active', count: allowlist.length, provider: base.name },
      'SMS restricted to the configured allowlist',
    );
    return new AllowlistSmsProvider(base, allowlist, logger);
  }

  return base;
}

async function main(): Promise<void> {
  let env;
  try {
    env = loadApiEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Printed rather than logged: the logger is not configured yet.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({
    serviceName: env.SERVICE_NAME,
    environment: env.APP_ENV,
    level: env.LOG_LEVEL,
    pretty: env.APP_ENV === 'local',
  });

  const db = getDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: env.DATABASE_POOL_MAX,
    applicationName: `${env.SERVICE_NAME}-api`,
  });

  const redis = createRedis(env, logger);

  /*
   * The real client is lazy and must be told to connect. The in-process
   * substitute is already connected when it is constructed and answers a
   * second request by throwing — which is not a failure, it is the state we
   * wanted. Everything else still stops the boot.
   */
  await redis.connect().catch((error: Error) => {
    if (/already connect/i.test(error.message)) return;
    logger.error({ err: error.message }, 'Failed to connect to Redis at startup');
    throw error;
  });

  const sms = buildSmsProvider(env, logger);
  const push = new ConsolePushProvider(logger);

  const ctx: AppContext = { env, db, redis, logger, sms, push };
  const { app, realtime } = await buildServer(ctx);

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests
   * finish, then close the pools. A transaction killed mid-flight would be
   * rolled back, but the client would never learn the outcome.
   */
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'shutdown.begin', signal }, 'Shutting down');
    try {
      // Close sockets before the HTTP server so clients get a clean 1001.
      await realtime.close();
      await app.close();
      await redis.quit();
      await closeDatabase();
      logger.info({ event: 'shutdown.complete' }, 'Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ event: 'shutdown.failed', err: String(error) }, 'Shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ event: 'unhandled_rejection', reason: String(reason) }, 'Unhandled rejection');
  });

  await app.listen({ host: env.API_HOST, port: env.API_PORT });

  logger.info(
    { event: 'server.started', port: env.API_PORT, environment: env.APP_ENV },
    `Jibli API listening on ${env.API_HOST}:${env.API_PORT}`,
  );
}

main().catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
