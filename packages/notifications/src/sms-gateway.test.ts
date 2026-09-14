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
    // The status alone could not be acted on; the reason can.
    expect(result.error).toBe('HTTP_402: no credit');
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


/*
 * The settings that decide whether a real Iraqi aggregator works.
 *
 * Every one of these corresponds to a way the integration fails quietly rather
 * than loudly: the gateway accepts the request, answers 200, bills for it, and
 * the customer's phone stays silent. A suite that only proves a well-formed
 * POST is well-formed would pass against all of them.
 */
describe('the shape of the call', () => {
  async function capture(overrides: Record<string, unknown>) {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await provider(overrides).send(MESSAGE);
    return fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  }

  describe('how the number is written', () => {
    it('sends E.164 with the plus by default', async () => {
      const [, init] = await capture({});
      expect(JSON.parse(init.body as string).to).toBe('+9647701234567');
    });

    it('drops the plus when the gateway rejects it', async () => {
      const [, init] = await capture({ numberFormat: 'e164_no_plus' });
      expect(JSON.parse(init.body as string).to).toBe('9647701234567');
    });

    it('restores the trunk zero for a gateway that wants the national form', async () => {
      // The same number as the customer would dial it: 0770 123 4567.
      const [, init] = await capture({ numberFormat: 'national' });
      expect(JSON.parse(init.body as string).to).toBe('07701234567');
    });
  });

  describe('how the request is carried', () => {
    it('puts everything in the query for a GET gateway', async () => {
      const [url, init] = await capture({ method: 'GET' });

      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();

      const params = new URL(url).searchParams;
      expect(params.get('to')).toBe('+9647701234567');
      // Percent-encoded on the wire, Arabic again once parsed - which is the
      // whole reason the query is built by URLSearchParams.
      expect(params.get('message')).toBe(MESSAGE.body);
    });

    it('joins with & when the gateway URL already carries its own parameters', async () => {
      /*
       * A second `?` collapses the query into one unparseable parameter, and
       * the gateway then rejects a field that was sent correctly.
       */
      const [url] = await capture({
        method: 'GET',
        url: 'https://gateway.test/send?account=12345',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('account')).toBe('12345');
      expect(parsed.searchParams.get('to')).toBe('+9647701234567');
    });

    it('form-encodes when the gateway does not take JSON', async () => {
      const [, init] = await capture({ encoding: 'form' });

      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      const body = new URLSearchParams(init.body as string);
      expect(body.get('message')).toBe(MESSAGE.body);
    });
  });

  it('carries the vendor own constants, and lets them win a name collision', async () => {
    /*
     * `type=unicode` and its equivalents are the difference between an Arabic
     * message arriving and arriving as question marks - a failure nobody
     * notices until a customer says the code made no sense.
     */
    const [, init] = await capture({
      extraFields: { smsType: 'custom', type: 'unicode', sender: 'FROM_VENDOR' },
    });

    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.smsType).toBe('custom');
    expect(body.type).toBe('unicode');
    // The vendor value, not the senderId this provider would have defaulted to.
    expect(body.sender).toBe('FROM_VENDOR');
  });
});

describe('a refusal dressed as a 200', () => {
  /*
   * The worst failure this class can have. The gateway answers OK with an
   * error inside, the provider records a successful send, and the customer
   * waits for a code that was never dispatched while the log says everything
   * worked.
   */
  it('fails the send when the body says it failed', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"status":"ERR_NO_CREDIT"}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider({ successField: 'status', successValue: 'OK' }).send(MESSAGE);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ERR_NO_CREDIT');
    // Permanent: no credit is not a bad minute, and a retry costs a message.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts the send when the body says it succeeded, whatever the case', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":"ok"}', { status: 200 })));

    await expect(
      provider({ successField: 'status', successValue: 'OK' }).send(MESSAGE),
    ).resolves.toMatchObject({ ok: true });
  });

  it('reads a status buried in an envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"data":{"state":"sent"}}', { status: 200 })),
    );

    await expect(
      provider({ successField: 'data.state', successValue: 'sent' }).send(MESSAGE),
    ).resolves.toMatchObject({ ok: true });
  });

  it('leaves an unconfigured gateway alone', async () => {
    // No successField: any 2xx counts, which is what this did before the
    // option existed and is the only safe default for an unknown vendor.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"status":"whatever"}', { status: 200 })),
    );
    await expect(provider().send(MESSAGE)).resolves.toMatchObject({ ok: true });
  });
});

