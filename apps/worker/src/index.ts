import { EnvValidationError, loadWorkerEnv } from '@jibli/config';
import { createLogger } from '@jibli/logger';
import { closeDatabase, getDatabase } from '@jibli/db';
import { ConsolePushProvider } from '@jibli/notifications';
import { purgeExpiredIdempotencyKeys } from '@jibli/domain';
import { createWorkerRedis, type WorkerContext } from './context.js';
import { runOutboxPublisher } from './jobs/outbox-publisher.js';
import {
  runOverdueEvaluation,
  runSettlementGeneration,
} from './jobs/settlement-generation.js';
import { runDailyReconciliation, runGeographyIntegrityCheck } from './jobs/reconciliation.js';
import { purgeExpiredLocks } from './jobs/job-lock.js';

/**
 * Worker process (plan §93, §94).
 *
 * Runs the outbox publisher continuously and the scheduled finance and
 * maintenance jobs on their own cadences. Kept deliberately separate from the
 * API so a slow settlement run cannot delay an order.
 */

interface ScheduledJob {
  readonly name: string;
  readonly intervalMs: number;
  readonly run: (ctx: WorkerContext) => Promise<unknown>;
}

const SCHEDULED_JOBS: ScheduledJob[] = [
  {
    name: 'settlement_generation',
    // Hourly: the job itself settles only a closed period, and the unique index
    // makes a redundant run a no-op, so frequency costs nothing but catches up
    // quickly after an outage.
    intervalMs: 60 * 60 * 1000,
    run: runSettlementGeneration,
  },
  {
    name: 'overdue_evaluation',
    intervalMs: 60 * 60 * 1000,
    run: runOverdueEvaluation,
  },
  {
    name: 'daily_reconciliation',
    intervalMs: 6 * 60 * 60 * 1000,
    run: runDailyReconciliation,
  },
  {
    name: 'geography_integrity',
    intervalMs: 12 * 60 * 60 * 1000,
    run: runGeographyIntegrityCheck,
  },
  {
    name: 'purge_expired_locks',
    intervalMs: 5 * 60 * 1000,
    run: purgeExpiredLocks,
  },
  {
    name: 'purge_idempotency_keys',
    intervalMs: 60 * 60 * 1000,
    run: (ctx) => purgeExpiredIdempotencyKeys(ctx.db),
  },
];

async function main(): Promise<void> {
  let env;
  try {
    env = loadWorkerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({
    serviceName: `${env.SERVICE_NAME}-worker`,
    environment: env.APP_ENV,
    level: env.LOG_LEVEL,
    pretty: env.APP_ENV === 'local',
  });

  const db = getDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL,
    applicationName: `${env.SERVICE_NAME}-worker`,
  });

  const redis = createWorkerRedis(env, logger);
  await redis.connect();

  const ctx: WorkerContext = { env, db, redis, logger, push: new ConsolePushProvider(logger) };

  let running = true;
  const timers: NodeJS.Timeout[] = [];

  /**
   * Outbox loop. Polls rather than sleeping a fixed interval when there is work,
   * so a burst of orders is drained immediately instead of one batch per tick.
   */
  const outboxLoop = async (): Promise<void> => {
    while (running) {
      try {
        const result = await runOutboxPublisher(ctx);
        if (result.claimed > 0) {
          logger.debug(
            { event: 'outbox.batch', ...result },
            `Published ${result.published}/${result.claimed} outbox events`,
          );
        }
        // Only idle when the queue was empty.
        if (result.claimed === 0) {
          await sleep(env.OUTBOX_POLL_INTERVAL_MS);
        }
      } catch (error) {
        logger.error(
          { event: 'outbox.loop_error', err: String(error) },
          'Outbox loop error; backing off',
        );
        await sleep(5_000);
      }
    }
  };

  for (const job of SCHEDULED_JOBS) {
    const tick = async (): Promise<void> => {
      if (!running) return;
      try {
        await job.run(ctx);
      } catch (error) {
        // One failing job must never take the worker down with it.
        logger.error(
          { event: 'job.failed', job: job.name, err: String(error) },
          `Scheduled job ${job.name} failed`,
        );
      }
    };
    timers.push(setInterval(() => void tick(), job.intervalMs));
    // Stagger the first run so a cold start does not fire everything at once.
    setTimeout(() => void tick(), 10_000 + Math.random() * 20_000);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'shutdown.begin', signal }, 'Worker shutting down');
    running = false;
    for (const timer of timers) clearInterval(timer);
    // Let the current outbox batch finish rather than abandoning claimed rows.
    await sleep(1_500);
    await redis.quit();
    await closeDatabase();
    logger.info({ event: 'shutdown.complete' }, 'Worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info(
    { event: 'worker.started', jobs: SCHEDULED_JOBS.map((j) => j.name) },
    'Jibli worker started',
  );

  await outboxLoop();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error('Fatal worker error:', error);
  process.exit(1);
});
