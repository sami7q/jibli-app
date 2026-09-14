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

  /**
   * Redis, or `memory://` for a single-process development run.
   *
   * The URL says which: `memory://local` runs an in-process substitute so the
   * API starts on a machine with no Docker and no Redis, which is what a
   * developer on Windows usually has. It is refused in production below —
   * rate-limit counters and the realtime channel that only one process can see
   * are not rate limiting and not realtime.
   */
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
  OTP_PROVIDER: z.enum(['console', 'mock', 'sms_gateway', 'whatsapp']).default('console'),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(4),
  OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).default(45),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  OTP_MAX_PER_PHONE_HOUR: z.coerce.number().int().min(1).default(5),
  OTP_MAX_PER_PHONE_DAY: z.coerce.number().int().min(1).default(15),
  OTP_MAX_PER_IP_HOUR: z.coerce.number().int().min(1).default(30),
  /**
   * The fixed code the `mock` provider issues.
   *
   * Testing only — any phone number signs in with it, and everything else
   * about the challenge (expiry, attempt counting, rate limits) behaves
   * exactly as in production. The env schema refuses `mock` in production.
   */
  /**
   * Google client ids allowed to sign into this backend.
   *
   * Comma-separated, because iOS, Android and web are three different ids for
   * the same application and all three are legitimate audiences. Leave it
   * empty and Google sign-in is simply off — the endpoint refuses rather than
   * accepting a token minted for somebody else's app.
   */
  GOOGLE_CLIENT_IDS: z.string().optional(),
  OTP_MOCK_CODE: z.string().regex(/^\d{4,8}$/).default('0000'),
  /**
   * Numbers that receive `OTP_MOCK_CODE` instead of a random one.
   *
   * `OTP_PROVIDER=mock` opens *every* number, which is right on a laptop and
   * wrong for a deployment anyone can reach — a public URL where 0000 signs in
   * as any Iraqi number is an open door. This is the same mechanism narrowed to
   * a list: a demo account can sign in, nobody else's number can.
   *
   * Comma-separated E.164. Everything else about the challenge is unchanged —
   * stored, hashed, expired, attempt-counted and rate-limited exactly as in
   * production — and the code is returned in the response for these numbers
   * only, because it is already a constant that the tester was told.
   *
   * Refused in production by the schema below.
   */
  OTP_TEST_PHONES: z.string().optional(),
  SMS_GATEWAY_URL: z.string().url().optional(),
  SMS_GATEWAY_API_KEY: z.string().optional(),
  SMS_GATEWAY_SENDER_ID: z.string().optional(),
  /*
   * How this particular gateway is shaped.
   *
   * Iraqi OTP traffic is bought from local aggregators, and every one of them
   * posts the same three values under different names with the key in a
   * different place. Rather than a provider class per vendor — each a copy of
   * the last with three strings changed — the names are configuration and the
   * behaviour that matters (timeout, one retry, never logging the body) is not.
   */
  SMS_GATEWAY_AUTH_SCHEME: z.enum(['bearer', 'header', 'body']).default('bearer'),
  SMS_GATEWAY_API_KEY_HEADER: z.string().optional(),
  SMS_GATEWAY_API_KEY_FIELD: z.string().optional(),
  SMS_GATEWAY_TO_FIELD: z.string().optional(),
  SMS_GATEWAY_BODY_FIELD: z.string().optional(),
  SMS_GATEWAY_SENDER_FIELD: z.string().optional(),
  SMS_GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),

  /*
   * The four settings that decide whether a real Iraqi aggregator works.
   *
   * Everything above describes what to call a field. These describe the shape
   * of the call itself, and each corresponds to a way the integration fails
   * silently rather than loudly — which is the only kind of failure that
   * matters for a code somebody is waiting on.
   */
  /**
   * How the number is written: `+9647701234567`, `9647701234567`, or the
   * national `07701234567` the customer would dial. The commonest reason a
   * correctly-configured gateway accepts every request and delivers nothing.
   */
  SMS_GATEWAY_NUMBER_FORMAT: z.enum(['e164', 'e164_no_plus', 'national']).default('e164'),
  /** Roughly a third of this market is a GET endpoint with the message in the query. */
  SMS_GATEWAY_METHOD: z.enum(['POST', 'GET']).default('POST'),
  SMS_GATEWAY_ENCODING: z.enum(['json', 'form']).default('json'),
  /**
   * Vendor constants, as JSON: `{"type":"unicode","route":"4"}`.
   *
   * Arabic needs one of these on most gateways, and without it the message
   * arrives as question marks — a failure nobody notices until a customer says
   * the code made no sense.
   */
  SMS_GATEWAY_EXTRA_FIELDS: z.string().optional(),
  /**
   * What a successful body looks like, for the gateways that answer 200 with
   * an error inside. Leave unset and any 2xx counts as sent, which is the
   * behaviour this had before the option existed.
   */
  /**
   * Whether the body field carries the message or only the code.
   *
   * `code` is what makes OTPIQ's `smsType=verification` work, and with it
   * WhatsApp — which refuses free text from a business and carries only an
   * approved template. The vendor owns the wording in that mode; what it buys
   * is a channel at a fraction of the price of SMS.
   */
  SMS_GATEWAY_BODY_MODE: z.enum(['text', 'code']).default('text'),
  SMS_GATEWAY_SUCCESS_FIELD: z.string().optional(),
  SMS_GATEWAY_SUCCESS_VALUE: z.string().optional(),
  /**
   * Where the gateway returns the id it gave the message — `smsId` on OTPIQ,
   * `data.messageId` on the ones that use an envelope. Guessed from the usual
   * names when unset; an unmatched id costs a delivery report, not a send.
   */
  SMS_GATEWAY_MESSAGE_ID_FIELD: z.string().optional(),

  /*
   * WhatsApp, through Meta's Cloud API.
   *
   * The delivery channel an Iraqi customer actually reads. An SMS aggregator
   * here means a contract, a per-message price and three networks that deliver
   * unevenly; an authentication template costs a fraction of that and lands in
   * an app that is already open.
   *
   * None of these is a field name to be guessed at — every one comes from the
   * WhatsApp Manager, and the schema refuses the provider without them rather
   * than letting a deployment boot and fail at the first sign-in.
   */
  /** From WhatsApp Manager. The sender's id, not its phone number. */
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  /**
   * A permanent System User token.
   *
   * The temporary one the dashboard offers first lasts 24 hours, and a token
   * that expires overnight means nobody can sign in the next morning.
   */
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  /** The approved AUTHENTICATION template. Utility and marketing are refused. */
  WHATSAPP_TEMPLATE_NAME: z.string().default('otp_code'),
  /** Exactly as registered — `ar`, `ar_EG`, `en_US`. A near-miss is 132001. */
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('ar'),
  /**
   * Whether the template has a copy-code button.
   *
   * Meta's authentication templates almost always do, and the button needs the
   * code as its own parameter. Default true, because the default template does.
   */
  WHATSAPP_HAS_COPY_BUTTON: booleanish.default(true),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
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

