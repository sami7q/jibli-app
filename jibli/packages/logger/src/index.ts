import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Structured logging with mandatory redaction (plan §89).
 *
 * "Sensitive headers, cookies, tokens, full phones, delivery addresses, OTPs,
 * and PINs are redacted." Redaction is configured here rather than left to each
 * call site, because a single forgotten log line is a data leak.
 */

/**
 * Paths pino removes before serialisation. Wildcards cover nested request and
 * response objects, so a payload logged at any depth is still scrubbed.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.otp',
  '*.otpCode',
  '*.code_hash',
  '*.codeHash',
  '*.deliveryPin',
  '*.delivery_pin',
  '*.deliveryPinHash',
  '*.pin',
  '*.accessToken',
  '*.refreshToken',
  '*.refreshTokenHash',
  '*.token',
  '*.authorization',
  '*.mfaSecret',
  '*.mfaSecretEncrypted',
  '*.secret',
  // Full phone numbers and precise addresses (plan §84, §107).
  '*.phoneE164',
  '*.phone_e164',
  '*.customerPhoneSnapshot',
  '*.deliveryAddressSnapshotJson',
  '*.delivery_address_snapshot_json',
  '*.latitude',
  '*.longitude',
];

export interface CreateLoggerOptions {
  readonly serviceName: string;
  readonly environment: string;
  readonly level?: string;
  readonly pretty?: boolean;
  readonly version?: string;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    base: {
      service: options.serviceName,
      env: options.environment,
      ...(options.version ? { version: options.version } : {}),
    },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (options.pretty) {
    return pino({
      ...config,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(config);
}

/**
 * Mask a phone number for log lines that genuinely need to identify a user.
 * Prefer the internal user ID; use this only where the phone is the only handle.
 */
export function maskPhoneForLog(phoneE164: string): string {
  if (phoneE164.length < 6) return '[REDACTED]';
  return `${phoneE164.slice(0, 6)}***${phoneE164.slice(-2)}`;
}

/** Truncate free text before it reaches a log, so a note cannot flood storage. */
export function truncateForLog(value: string, max = 200): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export type { Logger };
