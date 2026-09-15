import { loadApiEnv, loadDotEnv, EnvValidationError, type ApiEnv } from '@jibli/config';
import { createLogger, type Logger } from '@jibli/logger';
import { closeDatabase, getDatabase } from '@jibli/db';
import {
  AllowlistSmsProvider,
  ConsolePushProvider,
  ConsoleSmsProvider,
  HttpSmsGatewayProvider,
  WhatsAppOtpProvider,
  type SmsProvider,
} from '@jibli/notifications';
import { createRedis, type AppContext } from './lib/context.js';
import { ensureSchema } from './lib/schema-guard.js';
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
  /*
   * WhatsApp first, because it is what the market reads.
   *
   * The order is not a preference between two equal things: an SMS aggregator
   * in Iraq means a contract and a per-message price across three networks
   * that deliver unevenly, and WhatsApp is already open on the phone. The SMS
   * gateway stays as the fallback it has always been — some numbers are not on
   * WhatsApp, and a business that loses those customers has chosen to.
   */
  if (env.OTP_PROVIDER === 'whatsapp') {
    return wrapWithAllowlist(
      new WhatsAppOtpProvider(logger, {
        // The env schema refuses to validate `whatsapp` without these two.
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID as string,
        accessToken: env.WHATSAPP_ACCESS_TOKEN as string,
        templateName: env.WHATSAPP_TEMPLATE_NAME,
        templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
        hasCopyCodeButton: env.WHATSAPP_HAS_COPY_BUTTON,
        apiVersion: env.WHATSAPP_API_VERSION,
        timeoutMs: env.WHATSAPP_TIMEOUT_MS,
      }),
      env,
      logger,
    );
  }

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
          numberFormat: env.SMS_GATEWAY_NUMBER_FORMAT,
          method: env.SMS_GATEWAY_METHOD,
          encoding: env.SMS_GATEWAY_ENCODING,
          // Validated at boot by the env schema, so this parse cannot throw
          // inside the one code path a customer is waiting on.
          extraFields: env.SMS_GATEWAY_EXTRA_FIELDS
            ? (JSON.parse(env.SMS_GATEWAY_EXTRA_FIELDS) as Record<string, string>)
            : undefined,
          bodyMode: env.SMS_GATEWAY_BODY_MODE,
          successField: env.SMS_GATEWAY_SUCCESS_FIELD,
          successValue: env.SMS_GATEWAY_SUCCESS_VALUE,
          messageIdField: env.SMS_GATEWAY_MESSAGE_ID_FIELD,
        })
      : new ConsoleSmsProvider(logger, env.APP_ENV === 'local');

  return wrapWithAllowlist(base, env, logger);
}

/**
 * The staging safety valve, applied to whichever provider was chosen.
 *
 * Lifted out when WhatsApp joined: a second provider meant a second copy of
 * this, and a copy is exactly how one of the two ends up able to message a
 * real customer from a staging box.
 */
function wrapWithAllowlist(base: SmsProvider, env: ApiEnv, logger: Logger): SmsProvider {
  const allowlist = (env.OTP_PHONE_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (env.APP_ENV !== 'production' && allowlist.length > 0) {
    logger.info(
      { event: 'sms.allowlist_active', count: allowlist.length, provider: base.name },
      'OTP delivery restricted to the configured allowlist',
    );
    return new AllowlistSmsProvider(base, allowlist, logger);
  }

  return base;
}

async function main(): Promise<void> {
  /*
   * A `.env` on a laptop, and nothing in production.
   *
   * Before this, the only way to configure a local API was to export every
   * variable into the shell first, so in practice the API ran on defaults —
   * and the default OTP provider logs that a code was issued and sends
   * nothing. Sign-in appears to work all the way to the countdown and no
   * message ever arrives, which is the hardest kind of failure to find because
   * every part of it is behaving as designed.
   *
   * Real environment variables still win, so this cannot change a deployment.
   */
  const dotenv = loadDotEnv();

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

  // Which file, and how many values — so a stale `.env` shadowing the shell is
  // visible in the first lines of the log rather than inferred hours later.
  if (dotenv.path) {
    logger.info(
      { event: 'env.dotenv_loaded', path: dotenv.path, count: dotenv.loaded },
      'Loaded environment from .env',
    );
  }

  /*
   * The provider is stated at boot, every boot.
   *
   * `console` is a working, deliberate setting — and it is also what a
   * misconfigured deployment falls back to, where it generates codes nobody
   * can receive while every request returns success. One line removes the
   * ambiguity.
   */
  logger.info(
    { event: 'otp.provider', provider: env.OTP_PROVIDER },
    env.OTP_PROVIDER === 'console' || env.OTP_PROVIDER === 'mock'
      ? `OTP provider is "${env.OTP_PROVIDER}" — no message will reach a real phone`
      : `OTP provider is "${env.OTP_PROVIDER}"`,
  );

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

  /*
   * Before anything is served: is this database the one this build expects?
   *
   * Placed here rather than inside a health check because the answer decides
   * what the whole process can do, and because a deployment is the moment
   * somebody is watching the log.
   */
  const schema = await ensureSchema(env, logger);

  const sms = buildSmsProvider(env, logger);
  const push = new ConsolePushProvider(logger);

  const ctx: AppContext = { env, db, redis, logger, sms, push, schema };
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
