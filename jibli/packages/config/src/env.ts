import { z } from 'zod';

/**
 * Environment contract for every Jibli runtime.
 *
 * Plan §7: startup validation must reject missing mandatory secrets, and production
 * runtime database users must not be superusers. Secrets never live in Git — this
 * module only describes their shape.
 */

export const NODE_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const port = z.coerce.number().int().min(1).max(65535);

/** Secrets must be long enough to resist offline brute force. */
const secret = z.string().min(32, 'secret must be at least 32 characters');

const baseSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  APP_ENV: z.enum(['local', 'development', 'staging', 'production', 'demo']).default('local'),
  SERVICE_NAME: z.string().default('jibli'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Business timezone. All persisted timestamps stay UTC (plan §4.8). */
  BUSINESS_TIMEZONE: z.string().default('Asia/Baghdad'),

  DATABASE_URL: z.string().url(),
  /** Separate, more privileged credential used only by migrations (plan §7). */
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: booleanish.default(false),

  REDIS_URL: z.string().url(),
  REDIS_NAMESPACE: z.string().default('jibli:local'),
});

const authSchema = z.object({
  /** Signs short-lived access tokens. */
  JWT_ACCESS_SECRET: secret,
  /** Signs rotating refresh tokens. Must differ from the access secret. */
  JWT_REFRESH_SECRET: secret,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(60 * 60 * 24 * 30),
  /** Pepper for hashing OTP codes and delivery PINs at rest. */
  OTP_HASH_PEPPER: secret,
  SESSION_COOKIE_NAME: z.string().default('jibli_session'),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
});

const otpSchema = z.object({
  OTP_PROVIDER: z.enum(['console', 'mock', 'sms_gateway']).default('console'),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(4),
  OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).default(45),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  OTP_MAX_PER_PHONE_HOUR: z.coerce.number().int().min(1).default(5),
  OTP_MAX_PER_PHONE_DAY: z.coerce.number().int().min(1).default(15),
  OTP_MAX_PER_IP_HOUR: z.coerce.number().int().min(1).default(30),
  SMS_GATEWAY_URL: z.string().url().optional(),
  SMS_GATEWAY_API_KEY: z.string().optional(),
  SMS_GATEWAY_SENDER_ID: z.string().optional(),
  /**
   * Staging safety valve: comma-separated E.164 allowlist. When set, OTP delivery to
   * any other number is refused so staging cannot text real customers (plan §7).
   */
  OTP_PHONE_ALLOWLIST: z.string().optional(),
});

const storageSchema = z.object({
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_PUBLIC_BUCKET: z.string().default('jibli-public'),
  S3_PRIVATE_BUCKET: z.string().default('jibli-private'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(true),
  CDN_PUBLIC_BASE_URL: z.string().url().optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),
});

const apiSchema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: port.default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** Comma-separated browser origins allowed to send credentialed requests. */
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  TRUST_PROXY: booleanish.default(false),
  RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().default(300),
  REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().default(1024 * 1024),
});

const observabilitySchema = z.object({
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  METRICS_ENABLED: booleanish.default(true),
});

const notificationsSchema = z.object({
  PUSH_PROVIDER: z.enum(['console', 'expo', 'fcm']).default('console'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  FCM_PROJECT_ID: z.string().optional(),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
});

const workerSchema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  SETTLEMENT_CRON: z.string().default('0 2 * * *'),
  RECONCILIATION_CRON: z.string().default('30 2 * * *'),
});

export const apiEnvSchema = baseSchema
  .merge(authSchema)
  .merge(otpSchema)
  .merge(storageSchema)
  .merge(apiSchema)
  .merge(observabilitySchema)
  .merge(notificationsSchema)
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }
    if (env.APP_ENV === 'production') {
      if (env.OTP_PROVIDER !== 'sms_gateway') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_PROVIDER'],
          message: 'production requires a real OTP provider',
        });
      }
      if (env.PUSH_PROVIDER === 'console') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PUSH_PROVIDER'],
          message: 'production requires a real push provider',
        });
      }
      if (!env.DATABASE_SSL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_SSL'],
          message: 'production database connections must use TLS',
        });
      }
      if (env.CORS_ALLOWED_ORIGINS.includes('localhost')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ALLOWED_ORIGINS'],
          message: 'production CORS must not allow localhost origins',
        });
      }
    }
    if (env.OTP_PROVIDER === 'sms_gateway' && (!env.SMS_GATEWAY_URL || !env.SMS_GATEWAY_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_GATEWAY_URL'],
        message: 'sms_gateway provider requires SMS_GATEWAY_URL and SMS_GATEWAY_API_KEY',
      });
    }
  });

export const workerEnvSchema = baseSchema
  .merge(authSchema)
  .merge(storageSchema)
  .merge(observabilitySchema)
  .merge(notificationsSchema)
  .merge(workerSchema);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const detail = issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    super(`Invalid environment configuration:\n${detail}`);
    this.name = 'EnvValidationError';
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) throw new EnvValidationError(result.error.issues);
  return result.data;
}

/** Fail fast at process start rather than at the first request that needs a secret. */
export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return parse(apiEnvSchema, source);
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parse(workerEnvSchema, source);
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
