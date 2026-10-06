import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppOtpProvider } from './index.js';

/**
 * What this provider has to get right, and what each mistake costs.
 *
 * Cloud API will not take a sentence — it takes a template name and the code
 * that fills its slot — so the code has to be lifted back out of the rendered
 * Arabic body. Get that wrong and every customer gets a message with the wrong
 * number in it, or none at all.
 *
 * The rest is the same contract the SMS gateway has: never retry a refusal
 * (Meta's 4xx means an unapproved template or a dead token, and repeating it
 * only delays the customer), always retry a timeout (an OTP that never arrives
 * is somebody who cannot sign in), and never put the code in a log (plan §10).
 */

const logs: { level: string; fields: Record<string, unknown>; message: string }[] = [];

const logger = {
  info: (fields: Record<string, unknown>, message: string) =>
    logs.push({ level: 'info', fields, message }),
  error: (fields: Record<string, unknown>, message: string) =>
    logs.push({ level: 'error', fields, message }),
  warn: (fields: Record<string, unknown>, message: string) =>
    logs.push({ level: 'warn', fields, message }),
} as unknown as ConstructorParameters<typeof WhatsAppOtpProvider>[0];

function provider(overrides: Record<string, unknown> = {}) {
  return new WhatsAppOtpProvider(logger, {
    phoneNumberId: '1234567890',
    accessToken: 'permanent-system-user-token',
    templateName: 'otp_code',
    ...overrides,
  });
}

/** What `NOTIFICATION_TEMPLATES.otpCode` actually produces. */
const MESSAGE = { toE164: '+9647701234567', body: 'رمز التحقق الخاص بك: 4821' };

const ACCEPTED = () =>
  new Response(JSON.stringify({ messages: [{ id: 'wamid.HBgM' }] }), { status: 200 });

afterEach(() => {
  logs.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the request Meta receives', () => {
  it('sends the template and the code, not the sentence', async () => {
    const fetchMock = vi.fn(async () => ACCEPTED());
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe('wamid.HBgM');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');

    const body = JSON.parse(String(init.body)) as Record<string, never>;
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      // Cloud API rejects the leading plus.
      to: '9647701234567',
      type: 'template',
      template: { name: 'otp_code', language: { code: 'ar' } },
    });

    // The code, and only the code. The Arabic wording is Meta's approved copy.
    const components = (body as unknown as { template: { components: unknown[] } }).template
      .components as { type: string; parameters: { text: string }[] }[];
    expect(components[0]).toMatchObject({
      type: 'body',
      parameters: [{ type: 'text', text: '4821' }],
    });
    expect(JSON.stringify(body)).not.toContain('رمز التحقق');
  });

  it('repeats the code in the copy button, which the template requires', async () => {
    const fetchMock = vi.fn(async () => ACCEPTED());
    vi.stubGlobal('fetch', fetchMock);

    await provider().send(MESSAGE);

    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as { template: { components: { type: string; parameters: { text: string }[] }[] } };

    /*
     * Meta counts the button's parameter separately, and a body-only payload
     * against a template that has a button fails with 132000 — «number of
     * parameters does not match». Which is the whole reason this is a test.
     */
    const button = body.template.components.find((part) => part.type === 'button');
    expect(button).toBeDefined();
    expect(button?.parameters[0]?.text).toBe('4821');
  });

  it('omits the button for a template that has none', async () => {
    const fetchMock = vi.fn(async () => ACCEPTED());
    vi.stubGlobal('fetch', fetchMock);

    await provider({ hasCopyCodeButton: false }).send(MESSAGE);

    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as { template: { components: { type: string }[] } };

    expect(body.template.components).toHaveLength(1);
  });

  it('carries the token as a bearer header', async () => {
    const fetchMock = vi.fn(async () => ACCEPTED());
    vi.stubGlobal('fetch', fetchMock);

    await provider().send(MESSAGE);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer permanent-system-user-token',
    );
  });

  it('honours the pinned API version and template language', async () => {
    const fetchMock = vi.fn(async () => ACCEPTED());
    vi.stubGlobal('fetch', fetchMock);

    await provider({ apiVersion: 'v22.0', templateLanguage: 'ar_EG' }).send(MESSAGE);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v22.0/');
    const body = JSON.parse(String(init.body)) as { template: { language: { code: string } } };
    expect(body.template.language.code).toBe('ar_EG');
  });
});

describe('when it goes wrong', () => {
  it('does not retry a refusal, and reports Meta’s own code', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'Template name does not exist',
              code: 132001,
              error_subcode: 2494010,
            },
          }),
          { status: 400 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(false);
    // An unapproved template refused twice is refused twice, a second later.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /*
     * The operator reading this log is the person who has to fix it, and
     * «HTTP_400» is the same string for an unapproved template, an expired
     * token and a number with no WhatsApp.
     */
    expect(result.error).toBe('META_132001/2494010');
  });

  it('retries a 5xx once, and succeeds on the second attempt', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response('upstream', { status: 503 }) : ACCEPTED();
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('retries a transport failure, then gives up', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send(MESSAGE);

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a message with no code rather than sending an empty template', async () => {
    const fetchMock = vi.fn(async () => ACCEPTED());
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send({ toE164: '+9647701234567', body: 'مرحباً' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('NO_CODE_IN_BODY');
    // Nothing left the process: a template with no parameter is a message the
    // customer would receive with a blank where the code should be.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what reaches the logs', () => {
  it('never writes the code, the body or the payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ACCEPTED()),
    );

    await provider().send(MESSAGE);

    const written = JSON.stringify(logs);
    expect(written).not.toContain('4821');
    expect(written).not.toContain('رمز التحقق');
    expect(written).not.toContain('permanent-system-user-token');
  });

  it('masks the recipient down to its network prefix', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ACCEPTED()),
    );

    await provider().send(MESSAGE);

    expect(logs[0]?.fields.to).toBe('+96477***');
  });
});