describe('the id the gateway assigns', () => {
  it('finds it under the name the gateway was told to use', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"data":{"reference":"ref-99"}}', { status: 200 })),
    );

    const result = await provider({ messageIdField: 'data.reference' }).send(MESSAGE);
    expect(result.providerMessageId).toBe('ref-99');
  });

  it('finds the OTPIQ smsId without being told', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"smsId":"sms-123","cost":200}', { status: 200 })),
    );

    const result = await provider().send(MESSAGE);
    expect(result.providerMessageId).toBe('sms-123');
  });

  it('keeps a numeric id, which is still an id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"messageId":8842}', { status: 200 })));

    const result = await provider().send(MESSAGE);
    expect(result.providerMessageId).toBe('8842');
  });

  it('sends successfully when the gateway returns none at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    const result = await provider().send(MESSAGE);
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBeUndefined();
  });
});

describe('why a refusal happened', () => {
  /*
   * An unapproved sender id, an exhausted balance and a malformed number are
   * three problems with three different fixes and one status code between
   * them. Without the body, a deployment can only guess which it has.
   */
  it('reports the gateway reason alongside the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"error":"Insufficient credit, please add more credit"}', { status: 400 }),
      ),
    );

    const result = await provider().send(MESSAGE);
    expect(result.error).toBe('HTTP_400: Insufficient credit, please add more credit');
  });

  it('reads the reason out of a message field too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"message":"Unauthorized, please use your project api key"}', {
            status: 401,
          }),
      ),
    );

    const result = await provider().send(MESSAGE);
    expect(result.error).toContain('Unauthorized');
  });

  it('falls back to the raw text for a gateway that does not answer JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('SENDER_ID_NOT_APPROVED', { status: 403 })),
    );

    const result = await provider().send(MESSAGE);
    expect(result.error).toBe('HTTP_403: SENDER_ID_NOT_APPROVED');
  });

  it('truncates a gateway that answers with a wall of HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(5000), { status: 500 })));

    const result = await provider().send(MESSAGE);
    // A 500 is retried, and neither attempt floods the log.
    expect((result.error ?? '').length).toBeLessThan(250);
  });

  it('still never logs the key or the body when it reports one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"sender id not approved"}', { status: 400 })),
    );

    await provider().send(MESSAGE);

    const serialised = JSON.stringify(logs);
    expect(serialised).toContain('sender id not approved');
    expect(serialised).not.toContain('secret-key');
    expect(serialised).not.toContain('4821');
  });
});


/*
 * Code mode — what makes WhatsApp reachable through an SMS gateway.
 *
 * WhatsApp refuses free text from a business and carries only an approved
 * template with a slot in it, so the OTP-specialised gateways take the digits
 * and own the wording. Getting this wrong does not fail loudly: the gateway
 * accepts a whole Arabic sentence as a "code", bills for it, and delivers
 * something no customer can type into the app.
 */
describe('code mode', () => {
  async function captureBody(overrides: Record<string, unknown>, message = MESSAGE) {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await provider(overrides).send(message);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { body: JSON.parse(init.body as string) as Record<string, string>, result };
  }

  it('sends the code alone, not the sentence around it', async () => {
    const { body } = await captureBody({
      bodyMode: 'code',
      bodyField: 'verificationCode',
      extraFields: { smsType: 'verification', provider: 'auto' },
    });

    expect(body.verificationCode).toBe('4821');
    // The Arabic wording is the vendor template's job in this mode.
    expect(body.verificationCode).not.toContain('رمز');
  });

  it('still sends the whole message in text mode', async () => {
    const { body } = await captureBody({});
    expect(body.message).toBe(MESSAGE.body);
  });

  it('refuses a message with no code in it rather than spending one', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider({ bodyMode: 'code' }).send({
      toE164: '+9647701234567',
      body: 'مرحباً بك في جيبلي',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('NO_CODE_IN_BODY');
    // Never reached the gateway, so nothing was billed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not log the code it extracted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    await provider({ bodyMode: 'code', bodyField: 'verificationCode' }).send(MESSAGE);

    expect(JSON.stringify(logs)).not.toContain('4821');
  });

  it('takes the code out of a six-digit message too', async () => {
    const { body } = await captureBody({ bodyMode: 'code' }, {
      toE164: '+9647701234567',
      body: 'رمز التحقق الخاص بك في جيبلي هو 482193. لا تشاركه مع أي شخص',
    });

    expect(body.message).toBe('482193');
  });
});