/**
 * The port a container host assigns.
 *
 * Render, Railway, Fly and Heroku all inject PORT and route to whatever the
 * process binds. A service that ignores it binds to 4000, receives no traffic,
 * and fails its health check — with logs that say the server started happily.
 *
 * API_PORT still wins when set explicitly, so local development and
 * docker-compose are unaffected.
 */
const hostAssignedPort = process.env.PORT ? Number(process.env.PORT) : 4000;

const apiSchema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: port.default(hostAssignedPort),
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
      if (env.REDIS_URL.startsWith('memory:')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message:
            'production requires a real Redis: an in-process cache cannot rate limit across instances',
        });
      }
      if (env.OTP_PROVIDER !== 'sms_gateway' && env.OTP_PROVIDER !== 'whatsapp') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_PROVIDER'],
          message: 'production requires a real OTP provider: sms_gateway or whatsapp',
        });
      }
      if (env.PUSH_PROVIDER === 'console') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PUSH_PROVIDER'],
          message: 'production requires a real push provider',
        });
      }
      if (env.OTP_TEST_PHONES && env.OTP_TEST_PHONES.trim() !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_TEST_PHONES'],
          message: 'production must not carry fixed-code test numbers',
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

    /*
     * Checked at boot, because the alternative is a runtime throw inside the
     * one code path a customer is waiting on.
     */
    if (env.SMS_GATEWAY_EXTRA_FIELDS) {
      try {
        const parsed: unknown = JSON.parse(env.SMS_GATEWAY_EXTRA_FIELDS);
        const flat =
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          Object.values(parsed).every((value) => typeof value === 'string');
        if (!flat) throw new Error('not a flat string map');
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMS_GATEWAY_EXTRA_FIELDS'],
          message: 'must be a JSON object of string values, e.g. {"type":"unicode"}',
        });
      }
    }

    /*
     * Refused at boot rather than at the first sign-in.
     *
     * A deployment missing one of these starts happily, serves every other
     * route, and fails only when a customer tries to get in — which is the
     * worst possible moment to discover a configuration mistake.
     */
    if (
      env.OTP_PROVIDER === 'whatsapp' &&
      (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_PHONE_NUMBER_ID'],
        message: 'whatsapp provider requires WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN',
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
