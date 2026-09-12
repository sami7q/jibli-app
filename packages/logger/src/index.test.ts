import { describe, expect, it } from 'vitest';
import { createLogger, maskPhoneForLog, truncateForLog, REDACTED_PATHS } from './index.js';

/**
 * Redaction is a data-protection control, so it is tested by reading the bytes
 * that would have been written — not by inspecting the configuration that is
 * supposed to produce them.
 *
 * The bug that prompted this file: every path was a wildcard (`*.password`),
 * and pino's `*` matches exactly one level of nesting. A top-level
 * `logger.info({ password })` was written out in full while the list looked
 * complete.
 */

/**
 * Capture what pino would write.
 *
 * pino writes to file descriptor 1 through sonic-boom, so spying on
 * `process.stdout.write` sees nothing. Replacing the destination on the
 * instance is the seam that works, and `find` is asserted so a pino rename
 * fails loudly rather than silently capturing nothing.
 */
function capture(logger: ReturnType<typeof createLogger>): string[] {
  const lines: string[] = [];
  const streamSymbol = Object.getOwnPropertySymbols(logger).find(
    (symbol) => symbol.description === 'pino.stream',
  );
  if (!streamSymbol) throw new Error('pino.stream symbol not found — pino internals changed');
  (logger as unknown as Record<symbol, unknown>)[streamSymbol] = {
    write: (line: string) => void lines.push(line),
  };
  return lines;
}

function newLogger(): ReturnType<typeof createLogger> {
  return createLogger({ serviceName: 'jibli', environment: 'test', level: 'info' });
}

describe('createLogger() redaction', () => {
  it('redacts a secret at the top level', () => {
    const logger = newLogger();
    const lines = capture(logger);

    logger.info({ password: 'hunter2', otp: '4821', accessToken: 'eyJhbGci' }, 'top level');

    const output = lines.join('');
    expect(output).toContain('top level');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('4821');
    expect(output).not.toContain('eyJhbGci');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts a secret nested one level down', () => {
    const logger = newLogger();
    const lines = capture(logger);

    logger.info({ user: { id: 'usr_1', phoneE164: '+9647701234567' } }, 'nested');

    const output = lines.join('');
    expect(output).toContain('usr_1');
    expect(output).not.toContain('+9647701234567');
  });

  it('redacts credentials carried on the request', () => {
    const logger = newLogger();
    const lines = capture(logger);

    logger.info(
      { req: { headers: { authorization: 'Bearer secret-token', cookie: 'jibli_session=abc' } } },
      'request',
    );

    const output = lines.join('');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('jibli_session=abc');
  });

  it('leaves ordinary fields alone', () => {
    const logger = newLogger();
    const lines = capture(logger);

    logger.info({ event: 'order.created', orderId: 'ord_42', totalIqd: 15_000 }, 'ordinary');

    const output = lines.join('');
    expect(output).toContain('order.created');
    expect(output).toContain('ord_42');
    expect(output).toContain('15000');
  });

  it('covers every sensitive key at both depths pino can express', () => {
    /*
     * A list that drifts is worse than no list: it reads as complete. This
     * pins the invariant that each key appears bare *and* wildcarded, which is
     * exactly what the original list got wrong.
     */
    const bare = REDACTED_PATHS.filter((path) => !path.includes('.'));
    expect(bare.length).toBeGreaterThan(0);
    for (const key of bare) {
      expect(REDACTED_PATHS).toContain(`*.${key}`);
    }
  });
});

describe('maskPhoneForLog()', () => {
  it('keeps the country and operator prefix and hides the subscriber', () => {
    expect(maskPhoneForLog('+9647701234567')).toBe('+96477***67');
  });

  it('refuses to half-mask something too short to mask', () => {
    expect(maskPhoneForLog('+964')).toBe('[REDACTED]');
  });
});

describe('truncateForLog()', () => {
  it('passes short text through untouched', () => {
    expect(truncateForLog('a note')).toBe('a note');
  });

  it('caps long text so one note cannot flood storage', () => {
    expect(truncateForLog('x'.repeat(500))).toHaveLength(201);
  });
});
