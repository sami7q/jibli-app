import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpSmsGatewayProvider } from './index.js';

/**
 * The gateway's three rules, all of which cost something when broken.
 *
 * Retrying a rejection costs money and can get a sender id blocked. Not
 * retrying a timeout costs a customer who cannot sign in at all. And logging
 * the body puts an OTP in a log file, which is the thing the plan forbids in
 * the strongest terms (§10).
 */

const logs: { level: string; fields: Record<string, unknown>; message: string }[] = [];

const logger = {
  info: (fields: Record<string, unknown>, message: string) =>
    logs.push({ level: 'info', fields, message }),
  error: (fields: Record<string, unknown>, message: string) =>
    logs.push({ level: 'error', fields, message }),
  warn: (fields: Record<string, unknown>, message: string) =>
    logs.push({ level: 'warn', fields, message }),
} as unknown as Parameters<typeof HttpSmsGatewayProvider.prototype.send> extends never
  ? never
  : ConstructorParameters<typeof HttpSmsGatewayProvider>[0];

function provider(overrides: Record<string, unknown> = {}) {
  return new HttpSmsGatewayProvider(logger, {
    url: 'https://gateway.test/send',
    apiKey: 'secret-key',
    senderId: 'JIBLI',
    ...overrides,
  });
}

const MESSAGE = { toE164: '+9647701234567', body: 'رمز التحقق: 4821' };

afterEach(() => {
  logs.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sending', () => {
  it('posts the number and the body, and carries the key as a bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response('{"message_id":"abc"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe('abc');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.test/send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');

    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.to).toBe('+9647701234567');
    expect(body.message).toBe('رمز التحقق: 4821');
    expect(body.sender).toBe('JIBLI');
  });

  it('renames the fields the gateway asks for', async () => {
    // No two Iraqi aggregators agree on these, which is why they are config.
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await provider({
      toField: 'mobile',
      bodyField: 'text',
      senderField: 'from',
      authScheme: 'header',
      apiKeyHeader: 'X-Token',
    }).send(MESSAGE);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.mobile).toBe('+9647701234567');
    expect(body.text).toBe('رمز التحقق: 4821');
    expect(body.from).toBe('JIBLI');
    expect((init.headers as Record<string, string>)['X-Token']).toBe('secret-key');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('succeeds even when the gateway answers with something other than JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('OK', { status: 200 })));
    await expect(provider().send(MESSAGE)).resolves.toMatchObject({ ok: true });
  });
});

describe('failure', () => {
  it('does not retry a rejection', async () => {
    /*
     * A 4xx is the gateway saying the number is malformed or the account is
     * out of credit. Sending it again cannot change that, costs a second
     * message, and repeated rejections are how a sender id gets blocked.
     */
    const fetchMock = vi.fn(async () => new Response('{"error":"no credit"}', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP_402');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a server error once, and succeeds if the second attempt works', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"id":"second"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe('second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a dead connection, then gives up rather than looping', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('what reaches the log', () => {
  it('never logs the message body, and masks the number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));

    await provider().send(MESSAGE);

    const serialised = JSON.stringify(logs);
    // The code itself, and the text carrying it.
    expect(serialised).not.toContain('4821');
    expect(serialised).not.toContain('رمز التحقق');
    // The number is identifiable enough to debug with, not enough to dial.
    expect(serialised).not.toContain('+9647701234567');
    expect(serialised).toContain('+96477***');
  });

  it('does not log the API key when the gateway refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));

    await provider().send(MESSAGE);

    expect(JSON.stringify(logs)).not.toContain('secret-key');
  });
});
