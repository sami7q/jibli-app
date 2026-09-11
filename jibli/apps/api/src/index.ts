import { loadApiEnv, EnvValidationError } from '@jibli/config';
import { createLogger } from '@jibli/logger';
import { closeDatabase, getDatabase } from '@jibli/db';
import { ConsolePushProvider, ConsoleSmsProvider } from '@jibli/notifications';
import { createRedis, type AppContext } from './lib/context.js';
import { buildServer } from './server.js';

/**
 * API entrypoint.
 *
 * Startup order matters: environment validation runs before anything connects,
 * so a missing secret fails the deploy rather than the first request that needs
 * it (plan §7).
 */

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
    ssl: env.DATABASE_SSL,
    applicationName: `${env.SERVICE_NAME}-api`,
  });

  const redis = createRedis(env, logger);
  await redis.connect().catch((error: Error) => {
    logger.error({ err: error.message }, 'Failed to connect to Redis at startup');
    throw error;
  });

  // In local development the console provider prints the OTP so a developer can
  // sign in without an SMS gateway. It never does so in any other environment.
  const sms = new ConsoleSmsProvider(logger, env.APP_ENV === 'local');
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
