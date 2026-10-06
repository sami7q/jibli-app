import { describe, expect, it, vi } from 'vitest';
import { ConsolePushProvider, ExpoPushProvider, createPushProvider } from './index.js';

/**
 * The guard on provider selection.
 *
 * The bug this file exists for: the worker constructed `ConsolePushProvider`
 * directly and never read `PUSH_PROVIDER`. The stub returns `{ok: true}` for
 * everything, so every notification was written to `notification_deliveries` as
 * SENT and nothing ever left the server — for every customer, every driver and
 * every restaurant, with no error anywhere to notice.
 *
 * A stub that reports success is the most dangerous kind of failure, so the
 * rule is asserted rather than documented: it must not be selectable in
 * production.
 */

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
} as never;

describe('createPushProvider()', () => {
  it('refuses the console stub under NODE_ENV=production', () => {
    expect(() =>
      createPushProvider({ provider: 'console', nodeEnv: 'production' }, logger),
    ).toThrow(/cannot run under NODE_ENV=production/);
  });

  it('names the setting that fixes it, because the failure is otherwise silent', () => {
    expect(() =>
      createPushProvider({ provider: 'console', nodeEnv: 'production' }, logger),
    ).toThrow(/PUSH_PROVIDER=expo/);
  });

  it.each(['development', 'test', 'local'])('allows the stub in %s', (nodeEnv) => {
    const provider = createPushProvider({ provider: 'console', nodeEnv }, logger);
    expect(provider).toBeInstanceOf(ConsolePushProvider);
    expect(provider.name).toBe('console');
  });

  it('returns the Expo provider when asked for it', () => {
    const provider = createPushProvider({ provider: 'expo', nodeEnv: 'production' }, logger);
    expect(provider).toBeInstanceOf(ExpoPushProvider);
    expect(provider.name).toBe('expo');
  });

  it('throws for fcm rather than falling back to a stub', () => {
    /*
     * `fcm` is in the config enum and has no implementation. Falling back to
     * the console provider would reproduce the original bug exactly — a
     * plausible-looking setting that silently sends nothing.
     */
    expect(() => createPushProvider({ provider: 'fcm', nodeEnv: 'production' }, logger)).toThrow(
      /no implementation/,
    );
  });
});

describe('ExpoPushProvider', () => {
  it('rejects a malformed token without calling the service', async () => {
    const provider = new ExpoPushProvider(logger);

    /*
     * Expo answers a bad token with a whole-request error rather than a
     * per-message ticket, so one stale row would otherwise cost the entire
     * batch — every other customer in it silently unnotified.
     */
    const results = await provider.sendMany([
      { token: 'not-a-token', titleAr: 'عنوان', bodyAr: 'نص' },
    ]);

    expect(results).toEqual([{ ok: false, tokenInvalid: true, error: 'INVALID_TOKEN_FORMAT' }]);
  });

  it('returns one result per message, at the caller’s index', async () => {
    const provider = new ExpoPushProvider(logger);

    /*
     * `outbox-publisher.ts` maps results back to devices *by index* to decide
     * which token to revoke. A result array that is short, reordered, or
     * missing an entry revokes a working device because a different one was
     * dead — so the shape is part of the contract, not an implementation
     * detail.
     */
    const results = await provider.sendMany([
      { token: 'bad-one', titleAr: 'أ', bodyAr: 'ب' },
      { token: 'bad-two', titleAr: 'ج', bodyAr: 'د' },
      { token: 'bad-three', titleAr: 'ه', bodyAr: 'و' },
    ]);

    expect(results).toHaveLength(3);
    for (const result of results) expect(result.ok).toBe(false);
  });

  it('is named so the worker can log which provider it chose', () => {
    expect(new ExpoPushProvider(logger).name).toBe('expo');
  });
});
